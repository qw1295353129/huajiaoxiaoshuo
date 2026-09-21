import type { AiSuggestion, AiTaskKind, Chapter, Character, ID, Project } from "@/core";
import { db } from "@/db/database";
import { saveSuggestion } from "@/db/repo/ai";
import { chapterTail } from "./context";
import { runJson, runText, systemWithProject, type TextRunResult } from "./runner";
import { BRAINSTORM_SCHEMA, CRITIQUE_SCHEMA, WRITING_RULES, craftFor, jsonInstruction } from "./prompts";
import { asArray, asString, parseJson, pickStr, type ParseResult } from "./json";
import { estimateTokens } from "@/utils/tokens";
import { countWords } from "@/utils/text";
import type { BuildContextOptions, ContextSection } from "./context";

/** 代码内部的换行常量，避免嵌套转义 */
const NL = String.fromCharCode(10);

export interface GenerateOptions {
  projectId: ID;
  chapterId?: ID;
  selection?: string;
  instruction?: string;
  targetWords?: number;
  candidates?: number;
  signal?: AbortSignal;
  onDelta?: (d: { text?: string; reasoning?: string }) => void;
  contextBudget?: number;
  persist?: boolean;
  label?: string;
}

export interface GeneratedCandidate {
  content: string;
  note?: string;
  tokens: number;
  words: number;
}

export interface GenerationOutput {
  ok: boolean;
  candidates: GeneratedCandidate[];
  suggestion?: AiSuggestion;
  error?: string;
  usage: { prompt: number; completion: number; total: number };
  model: string;
  ms: number;
  contextTokens: number;
  contextSources: TextRunResult["contextSources"];
}

async function generate(
  taskKind: AiTaskKind,
  systemExtra: string,
  userBody: string,
  opts: GenerateOptions,
  extraContext?: { query?: string; sections?: ContextSection[] },
): Promise<GenerationOutput> {
  const count = Math.max(1, Math.min(opts.candidates ?? 1, 5));
  const system = await systemWithProject(opts.projectId, systemExtra);
  const candidates: GeneratedCandidate[] = [];
  let usage = { prompt: 0, completion: 0, total: 0 };
  let model = "";
  let ms = 0;
  let contextTokens = 0;
  let contextSources: TextRunResult["contextSources"] = [];
  let lastError: string | undefined;
  const temps = [0, 0.12, -0.1, 0.2, -0.16];
  const base = await baseTemp(taskKind);

  for (let i = 0; i < count; i++) {
    const res = await runText({
      taskKind,
      projectId: opts.projectId,
      chapterId: opts.chapterId,
      system,
      user: userBody,
      signal: opts.signal,
      onDelta: count === 1 ? opts.onDelta : undefined,
      params: i > 0 ? { temperature: clampTemp(base + temps[i % temps.length]) } : undefined,
      context: {
        projectId: opts.projectId,
        chapterId: opts.chapterId,
        budget: opts.contextBudget,
        query: extraContext?.query,
        include: extraContext?.sections,
        selection: opts.selection,
      },
    });
    usage = {
      prompt: usage.prompt + res.usage.prompt,
      completion: usage.completion + res.usage.completion,
      total: usage.total + res.usage.total,
    };
    model = res.model || model;
    ms += res.ms;
    contextTokens = res.contextTokens;
    contextSources = res.contextSources;
    if (!res.ok) {
      lastError = res.error;
      continue;
    }
    const content = cleanGeneratedText(res.text);
    if (!content.trim()) continue;
    candidates.push({ content, tokens: estimateTokens(content), words: countWords(content) });
  }

  if (!candidates.length) {
    return { ok: false, candidates: [], error: lastError ?? "生成失败", usage, model, ms, contextTokens, contextSources };
  }

  let suggestion: AiSuggestion | undefined;
  if (opts.persist !== false) {
    suggestion = await saveSuggestion({
      projectId: opts.projectId,
      chapterId: opts.chapterId,
      taskKind,
      label: opts.label ?? defaultLabel(taskKind),
      content: candidates[0].content,
      variants: candidates.slice(1).map((c, i) => ({ id: "v" + i, content: c.content })),
      status: "pending",
      citations: contextSources.slice(0, 12).map((s) => ({ label: s.label })),
      selfNotes: opts.instruction,
    });
  }

  return { ok: true, candidates, suggestion, usage, model, ms, contextTokens, contextSources };
}

async function baseTemp(taskKind: AiTaskKind): Promise<number> {
  const routing = await db.routing.get(taskKind);
  return routing?.params.temperature ?? 0.85;
}

function clampTemp(t: number): number {
  return Math.min(2, Math.max(0, t));
}

/** 去掉模型爱加的开场白与代码块标记 */
export function cleanGeneratedText(text: string): string {
  let t = text.trim();
  t = t.replace(/^\s*```[a-zA-Z]*\s*/, "").replace(/\s*```\s*$/, "");
  t = t.replace(/^(好的|当然|没问题|以下是|这是)[^\n]{0,40}\n+/, "");
  t = t.replace(/^（?以下(是|为)[^\n]*\n+/, "");
  return t.trim();
}

function defaultLabel(kind: AiTaskKind): string {
  const map: Record<string, string> = {
    continue: "续写", expand: "扩写", rewrite: "改写", polish: "润色",
    describe: "描写", dialogue: "对话", brainstorm: "灵感", critique: "评审",
  };
  return map[kind] ?? "生成";
}

// ============ 具体能力 ============

/** 续写：从章节断点往下写 */
export async function continueWriting(opts: GenerateOptions): Promise<GenerationOutput> {
  const tail = opts.chapterId ? await chapterTail(opts.chapterId, 1500) : "";
  const tailBlock = tail ? "【上文结尾】" + NL + tail : "【说明】本章还没有内容，请写开篇。";
  const target = opts.targetWords ?? 800;
  const user = [
    tailBlock,
    "### 续写指令",
    opts.instruction ? "额外要求：" + opts.instruction : "",
    "从上面的断点继续写约 " + target + " 字。",
    "不要重复上文任何一个句子。直接输出正文段落。",
  ].filter(Boolean).join(NL + NL);
  return generate("continue", WRITING_RULES.continue, user, opts, { query: tail.slice(-300) });
}

/** 改写选中段落 */
export async function rewriteSelection(opts: GenerateOptions & { selection: string }): Promise<GenerationOutput> {
  const user = [
    "### 改写指令",
    "要求：" + (opts.instruction || "提升画面感与语言密度，保持剧情不变"),
    "",
    "【选中段落】",
    opts.selection,
    "",
    "输出改写后的段落，不要任何解释。",
  ].join(NL);
  return generate("rewrite", WRITING_RULES.rewrite, user, opts, { query: opts.selection.slice(0, 200) });
}

/** 扩写 */
export async function expandSelection(opts: GenerateOptions & { selection: string }): Promise<GenerationOutput> {
  const user = [
    "### 扩写指令",
    opts.instruction || "把这段扩写得更具体、更有临场感。",
    "",
    "【原文】",
    opts.selection,
  ].join(NL);
  return generate("expand", WRITING_RULES.expand, user, opts, { query: opts.selection.slice(0, 200) });
}

/** 润色 */
export async function polishSelection(opts: GenerateOptions & { selection: string }): Promise<GenerationOutput> {
  const user = ["### 润色指令", "在不改变含义的前提下提升语言质量。", "", "【原文】", opts.selection].join(NL);
  return generate("polish", WRITING_RULES.polish, user, opts, { query: opts.selection.slice(0, 200) });
}

/** 指定对象的描写 */
export async function generateDescription(
  opts: GenerateOptions & { subject: string; sense?: string },
): Promise<GenerationOutput> {
  const user = [
    "### 描写任务",
    "对象：" + opts.subject,
    opts.sense ? "侧重感官：" + opts.sense : "",
    opts.instruction ? "要求：" + opts.instruction : "",
    "写 150~300 字的描写段落，可直接嵌入正文。",
  ].filter(Boolean).join(NL);
  return generate("describe", WRITING_RULES.describe, user, opts, {
    query: opts.subject,
    sections: ["characters", "world", "profile", "style"],
  });
}

/** 多角色对话场景 */
export async function generateDialogue(
  opts: GenerateOptions & { participants: string[]; situation: string },
): Promise<GenerationOutput> {
  const user = [
    "### 对话任务",
    "参与人物：" + opts.participants.join("、"),
    "情境：" + opts.situation,
    opts.instruction ? "要求：" + opts.instruction : "",
    "",
    "写一段 400~800 字的对话场景。每个人说话方式必须能被读者区分出来。",
  ].filter(Boolean).join(NL);
  return generate("dialogue", WRITING_RULES.dialogue, user, opts, {
    query: opts.participants.join(" "),
    sections: ["characters", "profile", "threads", "style", "world"],
  });
}

// ============ 灵感与评审 ============

export interface BrainstormDirection {
  title: string;
  premise: string;
  why: string;
  risk: string;
  examples: string[];
}

export async function brainstorm(
  opts: GenerateOptions & { question: string; count?: number },
): Promise<{ ok: boolean; directions: BrainstormDirection[]; error?: string; raw: string }> {
  const system = await systemWithProject(
    opts.projectId,
    "你是资深故事策划，擅长在已有设定上找到最有张力的走向。你从不给空泛建议。",
  );
  const res = await runJson({
    taskKind: "brainstorm",
    projectId: opts.projectId,
    chapterId: opts.chapterId,
    system,
    user: [
      "### 当前的问题",
      opts.question,
      "",
      "给出 " + (opts.count ?? 4) + " 个具体、互相差异明显的方向。每个方向都要有可写的具体桥段。",
    ].join(NL),
    jsonSchemaHint: jsonInstruction(BRAINSTORM_SCHEMA),
    context: { projectId: opts.projectId, chapterId: opts.chapterId, query: opts.question },
    signal: opts.signal,
  });

  if (!res.ok || !res.parsed?.ok) {
    return { ok: false, directions: [], error: res.error ?? "解析失败", raw: res.text };
  }
  const data = res.parsed.data as Record<string, unknown>;
  const directions = asArray<Record<string, unknown>>(data.directions).map((d) => ({
    title: pickStr(d, "title", "标题"),
    premise: pickStr(d, "premise", "核心"),
    why: pickStr(d, "why", "理由"),
    risk: pickStr(d, "risk", "风险"),
    examples: asArray<unknown>(d.examples).map((x) => asString(x)),
  }));
  return { ok: true, directions, raw: res.text };
}

export interface CritiqueResult {
  verdict: string;
  score: number;
  strengths: string[];
  weaknesses: { point: string; evidence: string; fix: string }[];
  readerExperience: string;
  priorityFixes: string[];
  raw: string;
}

/** 严苛评审：像最挑剔的编辑那样读一遍 */
export async function critique(
  opts: GenerateOptions & { text?: string },
): Promise<{ ok: boolean; result?: CritiqueResult; error?: string }> {
  const target = opts.text ?? opts.selection ?? "";
  const system = await systemWithProject(
    opts.projectId,
    [
      "你是一位以严苛著称的文学编辑。你的职责不是鼓励作者，而是让稿子变得更好。",
      "你只指出真实存在的问题，并且每一条都必须引用原文作为证据。",
      "评分标准：6 分是能发表，8 分是能获奖，4 分以下说明有结构性问题。",
    ].join(NL),
  );
  const userBody = target
    ? "### 待评稿件" + NL + target
    : "### 待评稿件" + NL + "（未提供文本，请基于上下文中的当前章节进行评审）";

  const res = await runJson({
    taskKind: "critique",
    projectId: opts.projectId,
    chapterId: opts.chapterId,
    system,
    user: userBody + NL + NL + "给出诚实、具体、可执行的评审。",
    jsonSchemaHint: jsonInstruction(CRITIQUE_SCHEMA),
    context: {
      projectId: opts.projectId,
      chapterId: opts.chapterId,
      query: opts.instruction,
      sections: target ? ["profile", "characters", "style", "history"] : undefined,
    },
    signal: opts.signal,
  });

  if (!res.ok || !res.parsed?.ok) return { ok: false, error: res.error ?? "解析失败" };
  const d = res.parsed.data as Record<string, unknown>;
  return {
    ok: true,
    result: {
      verdict: pickStr(d, "verdict", "总评"),
      score: Number(d.score ?? 0),
      strengths: asArray<unknown>(d.strengths).map((x) => asString(x)),
      weaknesses: asArray<Record<string, unknown>>(d.weaknesses).map((w) => ({
        point: pickStr(w, "point", "问题"),
        evidence: pickStr(w, "evidence", "证据"),
        fix: pickStr(w, "fix", "修改"),
      })),
      readerExperience: pickStr(d, "readerExperience", "读者体验"),
      priorityFixes: asArray<unknown>(d.priorityFixes).map((x) => asString(x)),
      raw: res.text,
    },
  };
}

/** 卡文急救 */
export async function rescueIdeas(projectId: ID, chapterId: string | undefined, stuckAt: string, signal?: AbortSignal) {
  return brainstorm({
    projectId,
    chapterId,
    question: "作者卡在这里了：" + stuckAt + NL + "请给出能让故事继续推进的走向。",
    count: 4,
    signal,
  });
}

/** 章节写作体检（本地信息） */
export async function quickCheck(projectId: ID, chapterId: ID): Promise<{ words: number; tail: string; ok: boolean }> {
  const [chapter, content] = await Promise.all([db.chapters.get(chapterId), db.chapterContents.get(chapterId)]);
  if (!chapter || !content) return { words: 0, tail: "", ok: false };
  return { words: chapter.wordCount, tail: content.text.slice(-500), ok: true };
}

/** 角色卡 → 给模型的紧凑描述 */
export function characterBrief(c: Character): string {
  const bits = [c.tagline, c.personality, c.voice?.tone].filter(Boolean);
  return c.name + (bits.length ? "（" + bits.join("；") + "）" : "");
}

export { craftFor, parseJson };
export type { ParseResult, Project, Chapter };