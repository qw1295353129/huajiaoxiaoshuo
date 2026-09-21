import type { Chapter, ChapterMetric, ID, Issue, IssueKind, IssueSeverity } from "@/core";
import { db } from "@/db/database";
import { clearIssues, listIssues, upsertIssue } from "@/db/repo/story";
import { listMetrics } from "@/db/repo/story";
import { auditThreads } from "@/db/repo/story";
import { findRepeats, similarity } from "@/utils/diff";
import { countWords, stripHtml } from "@/utils/text";
import { analyzeStyle, detectAiSmell, detectTypos, punctuationCheck } from "@/utils/style-analyzer";
import { runJson, systemWithProject } from "./runner";
import {
  PACING_SCHEMA, READER_SIM_SCHEMA, STYLE_CHECK_SCHEMA, VOICE_CHECK_SCHEMA,
  ZHI_JIAN_SCHEMA, jsonInstruction,
} from "./prompts";
import { asArray, asString, asNumber, normalizeSeverity, pickStr } from "./json";

const NL = String.fromCharCode(10);

export interface AnalysisRunOptions {
  projectId: ID;
  chapterId: ID;
  /** 只看新问题 */
  signal?: AbortSignal;
  /** 是否删掉该章节旧的 LLM 检测结果 */
  replaceExisting?: boolean;
}

export interface ConsistencyOutput {
  ok: boolean;
  issues: Issue[];
  error?: string;
  model: string;
  ms: number;
  promptTokens: number;
}

/**
 * 一致性检查：把本章与前文设定/摘要一起交给模型，要求它只报告有原文证据的矛盾。
 * 结果落库为 Issue，可在一致性报告页逐条处理。
 */
export async function checkConsistency(opts: AnalysisRunOptions): Promise<ConsistencyOutput> {
  const chapter = await db.chapters.get(opts.chapterId);
  const content = await db.chapterContents.get(opts.chapterId);
  if (!chapter || !content) return { ok: false, issues: [], error: "章节不存在", model: "", ms: 0, promptTokens: 0 };

  const text = content.text || stripHtml(content.html);
  if (countWords(text) < 50) {
    return { ok: true, issues: [], model: "", ms: 0, promptTokens: 0 };
  }

  const system = await systemWithProject(
    opts.projectId,
    [
      "你是长篇小说的责任编辑，专门负责抓前后矛盾。",
      "规则：只报告能用原文支撑的问题；不确定的不报；同一个小问题不要拆成多条。",
      "证据必须逐字摘录自本章正文，不得改写、不得拼接不相邻的句子。",
    ].join(NL),
  );

  const res = await runJson({
    taskKind: "consistency",
    projectId: opts.projectId,
    chapterId: opts.chapterId,
    system,
    user: [
      "### 待检章节正文",
      "第" + (chapter.order + 1) + "章 " + chapter.title,
      "",
      text,
      "",
      "### 检查要求",
      "对照上下文中的【人物设定】【世界观设定】【伏笔】【前文脉络】，找出本章与之矛盾之处。",
      "重点：人物性格或能力前后不符、时间先后错乱、世界观硬规则被违反、称呼或名词不统一、已死或不在场的人物出现、物品位置矛盾、视角越界。",
    ].join(NL),
    jsonSchemaHint: jsonInstruction(ZHI_JIAN_SCHEMA),
    context: {
      projectId: opts.projectId,
      chapterId: opts.chapterId,
      sections: ["profile", "characters", "world", "rules", "threads", "timeline", "history"],
      query: text.slice(0, 1200),
    },
    signal: opts.signal,
  });

  if (!res.ok || !res.parsed?.ok) {
    return { ok: false, issues: [], error: res.error ?? "解析失败", model: res.model, ms: res.ms, promptTokens: res.usage.prompt };
  }

  const data = res.parsed.data as Record<string, unknown>;
  const raw = asArray<Record<string, unknown>>(data.issues ?? data.problems ?? data);

  if (opts.replaceExisting !== false) {
    const existing = await listIssues(opts.projectId, { chapterId: opts.chapterId });
    for (const i of existing) {
      if (i.detector === "llm-consistency") await db.issues.delete(i.id);
    }
  }

  const issues: Issue[] = [];
  for (const r of raw.slice(0, 40)) {
    const quote = pickStr(r, "quote") || pickStr((r.evidence as Record<string, unknown>) ?? {}, "quote", "text");
    const evidence = quote ? locateQuote(text, quote) : undefined;
    const conflicts = (r.conflictsWith as Record<string, unknown>) ?? {};
    const saved = await upsertIssue({
      projectId: opts.projectId,
      chapterId: opts.chapterId,
      kind: normalizeKind(pickStr(r, "kind", "type")),
      severity: normalizeSeverity(r.severity ?? r.level),
      title: pickStr(r, "title", "问题") || "未命名问题",
      detail: pickStr(r, "detail", "说明", "description"),
      evidence: evidence ? { quote: evidence.quote, from: evidence.from, to: evidence.to } : quote ? { quote } : undefined,
      conflictsWith: {
        label: pickStr(conflicts, "label", "名称") || undefined,
        quote: pickStr(conflicts, "quote", "原文") || undefined,
      },
      suggestion: pickStr(r, "suggestion", "建议", "fix") || undefined,
      fixPrompt: pickStr(r, "fixPrompt", "改写指令") || undefined,
      status: "open",
      source: "llm",
      detector: "llm-consistency",
    });
    issues.push(saved);
  }

  return { ok: true, issues, model: res.model, ms: res.ms, promptTokens: res.usage.prompt };
}

/** 把模型引用的句子定位回原文偏移，便于编辑器里高亮跳转 */
export function locateQuote(text: string, quote: string): { quote: string; from: number; to: number } | undefined {
  const q = quote.trim();
  if (!q) return undefined;
  let idx = text.indexOf(q);
  if (idx >= 0) return { quote: q, from: idx, to: idx + q.length };
  // 去标点后再找
  const stripped = q.replace(/[\s，。、；：？！""''（）]/g, "");
  if (stripped.length >= 6) {
    const compact = text.replace(/\s/g, "");
    const ci = compact.indexOf(stripped);
    if (ci >= 0) {
      // 近似映射回原偏移
      let count = 0;
      for (let i = 0; i < text.length; i++) {
        if (!/\s/.test(text[i])) {
          if (count === ci) return { quote: text.slice(i, Math.min(text.length, i + q.length + 10)), from: i, to: Math.min(text.length, i + q.length + 10) };
          count += 1;
        }
      }
    }
  }
  // 取前 12 字做锚点
  const head = q.slice(0, 12);
  idx = text.indexOf(head);
  if (idx >= 0) return { quote: text.slice(idx, idx + q.length), from: idx, to: Math.min(text.length, idx + q.length) };
  return undefined;
}

function normalizeKind(v: string): IssueKind {
  const s = v.toLowerCase();
  const allowed: IssueKind[] = [
    "continuity", "character-voice", "timeline", "world-rule", "name-variant",
    "pov", "style", "pacing", "repetition", "logic", "foreshadow", "grammar", "sensitive",
  ];
  if (allowed.includes(s as IssueKind)) return s as IssueKind;
  if (/timeline|时间/.test(s)) return "timeline";
  if (/voice|口吻|语气/.test(s)) return "character-voice";
  if (/world|设定|规则/.test(s)) return "world-rule";
  if (/name|称呼|名词/.test(s)) return "name-variant";
  if (/pov|视角/.test(s)) return "pov";
  if (/foreshadow|伏笔/.test(s)) return "foreshadow";
  return "continuity";
}

// ==================== 本地体检（不消耗 token） ====================

export interface LocalAudit {
  chapterId: ID;
  chapterTitle: string;
  order: number;
  wordCount: number;
  style: ReturnType<typeof analyzeStyle>;
  aiSmell: ReturnType<typeof detectAiSmell>;
  typos: ReturnType<typeof detectTypos>;
  punctuation: ReturnType<typeof punctuationCheck>;
  repeats: ReturnType<typeof findRepeats>;
  similarTo: { chapterId: ID; title: string; similarity: number }[];
}

/** 单章本地体检：文风、AI 味、错别字、标点、重复片段、与前章的相似度 */
export async function localAudit(projectId: ID, chapterId: ID): Promise<LocalAudit | undefined> {
  const [chapter, content] = await Promise.all([db.chapters.get(chapterId), db.chapterContents.get(chapterId)]);
  if (!chapter || !content) return undefined;
  const text = content.text || stripHtml(content.html);

  const chapters = await db.chapters.where("projectId").equals(projectId).toArray();
  const others = chapters.filter((c) => c.id !== chapterId);
  const similarTo: { chapterId: ID; title: string; similarity: number }[] = [];
  for (const o of others) {
    const oc = await db.chapterContents.get(o.id);
    if (!oc?.text || oc.text.length < 200) continue;
    const sim = similarity(text.slice(0, 3000), oc.text.slice(0, 3000));
    if (sim > 0.25) similarTo.push({ chapterId: o.id, title: o.title, similarity: sim });
  }
  similarTo.sort((a, b) => b.similarity - a.similarity);

  return {
    chapterId,
    chapterTitle: chapter.title,
    order: chapter.order,
    wordCount: countWords(text),
    style: analyzeStyle(text),
    aiSmell: detectAiSmell(text, 12),
    typos: detectTypos(text),
    punctuation: punctuationCheck(text),
    repeats: findRepeats(text, 9, 3, 12),
    similarTo: similarTo.slice(0, 3),
  };
}

/** 把本地体检的发现写进问题库 */
export async function persistLocalAudit(projectId: ID, audit: LocalAudit): Promise<Issue[]> {
  const existing = await listIssues(projectId, { chapterId: audit.chapterId });
  for (const i of existing) {
    if (i.detector === "local-audit") await db.issues.delete(i.id);
  }
  const created: Issue[] = [];

  for (const hit of audit.aiSmell.slice(0, 8)) {
    created.push(
      await upsertIssue({
        projectId,
        chapterId: audit.chapterId,
        kind: "style",
        severity: hit.score >= 3 ? "warn" : "info",
        title: "疑似 AI 腔：" + hit.reason,
        detail: "这句话的写法容易让读者感到套话。",
        evidence: { quote: hit.quote },
        suggestion: "用具体动作或细节替换这类套话表达。",
        source: "heuristic",
        detector: "local-audit",
      }),
    );
  }
  for (const t of audit.typos.slice(0, 10)) {
    created.push(
      await upsertIssue({
        projectId,
        chapterId: audit.chapterId,
        kind: "grammar",
        severity: "warn",
        title: "疑似误写：「" + t.wrong + "」",
        detail: t.note + "，建议改为「" + t.right + "」。",
        evidence: { quote: t.wrong },
        suggestion: "改为「" + t.right + "」",
        source: "heuristic",
        detector: "local-audit",
      }),
    );
  }
  for (const p of audit.punctuation) {
    created.push(
      await upsertIssue({
        projectId,
        chapterId: audit.chapterId,
        kind: "grammar",
        severity: "info",
        title: "标点规范：" + p.kind,
        detail: "发现 " + p.count + " 处。" + p.advice,
        source: "heuristic",
        detector: "local-audit",
      }),
    );
  }
  for (const r of audit.repeats.slice(0, 6)) {
    created.push(
      await upsertIssue({
        projectId,
        chapterId: audit.chapterId,
        kind: "repetition",
        severity: "warn",
        title: "重复片段：" + r.phrase,
        detail: "同一片段出现 " + r.count + " 次，读起来会显得啰嗦。",
        evidence: { quote: r.phrase },
        suggestion: "保留最有力的一次，其余改写或删除。",
        source: "heuristic",
        detector: "local-audit",
      }),
    );
  }
  for (const s of audit.similarTo) {
    if (s.similarity < 0.4) continue;
    created.push(
      await upsertIssue({
        projectId,
        chapterId: audit.chapterId,
        kind: "repetition",
        severity: "warn",
        title: "与「" + s.title + "」高度相似",
        detail: "相似度 " + Math.round(s.similarity * 100) + "%，可能存在自我重复。",
        source: "heuristic",
        detector: "local-audit",
      }),
    );
  }
  return created;
}

// ==================== 项目级宏观审计 ====================

export interface MacroAudit {
  totalWords: number;
  chapterCount: number;
  avgChapterWords: number;
  /** 字数分布是否均衡 */
  wordSpread: { chapterId: ID; title: string; words: number; order: number }[];
  tensionCurve: { order: number; tension: number; title: string }[];
  dialogueCurve: { order: number; dialogueRatio: number }[];
  threadProblems: { title: string; problem: string; detail: string }[];
  staleCharacters: { id: ID; name: string; lastOrder: number; gap: number }[];
  issueCounts: Record<IssueSeverity, number>;
  droppedThreads: string[];
}

/** 宏观审计：完全离线，读指标 + 伏笔 + 出场统计 */
export async function macroAudit(projectId: ID): Promise<MacroAudit> {
  const chapters = (await db.chapters.where("projectId").equals(projectId).toArray()).sort((a, b) => a.order - b.order);
  const metrics = await listMetrics(projectId);
  const metricsByChapter = new Map(metrics.map((m) => [m.chapterId, m]));
  const totalWords = chapters.reduce((n, c) => n + c.wordCount, 0);

  const threadProblems = (await auditThreads(projectId)).map((t) => ({
    title: t.thread.title,
    problem: t.problem,
    detail: t.detail,
  }));

  const characters = await db.characters.where("projectId").equals(projectId).toArray();
  const appearances = await db.characterAppearances.where("projectId").equals(projectId).toArray().catch(() => []);
  const maxOrder = chapters.length ? chapters[chapters.length - 1].order : 0;
  const staleCharacters: MacroAudit["staleCharacters"] = [];
  if (appearances.length) {
    for (const c of characters) {
      if (c.role === "cameo" || c.role === "minor") continue;
      const orders = appearances
        .filter((a) => a.characterId === c.id)
        .map((a) => chapters.find((ch) => ch.id === a.chapterId)?.order)
        .filter((o): o is number => o !== undefined);
      const lastOrder = orders.length ? Math.max(...orders) : -1;
      const gap = lastOrder < 0 ? maxOrder + 1 : maxOrder - lastOrder;
      if (gap >= 12) staleCharacters.push({ id: c.id, name: c.name, lastOrder, gap });
    }
  }
  staleCharacters.sort((a, b) => b.gap - a.gap);

  const issues = await listIssues(projectId);
  const issueCounts: Record<IssueSeverity, number> = { blocker: 0, error: 0, warn: 0, info: 0 };
  for (const i of issues) {
    if (i.status === "open" || i.status === "ignored") issueCounts[i.severity] += 1;
  }

  const droppedThreads = threadProblems.filter((t) => t.problem === "overdue").map((t) => t.title);

  return {
    totalWords,
    chapterCount: chapters.length,
    avgChapterWords: chapters.length ? Math.round(totalWords / chapters.length) : 0,
    wordSpread: chapters.map((c) => ({ chapterId: c.id, title: c.title, words: c.wordCount, order: c.order })),
    tensionCurve: chapters.map((c) => ({
      order: c.order,
      tension: metricsByChapter.get(c.id)?.tension ?? c.tension ?? 0,
      title: c.title,
    })),
    dialogueCurve: chapters.map((c) => ({
      order: c.order,
      dialogueRatio: metricsByChapter.get(c.id)?.dialogueRatio ?? 0,
    })),
    threadProblems,
    staleCharacters: staleCharacters.slice(0, 12),
    issueCounts,
    droppedThreads,
  };
}

// ==================== LLM 深度分析 ====================

export interface StyleCheckResult {
  score: number;
  dimensions: Record<string, { score: number; comment: string }>;
  aiSmell: { quote: string; why: string; rewrite: string }[];
  topFixes: string[];
}

/** 文风检查：与作者自己的文风指纹对比 */
export async function checkStyle(projectId: ID, chapterId: ID, signal?: AbortSignal) {
  const [chapter, content] = await Promise.all([db.chapters.get(chapterId), db.chapterContents.get(chapterId)]);
  if (!chapter || !content) return { ok: false as const, error: "章节不存在" };
  const fp = (await db.styles.where("projectId").equals(projectId).toArray()).sort((a, b) => (a.computedAt < b.computedAt ? 1 : -1))[0];

  const system = await systemWithProject(
    projectId,
    "你是文体分析专家。你评估的是文字本身的质量与一致性，不评价剧情。你的判断必须有原文依据。",
  );

  const res = await runJson({
    taskKind: "style-check",
    projectId,
    chapterId,
    system,
    user: [
      "### 待检正文",
      content.text,
      "",
      "### 任务",
      fp ? "作者的整体文风画像：" + fp.prompt : "（尚无文风画像，请按通用文学标准评估）",
      "请评估本章的语言质量，并指出与作者既有文风不一致或带明显机器味的地方。",
    ].join(NL),
    jsonSchemaHint: jsonInstruction(STYLE_CHECK_SCHEMA),
    context: { projectId, chapterId, sections: ["profile", "style"], query: content.text.slice(0, 600) },
    signal,
  });

  if (!res.ok || !res.parsed?.ok) return { ok: false as const, error: res.error ?? "解析失败" };
  const d = res.parsed.data as Record<string, unknown>;
  const dims: Record<string, { score: number; comment: string }> = {};
  const rawDims = (d.dimensions as Record<string, unknown>) ?? {};
  for (const [k, v] of Object.entries(rawDims)) {
    const o = v as Record<string, unknown>;
    dims[k] = { score: asNumber(o?.score), comment: pickStr(o ?? {}, "comment", "说明") };
  }
  const result: StyleCheckResult = {
    score: asNumber(d.score),
    dimensions: dims,
    aiSmell: asArray<Record<string, unknown>>(d.aiSmell).map((x) => ({
      quote: pickStr(x, "quote"),
      why: pickStr(x, "why"),
      rewrite: pickStr(x, "rewrite"),
    })),
    topFixes: asArray<unknown>(d.topFixes).map((x) => asString(x)),
  };
  return { ok: true as const, result, model: res.model };
}

export interface VoiceDeviation {
  character: string;
  quote: string;
  why: string;
  suggested: string;
}

/** 人物口吻校验：找出"不像他/她说的话" */
export async function checkVoice(projectId: ID, chapterId: ID, signal?: AbortSignal) {
  const [chapter, content] = await Promise.all([db.chapters.get(chapterId), db.chapterContents.get(chapterId)]);
  if (!chapter || !content) return { ok: false as const, error: "章节不存在" };
  if (!chapter.characterIds.length) return { ok: true as const, deviations: [] as VoiceDeviation[], note: "本章未标注出场人物" };

  const system = await systemWithProject(
    projectId,
    [
      "你专注做一件事：判断台词是否符合该人物的说话方式。",
      "判定依据只有上下文里给出的人物卡（口癖、语域、爱用词、绝不会说的话、台词样例）。",
      "台词符合人设就不要报。只报明显不像的。",
    ].join(NL),
  );

  const res = await runJson({
    taskKind: "voice-check",
    projectId,
    chapterId,
    system,
    user: ["### 本章正文", content.text, "", "### 任务", "逐句检查所有台词，找出与人设不符的地方。"].join(NL),
    jsonSchemaHint: jsonInstruction(VOICE_CHECK_SCHEMA),
    context: { projectId, chapterId, sections: ["profile", "characters"], query: content.text.slice(0, 400) },
    signal,
  });

  if (!res.ok || !res.parsed?.ok) return { ok: false as const, error: res.error ?? "解析失败" };
  const d = res.parsed.data as Record<string, unknown>;
  const deviations = asArray<Record<string, unknown>>(d.deviations).map((x) => ({
    character: pickStr(x, "character", "人物"),
    quote: pickStr(x, "quote", "台词"),
    why: pickStr(x, "why", "原因"),
    suggested: pickStr(x, "suggested", "建议"),
  }));
  return { ok: true as const, deviations };
}

/** 节奏分析 */
export async function checkPacing(projectId: ID, chapterId: ID, signal?: AbortSignal) {
  const [chapter, content] = await Promise.all([db.chapters.get(chapterId), db.chapterContents.get(chapterId)]);
  if (!chapter || !content) return { ok: false as const, error: "章节不存在" };
  const system = await systemWithProject(projectId, "你是节奏诊断专家。你关注读者的注意力曲线，指出哪里会让人想跳过、哪里太快没交代清楚。");
  const res = await runJson({
    taskKind: "pacing",
    projectId,
    chapterId,
    system,
    user: ["### 待检正文", content.text, "", "### 任务", "分析本章节奏，指出拖沓与过快的位置。"].join(NL),
    jsonSchemaHint: jsonInstruction(PACING_SCHEMA),
    context: { projectId, chapterId, sections: ["profile", "outline"], query: content.text.slice(0, 400) },
    signal,
  });
  if (!res.ok || !res.parsed?.ok) return { ok: false as const, error: res.error ?? "解析失败" };
  const d = res.parsed.data as Record<string, unknown>;
  return {
    ok: true as const,
    pacingScore: asNumber(d.pacingScore),
    segments: asArray<Record<string, unknown>>(d.segments).map((s) => ({
      from: pickStr(s, "from"), to: pickStr(s, "to"), pace: pickStr(s, "pace"), comment: pickStr(s, "comment"),
    })),
    sagging: asArray<Record<string, unknown>>(d.sagging).map((s) => ({
      where: pickStr(s, "where"), why: pickStr(s, "why"), cut: pickStr(s, "cut"),
    })),
    rushed: asArray<Record<string, unknown>>(d.rushed).map((s) => ({
      where: pickStr(s, "where"), why: pickStr(s, "why"), expand: pickStr(s, "expand"),
    })),
  };
}

/** 读者模拟：预测读者在哪里弃书 */
export async function readerSimulation(projectId: ID, chapterId: ID, persona?: string, signal?: AbortSignal) {
  const [chapter, content] = await Promise.all([db.chapters.get(chapterId), db.chapterContents.get(chapterId)]);
  if (!chapter || !content) return { ok: false as const, error: "章节不存在" };
  const personaText = persona ?? "一个用手机在地铁上读网文的 25 岁读者，注意力只有 3 分钟，随时可能划走";
  const system = await systemWithProject(
    projectId,
    "你现在不是编辑，而是读者。你要诚实地报告：什么地方你会走神、什么会让你想继续读、什么会让你直接关掉。不客气但也不刻薄。",
  );
  const res = await runJson({
    taskKind: "reader-sim",
    projectId,
    chapterId,
    system,
    user: ["### 你的身份", personaText, "", "### 你正在读的章节", content.text, "", "### 任务", "报告你的真实阅读体验。"].join(NL),
    jsonSchemaHint: jsonInstruction(READER_SIM_SCHEMA),
    context: { projectId, chapterId, sections: ["profile", "characters"], query: content.text.slice(0, 400) },
    signal,
  });
  if (!res.ok || !res.parsed?.ok) return { ok: false as const, error: res.error ?? "解析失败" };
  const d = res.parsed.data as Record<string, unknown>;
  return {
    ok: true as const,
    persona: personaText,
    engagement: asNumber(d.engagement),
    curve: asArray<Record<string, unknown>>(d.curve).map((c) => ({
      at: pickStr(c, "at"), interest: asNumber(c.interest), emotion: pickStr(c, "emotion"),
    })),
    dropoutRisks: asArray<Record<string, unknown>>(d.dropoutRisks).map((c) => ({
      at: pickStr(c, "at"), reason: pickStr(c, "reason"), fix: pickStr(c, "fix"),
    })),
    highlights: asArray<unknown>(d.highlights).map((x) => asString(x)),
    prediction: pickStr(d, "prediction"),
  };
}

/** 生成"接下来可能发生什么"的场景级建议（用于大纲页） */
export async function suggestScenes(projectId: ID, chapterId: ID, count = 5, signal?: AbortSignal) {
  const chapter = await db.chapters.get(chapterId);
  if (!chapter) return { ok: false as const, error: "章节不存在" };
  const system = await systemWithProject(projectId, "你是擅长设计场景的编剧。每个建议都要是一个可以被写出来的具体场景，包含地点、冲突与转折。");
  const res = await runJson({
    taskKind: "brainstorm",
    projectId,
    chapterId,
    system,
    user: [
      "### 当前章节",
      "第" + (chapter.order + 1) + "章 " + chapter.title,
      chapter.summary ?? "",
      "",
      "### 任务",
      "给出 " + count + " 个本章可以展开的具体场景，每个都要说明它推进了什么、制造了什么悬念。",
    ].join(NL),
    jsonSchemaHint: jsonInstruction(
      "{" + NL + '  "scenes": [ { "title": "场景名", "where": "地点", "who": ["在场人物"], "conflict": "冲突", "turn": "转折", "advance": "推进了什么", "hook": "留下的悬念" } ]' + NL + "}",
    ),
    context: { projectId, chapterId, sections: ["profile", "outline", "characters", "threads"] },
    signal,
  });
  if (!res.ok || !res.parsed?.ok) return { ok: false as const, error: res.error ?? "解析失败" };
  const d = res.parsed.data as Record<string, unknown>;
  return {
    ok: true as const,
    scenes: asArray<Record<string, unknown>>(d.scenes).map((s) => ({
      title: pickStr(s, "title"),
      where: pickStr(s, "where"),
      who: asArray<unknown>(s.who).map((x) => asString(x)),
      conflict: pickStr(s, "conflict"),
      turn: pickStr(s, "turn"),
      advance: pickStr(s, "advance"),
      hook: pickStr(s, "hook"),
    })),
  };
}

/** 伏笔审计：LLM 视角的补充（本地 auditThreads 负责硬规则） */
export async function auditForeshadowing(projectId: ID, signal?: AbortSignal) {
  const threads = await db.plotThreads.where("projectId").equals(projectId).toArray();
  const active = threads.filter((t) => t.status !== "resolved" && t.status !== "abandoned");
  if (!active.length) return { ok: true as const, findings: [] as { title: string; problem: string; advice: string }[] };
  const system = await systemWithProject(projectId, "你是长篇结构编辑，专门检查伏笔是否埋得下、收得回、读者是否还能记住。");
  const res = await runJson({
    taskKind: "foreshadow-audit",
    projectId,
    system,
    user: [
      "### 待审伏笔清单",
      active.map((t) => "- " + t.title + "：" + (t.description ?? "") + "（优先级 " + t.priority + "）").join(NL),
      "",
      "### 任务",
      "指出哪些伏笔有风险（埋得太隐晦、回收太晚、彼此冲突、读者已遗忘），并给出处理建议。",
    ].join(NL),
    jsonSchemaHint: jsonInstruction("{" + NL + '  "findings": [ { "title": "伏笔名", "problem": "风险", "advice": "建议" } ]' + NL + "}"),
    context: { projectId, sections: ["profile", "threads", "outline", "history"] },
    signal,
  });
  if (!res.ok || !res.parsed?.ok) return { ok: false as const, error: res.error ?? "解析失败" };
  const d = res.parsed.data as Record<string, unknown>;
  return {
    ok: true as const,
    findings: asArray<Record<string, unknown>>(d.findings).map((f) => ({
      title: pickStr(f, "title"), problem: pickStr(f, "problem"), advice: pickStr(f, "advice"),
    })),
  };
}

/** 一次性把某章所有本地+LLM 检查跑完，写进问题库 */
export async function fullChapterReview(
  projectId: ID,
  chapterId: ID,
  opts: { llm?: boolean; signal?: AbortSignal; onProgress?: (stage: string) => void } = {},
) {
  const steps: { stage: string; ok: boolean; count?: number; error?: string }[] = [];
  opts.onProgress?.("本地体检");
  const audit = await localAudit(projectId, chapterId);
  if (audit) {
    const created = await persistLocalAudit(projectId, audit);
    steps.push({ stage: "本地体检", ok: true, count: created.length });
  } else {
    steps.push({ stage: "本地体检", ok: false, error: "章节不存在" });
  }

  if (opts.llm) {
    opts.onProgress?.("一致性检查");
    const c = await checkConsistency({ projectId, chapterId, signal: opts.signal });
    steps.push({ stage: "一致性检查", ok: c.ok, count: c.issues.length, error: c.error });

    opts.onProgress?.("口吻检查");
    const v = await checkVoice(projectId, chapterId, opts.signal);
    if (v.ok) {
      for (const d of v.deviations) {
        await upsertIssue({
          projectId, chapterId, kind: "character-voice", severity: "warn",
          title: d.character + " 的台词不像他本人",
          detail: d.why,
          evidence: { quote: d.quote },
          suggestion: d.suggested,
          source: "llm", detector: "llm-voice",
        });
      }
      steps.push({ stage: "口吻检查", ok: true, count: v.deviations.length });
    } else {
      steps.push({ stage: "口吻检查", ok: false, error: v.error });
    }
  }

  return steps;
}

/** 批量计算章节指标（离线），供曲线图使用 */
export async function recomputeMetrics(projectId: ID, onProgress?: (done: number, total: number) => void): Promise<number> {
  const chapters = (await db.chapters.where("projectId").equals(projectId).toArray()).sort((a, b) => a.order - b.order);
  let done = 0;
  for (const c of chapters) {
    const content = await db.chapterContents.get(c.id);
    if (!content) continue;
    const style = analyzeStyle(content.text);
    const metric: Omit<ChapterMetric, "id" | "computedAt"> = {
      projectId,
      chapterId: c.id,
      order: c.order,
      wordCount: countWords(content.text),
      dialogueRatio: style.dialogueRatio,
      avgSentenceLength: style.avgSentenceLength,
      tension: metricTension(content.text, style.dialogueRatio, style.avgSentenceLength),
      castIds: c.characterIds,
      newEntities: 0,
    };
    await db.metrics.put({ ...metric, id: projectId + "::" + c.id, computedAt: new Date().toISOString() });
    done += 1;
    onProgress?.(done, chapters.length);
  }
  return done;
}

/** 张力估算：冲突词密度 + 短句比例 + 感叹问句 */
export function metricTension(text: string, dialogueRatio: number, avgSentenceLength: number): number {
  const t = stripHtml(text);
  if (!t) return 0;
  const conflict = (t.match(/杀|打|冲|吼|怒|血|炸|碎|断|死|逃|追|逼|夺|吼|摔|撕|痛/g) ?? []).length;
  const per1000 = (conflict / Math.max(1, countWords(t))) * 1000;
  const shortBonus = avgSentenceLength < 14 ? 1.2 : avgSentenceLength > 24 ? -0.8 : 0;
  const dialogueBonus = (dialogueRatio - 0.3) * 3;
  const raw = per1000 * 0.55 + shortBonus + dialogueBonus;
  return Math.max(-5, Math.min(5, Math.round(raw * 10) / 10));
}

export { clearIssues, similarity, countWords };
