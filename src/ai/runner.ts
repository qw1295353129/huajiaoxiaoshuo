import type { AiTaskKind, ChatMessage, ContextSource, ID, ModelParams, ProviderConfig, PromptTemplate, TokenUsage } from "@/core";
import { estimateCost, loadSettings, resolveModel } from "@/db/repo/settings";
import { logGeneration } from "@/db/repo/ai";
import { db } from "@/db/database";
import { newId } from "@/utils/id";
import { chat, chatStream, type CallOptions } from "./llm";
import { buildContext, type BuildContextOptions } from "./context";
import { parseJson, type ParseResult } from "./json";
import { ProviderError, type ChatRequest, type TaskRunOptions, type TaskRunResult } from "./types";
import { baseSystem, setMemoryBlock } from "./prompts";
import { markMemoryUsed, memoryForProject, recordMemoryUsage } from "@/db/repo/memory";
import { recallMemories } from "./recall";

/** 一次 system prompt 里最多注入几条偏好/教训（原来的硬上限，语义召回也不打破它） */
const MEMORY_INJECT_LIMIT = 12;

/**
 * 待登记的记忆注入清单。
 *
 * 为什么需要这么一个模块级变量：记忆是在 systemWithProject() 里注入的，
 * 而这个函数由调用方在 runText() **之前**执行，那时还没有 generationId
 * （它要等 runText 落库时才生成）。所以这里先记下"这次用了哪些 fact"，
 * runText 开头取走，等生成记录创建出来再把 generationId 补进 memoryUsage。
 *
 * 局限（写在这里免得后人踩）：它假设调用方"先拼 system prompt，紧接着调 runText"，
 * 这也是本项目所有调用点的写法。如果有人拼一次 system 却连跑多次 runText，
 * 只有第一次会带上记忆使用记录 —— 与其为了这种罕见写法引入 correlation id 参数，
 * 不如把假设写清楚。
 */
let pendingInjections: { projectId: ID; ids: ID[]; semanticIds: Set<ID>; at: number } | null = null;

/** 取走待登记清单（同时防陈旧：超过 5 分钟的一定不是这次生成用的） */
function takePendingInjections(): { ids: ID[]; semanticIds: Set<ID> } | null {
  const p = pendingInjections;
  pendingInjections = null;
  if (!p) return null;
  if (Date.now() - p.at > 5 * 60_000) return null;
  return { ids: p.ids, semanticIds: p.semanticIds };
}

export interface RunTextOptions extends TaskRunOptions {
  system: string;
  user: string;
  /** 附加素材：交给 context builder 去数据库里捞 */
  context?: BuildContextOptions;
  history?: ChatMessage[];
  json?: boolean;
  jsonSchemaHint?: string;
  recordUsage?: boolean;
}

export interface TextRunResult extends TaskRunResult {
  usage: TokenUsage;
  contextSources: ContextSource[];
  contextTokens: number;
}

/**
 * 统一文本生成入口：解析模型 → 组装 prompt → 调用 → 降级重试 → 记录用量。
 * 所有 AI 能力都走这里，保证行为一致、可观测、可计费。
 */
export async function runText(opts: RunTextOptions): Promise<TextRunResult> {
  const started = performance.now();
  // 在第一个 await 之前取走注入清单，避免并发调用互相串台
  const injected = takePendingInjections();
  const settings = loadSettings();
  const resolved = await resolveModel(opts.taskKind);
  const target = await pickTarget(opts, resolved, settings);

  if (!target.provider || !target.model) {
    return { ...fail(new ProviderError("no-provider", "没有可用的模型"), started), contextSources: [], contextTokens: 0 };
  }

  let contextText = "";
  let contextSources: ContextSource[] = [];
  let contextTokens = 0;
  if (opts.context) {
    const built = await buildContext(opts.context);
    contextText = built.text;
    contextSources = built.sources;
    contextTokens = built.tokens;
  }

  const messages = buildMessages({
    system: opts.system,
    user: opts.user,
    contextText,
    history: opts.history,
    json: opts.json,
    jsonSchemaHint: opts.jsonSchemaHint,
  });

  const attempts: TaskRunResult["attempts"] = [];
  const maxRounds = opts.allowFallback === false ? 1 : 3;
  let provider: ProviderConfig = target.provider;
  let model = target.model;
  let stream = settings.stream && Boolean(opts.onDelta);
  let lastError: unknown;
  // 推理模型（DeepSeek V4 / o 系列等）会先花 token 思考，预算不足时正文为空。
  // 命中这种情况就在同一模型上加大预算重试，而不是把空结果当成成功返回。
  let params = target.params;
  let starvedRetries = 0;

  for (let round = 0; round < maxRounds; round++) {
    const attemptStarted = performance.now();
    const req: ChatRequest = {
      provider,
      model,
      messages,
      params,
      stream,
      signal: opts.signal,
      onDelta: opts.onDelta,
    };
    try {
      const res = stream ? await chatStream(req, callOpts()) : await chat(req, callOpts());

      // 空正文 + 有思考内容 = 推理把预算吃光了
      const starved = !res.text.trim() && Boolean(res.reasoning?.trim());
      if (starved && starvedRetries < 2) {
        starvedRetries += 1;
        const bumped = Math.min(32000, Math.max(Math.round(params.maxTokens * 2.5), params.maxTokens + 4000));
        attempts.push({
          model,
          ok: false,
          error: `推理占满预算（${res.usage.completion} tokens 全为思考），已提升到 ${bumped} 重试`,
          ms: performance.now() - attemptStarted,
        });
        if (opts.recordUsage !== false) {
          await record(opts, provider.id, model, params, messages, contextSources, res.usage, performance.now() - started, false, "推理占满 token 预算，自动提高上限重试", injected);
        }
        params = { ...params, maxTokens: bumped };
        round -= 1; // 这次不算在模型降级轮次里
        continue;
      }

      attempts.push({ model, ok: true, ms: performance.now() - attemptStarted });
      if (opts.recordUsage !== false) {
        await record(opts, provider.id, model, params, messages, contextSources, res.usage, performance.now() - started, true, undefined, injected);
      }
      if (starved) {
        // 重试后仍然为空：明确报错，不要让用户面对空白
        const e = new ProviderError(
          "bad-request",
          `模型把 ${res.usage.completion} 个 token 全部用在思考上，没有产出正文。请在「设置 → 任务路由」把该任务的 max tokens 调大（建议 8000 以上），或换用非推理模型。`,
          { providerId: provider.id },
        );
        const failed = fail(e, started);
        return { ...failed, attempts, contextSources, contextTokens };
      }
      return {
        ok: true,
        text: res.text,
        usage: res.usage,
        model,
        providerId: provider.id,
        ms: performance.now() - started,
        attempts,
        contextSources,
        contextTokens,
      };
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      attempts.push({ model, ok: false, error: err.message, ms: performance.now() - attemptStarted });
      lastError = e;
      if (e instanceof ProviderError && (e.kind === "aborted" || e.kind === "auth" || e.kind === "no-provider")) break;

      const next = await nextFallback(opts.taskKind, model, round);
      if (!next) break;
      const fbProvider = await db.providers.get(next.providerId);
      if (!fbProvider) break;
      provider = fbProvider;
      model = next.model;
      stream = settings.stream && Boolean(opts.onDelta);
    }
  }

  const err =
    lastError instanceof ProviderError
      ? lastError
      : new ProviderError("network", lastError instanceof Error ? lastError.message : "生成失败");
  const failed = fail(err, started);
  if (opts.recordUsage !== false) {
    await record(opts, provider.id, model, target.params, messages, contextSources, failed.usage, failed.ms, false, err.message, injected);
  }
  return { ...failed, attempts, contextSources, contextTokens };
}

/** 结构化生成：自动解析 JSON，截断或格式错时自动修复重试 */
export async function runJson<T = unknown>(
  opts: RunTextOptions & { jsonSchemaHint: string; repairRounds?: number },
): Promise<TextRunResult & { parsed?: ParseResult<T> }> {
  const maxRepair = opts.repairRounds ?? 2;
  let result = await runText({ ...opts, json: true });

  for (let attempt = 0; attempt < maxRepair; attempt++) {
    if (!result.ok) break;
    const parsed = parseJson<T>(result.text);
    if (parsed.ok) return { ...result, parsed };

    const repairUser = parsed.truncated
      ? "上一次输出因为长度被截断了。请重新输出，压缩内容规模，确保 JSON 完整闭合。\n\n" + opts.jsonSchemaHint
      : "你上一次的输出不是合法 JSON（" + (parsed.error ?? "格式错误") + "）。请把下面的内容重新输出为合法 JSON，不要添加任何解释，不要用代码块包裹：\n\n---\n" + result.text.slice(0, 6000) + "\n---";

    result = await runText({
      ...opts,
      json: true,
      user: repairUser,
      params: parsed.truncated
        ? { ...(opts.params ?? {}), maxTokens: Math.min(32000, Math.round((opts.params?.maxTokens ?? 4096) * 1.6)) }
        : opts.params,
    });
    if (!result.ok) break;
  }

  return { ...result, parsed: result.ok ? parseJson<T>(result.text) : undefined };
}

function callOpts(): CallOptions {
  return { retries: 2, timeoutMs: 300000 };
}

async function pickTarget(
  opts: RunTextOptions,
  resolved: { providerId?: string; model?: string; params: ModelParams },
  settings: { activeProviderId?: string; activeModel?: string; allowCloud: boolean },
): Promise<{ provider?: ProviderConfig; model: string; params: ModelParams }> {
  let providerId = resolved.providerId;
  let model = resolved.model;

  if (opts.model) {
    const parts = opts.model.split("::");
    providerId = parts[0];
    model = parts.slice(1).join("::") || model;
  }

  const params: ModelParams = { ...resolved.params, ...(opts.params ?? {}) };

  // 隐私闸门：关闭云端后强制走本地模型
  if (!settings.allowCloud) {
    const current = providerId ? await db.providers.get(providerId) : undefined;
    const currentLocal = current ? isLocal(current) : false;
    if (!currentLocal) {
      const all = await db.providers.toArray();
      const localProvider = all.find((x) => x.enabled && x.models.length > 0 && isLocal(x));
      if (localProvider) {
        providerId = localProvider.id;
        model = localProvider.models[0];
      }
    }
  }

  const provider = providerId ? await db.providers.get(providerId) : undefined;
  return { provider, model: model ?? "", params };
}

function isLocal(p: ProviderConfig): boolean {
  return p.kind === "ollama" || p.kind === "lmstudio" || /127\.0\.0\.1|localhost/.test(p.baseUrl);
}

async function nextFallback(taskKind: AiTaskKind, currentModel: string, round: number): Promise<{ providerId: string; model: string } | null> {
  const routing = await db.routing.get(taskKind);
  const settings = loadSettings();
  const candidates = [...(routing?.fallbacks ?? [])];
  if (settings.activeProviderId && settings.activeModel) {
    candidates.push(settings.activeProviderId + "::" + settings.activeModel);
  }
  const usable = candidates.filter((c) => c && !c.endsWith("::" + currentModel));
  const pick = usable[round];
  if (!pick) return null;
  const parts = pick.split("::");
  const providerId = parts[0];
  const model = parts.slice(1).join("::");
  if (!providerId || !model) return null;
  if (!(await db.providers.get(providerId))) return null;
  return { providerId, model };
}

export function buildMessages(input: {
  system: string;
  user: string;
  contextText?: string;
  history?: ChatMessage[];
  json?: boolean;
  jsonSchemaHint?: string;
}): ChatMessage[] {
  const now = new Date().toISOString();
  const msgs: ChatMessage[] = [{ id: newId("msg"), role: "system", content: input.system, createdAt: now }];
  for (const m of input.history ?? []) {
    if (m.role !== "system") msgs.push(m);
  }
  const body = [input.contextText?.trim(), input.user.trim()].filter(Boolean).join("\n\n");
  msgs.push({
    id: newId("msg"),
    role: "user",
    content: input.json ? body + "\n\n" + (input.jsonSchemaHint ?? "") : body,
    createdAt: now,
  });
  return msgs;
}

async function record(
  opts: RunTextOptions,
  providerId: string,
  model: string,
  params: ModelParams,
  messages: ChatMessage[],
  contextSources: ContextSource[],
  usage: TokenUsage,
  ms: number,
  ok: boolean,
  error: string | undefined,
  injected: { ids: ID[]; semanticIds: Set<ID> } | null,
): Promise<void> {
  if (!opts.projectId) return;
  try {
    const cost = await estimateCost(providerId + "::" + model, usage.prompt, usage.completion);
    const generation = await logGeneration({
      projectId: opts.projectId,
      chapterId: opts.chapterId,
      taskKind: opts.taskKind,
      providerId,
      model,
      params,
      promptPreview: messages[messages.length - 1]?.content.slice(0, 400) ?? "",
      contextSources,
      promptTokens: usage.prompt,
      completionTokens: usage.completion,
      ms: Math.round(ms),
      ok,
      error,
      cost,
    });
    // 效果追踪：把"这次生成用了哪些记忆"落到 memoryUsage。
    // 只记成功的那次 —— 作者没看到产出就不会去评价它，记进去只会稀释差评率的分母。
    // 整个写入失败也不抛（recordMemoryUsage 内部吞异常），统计永远不能影响写作。
    if (ok && injected?.ids.length) {
      await recordMemoryUsage(
        injected.ids.map((factId) => ({
          projectId: opts.projectId as ID,
          generationId: generation.id,
          factId,
          via: injected.semanticIds.has(factId) ? ("semantic" as const) : ("rule" as const),
        })),
      );
    }
  } catch {
    /* 记录失败不影响主流程 */
  }
}

function fail(err: unknown, started: number): TaskRunResult {
  const e =
    err instanceof ProviderError
      ? err
      : new ProviderError("network", err instanceof Error ? err.message : String(err));
  return {
    ok: false,
    text: "",
    error: e.hint,
    errorKind: e.kind,
    usage: { prompt: 0, completion: 0, total: 0 },
    model: "",
    providerId: "",
    ms: performance.now() - started,
    attempts: [],
  };
}

/** 用自定义模板运行（模板里的 {{var}} 会被替换） */
export async function runTemplate(
  template: PromptTemplate,
  vars: Record<string, string>,
  opts: Omit<RunTextOptions, "system" | "user">,
): Promise<TextRunResult> {
  return runText({
    ...opts,
    system: interpolate(template.system, vars),
    user: interpolate(template.user, vars),
    json: Boolean(template.schema),
  });
}

export function interpolate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key: string) => vars[key] ?? "");
}

/**
 * system prompt = 通用底座 + 项目信息 + 创作者档案 + 写作记忆 + 额外要求
 *
 * 写作记忆在这里统一注入：所有任务的 system prompt 都经过这个函数，
 * 所以偏好与教训会自动作用于每一次生成，不需要各调用点自己处理。
 *
 * opts 是可选的：不传时行为与以前完全一致（语义召回默认关闭，等于直通）。
 * 需要在写某一章时更精准地召回，就把 chapterId / query 传进来。
 */
export async function systemWithProject(
  projectId?: string,
  extra?: string,
  opts: { chapterId?: string; query?: string } = {},
): Promise<string> {
  const project = projectId ? await db.projects.get(projectId) : undefined;
  pendingInjections = null;

  // 注入记忆：只取偏好与教训（事实/约定走上下文，避免与设定库重复），按可信度排序
  if (projectId) {
    try {
      const facts = await memoryForProject(projectId);
      const candidates = facts.filter((m) => m.kind === "preference" || m.kind === "lesson");
      // 语义召回（默认关闭）：开启后按当前写作内容重排候选，关闭时这一行是直通
      const recall = await recallMemories({
        projectId,
        facts: candidates,
        chapterId: opts.chapterId,
        query: opts.query,
      });
      const injected = recall.facts.slice(0, MEMORY_INJECT_LIMIT);
      setMemoryBlock({ constraints: injected.map((m) => ({ text: m.text, kind: m.kind })) });
      if (injected.length) {
        // 记录使用：usedCount 让"一直有用"的记忆在排序里加权；
        // pendingInjections 让 runText 把 generationId 补进 memoryUsage（效果追踪）
        await markMemoryUsed(injected.map((m) => m.id));
        pendingInjections = {
          projectId,
          ids: injected.map((m) => m.id),
          semanticIds: new Set(recall.pickedIds),
          at: Date.now(),
        };
      }
    } catch {
      setMemoryBlock({ constraints: [] });
      pendingInjections = null;
    }
  } else {
    setMemoryBlock({ constraints: [] });
  }

  const base = baseSystem(project);
  return extra ? base + "\n\n" + extra : base;
}
