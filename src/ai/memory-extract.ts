import type { AiFeedback, Chapter, ID, Issue, MemoryEvidence, MemoryExtraction, MemoryFact } from "@/core";
import { db } from "@/db/database";
import {
  addMemory, listMemory, memoryDedupeKey, reinforceMemory,
} from "@/db/repo/memory";
import { listIssues } from "@/db/repo/story";
import { listSessions } from "@/db/repo/writing";
import { listFeedback } from "@/db/repo/ai";

const NL = String.fromCharCode(10);

/**
 * 写作记忆的提取。
 *
 * 分两类来源，处理方式不同（这是刻意的设计）：
 *
 * 【规则型】来自你自己的操作痕迹——差评理由、被拒的建议、重复出现的问题、写作节奏。
 *   这些是客观事实，自动提取、自动生效，每条都带证据可点回原文。
 *
 * 【偏好型】需要"归纳"才能得出的写作偏好，必须靠模型。
 *   模型归纳的东西可能不准，所以**只生成候选，不直接生效**，
 *   由你在界面上确认后才写入记忆。
 *
 * 之所以不全部交给模型：自动生成一堆"AI 觉得你的偏好是……"，作者会失去信任。
 */

/** ---------- 规则型：自动提取 ---------- */

/** 从差评理由里直接生成"教训"（作者自己写的话最有价值，原样保留） */
function feedbackToMemory(list: AiFeedback[]): { text: string; evidence: MemoryEvidence }[] {
  const out: { text: string; evidence: MemoryEvidence }[] = [];
  for (const f of list) {
    const note = f.note?.trim();
    if (!note || note.length < 4) continue;
    out.push({
      text: note,
      evidence: { kind: "feedback", refId: f.id, quote: note, at: f.createdAt },
    });
  }
  return out;
}

/** 反复出现的问题类型 → 一条"注意"类记忆 */
const ISSUE_KIND_RULE: Record<string, { text: (n: number) => string; min: number }> = {
  "ai-smell": { min: 3, text: (n) => `避免套话与 AI 腔（已出现 ${n} 次）` },
  repetition: { min: 3, text: (n) => `注意不要重复用词与自我重复（已出现 ${n} 次）` },
  grammar: { min: 5, text: (n) => `注意错别字与标点规范（已出现 ${n} 次）` },
  "name-variant": { min: 2, text: (n) => `人名与称呼必须统一（已发现 ${n} 处不一致）` },
  timeline: { min: 2, text: (n) => `注意时间线先后关系（已发现 ${n} 处矛盾）` },
  "world-rule": { min: 2, text: (n) => `不得违反已设定的世界规则（已发现 ${n} 处冲突）` },
  "character-voice": { min: 3, text: (n) => `人物说话方式要能被区分（已发现 ${n} 处不符）` },
  pacing: { min: 3, text: (n) => `注意章节节奏，避免连续低张力（已提示 ${n} 次）` },
  pov: { min: 2, text: (n) => `视角不要越界（已发现 ${n} 处）` },
};

function issuesToMemory(issues: Issue[]): { text: string; evidence: MemoryEvidence[] }[] {
  const byDetector = new Map<string, Issue[]>();
  for (const i of issues) {
    if (i.status === "false-positive" || i.status === "fixed") continue;
    const key = i.detector ?? i.kind;
    byDetector.set(key, [...(byDetector.get(key) ?? []), i]);
  }
  const out: { text: string; evidence: MemoryEvidence[] }[] = [];
  for (const [key, list] of byDetector) {
    const rule = ISSUE_KIND_RULE[key] ?? ISSUE_KIND_RULE[list[0]?.kind ?? ""];
    if (!rule || list.length < rule.min) continue;
    out.push({
      text: rule.text(list.length),
      evidence: list.slice(0, 4).map((i) => ({
        kind: "issue" as const,
        refId: i.id,
        chapterId: i.chapterId,
        quote: i.title + (i.evidence?.quote ? "（" + i.evidence.quote.slice(0, 30) + "）" : ""),
        at: i.createdAt,
      })),
    });
  }
  return out;
}

/** 名词表里的 strict 条目 → 名词约定 */
async function glossaryToMemory(projectId: ID): Promise<{ text: string; evidence: MemoryEvidence[] }[]> {
  const terms = await db.glossary.where("projectId").equals(projectId).toArray();
  return terms
    .filter((t) => t.strict && t.variants.length)
    .map((t) => ({
      text: `统一写作「${t.canonical}」，不要写成 ${t.variants.slice(0, 3).join("、")}`,
      evidence: [{ kind: "manual" as const, quote: "来自名词表", at: t.updatedAt }],
    }));
}

/** 写作节奏 → 工作习惯记忆（不进模型，只用于提示） */
function sessionsToMemory(sessions: { startedAt: string; wordsAdded: number }[]): { text: string }[] {
  if (sessions.length < 5) return [];
  const total = sessions.reduce((n, s) => n + Math.max(0, s.wordsAdded), 0);
  const avg = Math.round(total / sessions.length);
  const out: { text: string }[] = [];
  if (avg > 0) out.push({ text: `平均每次写作会话新增约 ${avg} 字` });
  const days = new Set(sessions.map((s) => s.startedAt.slice(0, 10))).size;
  if (days > 0) out.push({ text: `已在 ${days} 个不同日期写作过` });
  return out;
}

export interface ExtractOptions {
  projectId: ID;
  /** 是否扫描已解决/误报的问题（默认跳过，只统计未处理的） */
  includeResolvedIssues?: boolean;
}

/** 规则型提取：可反复运行，靠 dedupeKey 去重，只补新证据 */
export async function extractRuleBasedMemory(opts: ExtractOptions): Promise<MemoryExtraction> {
  const { projectId } = opts;
  void opts.includeResolvedIssues;

  const [feedback, issues, sessions, existing] = await Promise.all([
    listFeedback(projectId),
    listIssues(projectId),
    listSessions(projectId, 300),
    listMemory({ projectId, includePaused: true }),
  ]);
  const glossaryFacts = await glossaryToMemory(projectId);

  const existingByKey = new Map(existing.map((m) => [m.dedupeKey ?? memoryDedupeKey(m.kind, m.text), m]));
  const created: MemoryFact[] = [];
  const reinforced: { fact: MemoryFact; evidence: MemoryEvidence }[] = [];
  let skipped = 0;

  const put = async (
    kind: MemoryFact["kind"],
    text: string,
    evidenceList: MemoryEvidence[],
    scope: MemoryFact["scope"] = "project",
  ) => {
    const key = memoryDedupeKey(kind, text);
    const hit = existingByKey.get(key);
    if (hit) {
      // 已有这条记忆：把新证据补上去，提升可信度
      for (const ev of evidenceList.slice(0, 2)) {
        await reinforceMemory(hit.id, ev);
        reinforced.push({ fact: hit, evidence: ev });
      }
      skipped += 1;
      return;
    }
    const fact = await addMemory({
      scope,
      projectId: scope === "project" ? projectId : undefined,
      kind,
      text,
      source: kind === "insight" ? "metrics" : "feedback",
      evidence: evidenceList,
      note: "自动提取，可编辑或暂停",
    });
    existingByKey.set(key, fact);
    created.push(fact);
  };

  // 1) 差评理由 → 教训
  for (const item of feedbackToMemory(feedback.filter((f) => f.rating === -1))) {
    await put("lesson", item.text, [item.evidence]);
  }
  // 2) 反复出现的问题 → 偏好
  for (const item of issuesToMemory(issues)) {
    await put("preference", item.text, item.evidence);
  }
  // 3) 名词表 → 约定
  for (const item of glossaryFacts) {
    await put("convention", item.text, item.evidence);
  }
  // 4) 写作节奏 → 习惯（不进模型）
  for (const item of sessionsToMemory(sessions)) {
    await put("insight", item.text, [{ kind: "manual", quote: "来自写作会话统计", at: new Date().toISOString() }]);
  }

  return {
    created,
    reinforced,
    skipped,
    scanned: {
      feedback: feedback.length,
      suggestions: 0,
      issues: issues.length,
      review: 0,
      sessions: sessions.length,
    },
  };
}

/** ---------- 偏好型：模型归纳，只出候选 ---------- */

export interface PreferenceCandidate {
  kind: "preference" | "lesson";
  text: string;
  /** 模型给出的理由，展示用 */
  why: string;
  /** 支撑样本 */
  samples: string[];
}

/**
 * 让模型从"被采纳/被拒绝的改动"里归纳写作偏好。
 * **只返回候选**，由作者确认后才写入记忆 —— 模型归纳的偏好不准时，
 * 直接生效会让作者觉得"系统在乱记我的习惯"。
 */
export async function suggestPreferences(opts: {
  projectId: ID;
  signal?: AbortSignal;
}): Promise<{ ok: boolean; candidates: PreferenceCandidate[]; error?: string; scanned: number }> {
  const { runJson, systemWithProject } = await import("./runner");
  const { asArray, asString, pickStr } = await import("./json");

  const [suggestions, reviewSuggestions, feedback] = await Promise.all([
    db.suggestions.where("projectId").equals(opts.projectId).toArray(),
    db.reviewSuggestions.where("projectId").equals(opts.projectId).toArray(),
    listFeedback(opts.projectId),
  ]);

  const accepted = suggestions.filter((s) => s.status === "accepted");
  const rejected = suggestions.filter((s) => s.status === "rejected");
  const reviewAccepted = reviewSuggestions.filter((s) => s.status === "accepted");
  const reviewRejected = reviewSuggestions.filter((s) => s.status === "rejected");

  const samples: string[] = [];
  for (const s of accepted.slice(0, 6)) samples.push("【作者采纳】" + s.content.slice(0, 160));
  for (const s of reviewAccepted.slice(0, 6)) samples.push("【作者采纳修订】" + s.proposed.slice(0, 160));
  for (const s of rejected.slice(0, 6)) samples.push("【作者拒绝】" + s.content.slice(0, 160));
  for (const s of reviewRejected.slice(0, 6)) samples.push("【作者拒绝修订】" + s.proposed.slice(0, 160));
  for (const f of feedback.filter((x) => x.rating === -1 && x.note).slice(0, 6)) {
    samples.push("【作者差评理由】" + (f.note ?? "").slice(0, 160));
  }

  if (samples.length < 4) {
    return { ok: true, candidates: [], scanned: samples.length };
  }

  const system = await systemWithProject(
    opts.projectId,
    [
      "你在帮一位小说作者整理他自己的写作偏好。",
      "你会看到 AI 生成的段落中，哪些被他采纳、哪些被他拒绝，以及他给出的理由。",
      "请从中归纳出**可复用的写作偏好**：他喜欢什么、讨厌什么、要求 AI 怎么改。",
      "要求：",
      "- 每条偏好必须能被下次生成直接执行，例如「对话不要用解释性台词」，而不是「他比较在意对话」。",
      "- 宁可少而准：只写有 2 条以上样本支撑的；样本不足就不要写。",
      "- 不要复述差评原话，要归纳成规则；但也别过度泛化。",
      "- 最多 6 条。",
    ].join(NL),
  );

  const res = await runJson<Record<string, unknown>>({
    taskKind: "critique",
    projectId: opts.projectId,
    system,
    user: [
      "### 采纳与拒绝记录",
      samples.join(NL + NL),
      "",
      "### 输出格式",
      "只输出 JSON：",
      "{",
      '  "preferences": [',
      '    { "kind": "preference" 或 "lesson", "text": "一句话偏好，可直接进 system prompt", "why": "依据是什么（引用上面的记录）", "samples": ["支撑样本片段"] }',
      "  ]",
      "}",
    ].join(NL),
    jsonSchemaHint: "",
    context: { projectId: opts.projectId, sections: ["profile"], budget: 4000 },
    signal: opts.signal,
  });

  if (!res.ok || !res.parsed?.ok) {
    return { ok: false, candidates: [], error: res.error ?? "解析失败", scanned: samples.length };
  }
  const data = res.parsed.data as Record<string, unknown>;
  const candidates = asArray<Record<string, unknown>>(data.preferences ?? data)
    .map((r) => ({
      kind: (pickStr(r, "kind") === "lesson" ? "lesson" : "preference") as "preference" | "lesson",
      text: pickStr(r, "text", "preference"),
      why: pickStr(r, "why", "reason"),
      samples: asArray<unknown>(r.samples).map((x) => asString(x)).slice(0, 3),
    }))
    .filter((c) => c.text.length >= 6)
    .slice(0, 6);

  return { ok: true, candidates, scanned: samples.length };
}

/** 把章节摘要提取成"设定事实"候选（作者确认后写入） */
export async function suggestFactsFromChapters(projectId: ID): Promise<{ text: string; chapterId: ID; quote: string }[]> {
  const chapters = (await db.chapters.where("projectId").equals(projectId).toArray())
    .filter((c) => c.summary)
    .sort((a, b) => a.order - b.order)
    .slice(-20) as Chapter[];
  return chapters.map((c) => ({
    text: `第 ${c.order + 1} 章：${(c.summary ?? "").slice(0, 80)}`,
    chapterId: c.id,
    quote: c.summary ?? "",
  }));
}
