import type { AiTaskKind, ChatMessage, ContextSource, ModelParams, ProviderConfig, PromptTemplate, TokenUsage } from "@/core";
import { estimateCost, loadSettings, resolveModel } from "@/db/repo/settings";
import { logGeneration } from "@/db/repo/ai";
import { db } from "@/db/database";
import { newId } from "@/utils/id";
import { chat, chatStream, type CallOptions } from "./llm";
import { buildContext, type BuildContextOptions } from "./context";
import { parseJson, type ParseResult } from "./json";
import { ProviderError, type ChatRequest, type TaskRunOptions, type TaskRunResult } from "./types";
import { baseSystem } from "./prompts";

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
          await record(opts, provider.id, model, params, messages, contextSources, res.usage, performance.now() - started, false, "推理占满 token 预算，自动提高上限重试");
        }
        params = { ...params, maxTokens: bumped };
        round -= 1; // 这次不算在模型降级轮次里
        continue;
      }

      attempts.push({ model, ok: true, ms: performance.now() - attemptStarted });
      if (opts.recordUsage !== false) {
        await record(opts, provider.id, model, params, messages, contextSources, res.usage, performance.now() - started, true);
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
    await record(opts, provider.id, model, target.params, messages, contextSources, failed.usage, failed.ms, false, err.message);
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
  error?: string,
): Promise<void> {
  if (!opts.projectId) return;
  try {
    const cost = await estimateCost(providerId + "::" + model, usage.prompt, usage.completion);
    await logGeneration({
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

/** system prompt = 通用底座 + 项目信息 + 额外要求 */
export async function systemWithProject(projectId?: string, extra?: string): Promise<string> {
  const project = projectId ? await db.projects.get(projectId) : undefined;
  const base = baseSystem(project);
  return extra ? base + "\n\n" + extra : base;
}
