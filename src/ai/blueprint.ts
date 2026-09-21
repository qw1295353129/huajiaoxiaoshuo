import type { ID, StoryBlueprint } from "@/core";
import { db } from "@/db/database";
import { runJson, systemWithProject } from "./runner";
import { jsonInstruction } from "./prompts";
import { asArray, asNumber, asString, pickStr } from "./json";
import { countWords } from "@/utils/text";

const NL = String.fromCharCode(10);
/** 回车符。用字符码构造，避免在源码里写转义序列被工具链吃掉 */
const CR_CHAR = String.fromCharCode(13);

/**
 * 拆书：读一本参考书，提取可复用的写作技法与结构。
 *
 * 输入处理上有个现实约束：一本长篇动辄几十万字，不可能整本喂进去。
 * 做法是「开头全读 + 全文均匀取样」——开头决定视角、腔调、钩子；
 * 中后段决定节奏与结构。取样点都标出来，让模型知道自己在看片段而不是连续文本。
 */
const SAMPLE_BUDGET = 14000;
const OPENING_CHARS = 5000;

/** 从全文里取出有代表性的样本：开头连续 + 后续均匀取样 */
export function sampleText(text: string, budget = SAMPLE_BUDGET, opening = OPENING_CHARS): { text: string; sampled: boolean } {
  const clean = text.split(CR_CHAR).join(NL).trim();
  if (clean.length <= budget) return { text: clean, sampled: false };

  const head = clean.slice(0, opening);
  const rest = clean.slice(opening);
  const slots = 6;
  const perSlot = Math.floor((budget - opening) / slots);
  const step = Math.floor(rest.length / slots);
  const parts: string[] = ["【开头】" + head];
  for (let i = 0; i < slots; i++) {
    const start = i * step;
    const slice = rest.slice(start, start + perSlot);
    if (!slice.trim()) continue;
    const percent = Math.round(((opening + start) / clean.length) * 100);
    parts.push("【全文约 " + percent + "% 处】" + slice);
  }
  return { text: parts.join(NL + NL), sampled: true };
}

const TECHNIQUE_SCHEMA = [
  "{",
  '  "pov": "叙述视角与人称，以及镜头离主角多远",',
  '  "timeHandling": "时间处理：顺叙/倒叙/双线，跳转规律",',
  '  "proseStyle": "语言特征：句子长短、用词倾向、比喻密度、腔调",',
  '  "paragraphing": "段落与场景切分方式",',
  '  "informationRelease": "信息释放节奏（最重要）：什么时候给、什么时候藏",',
  '  "hooks": "开篇钩与章末钩分别怎么下",',
  '  "dialogueRatio": "对话与叙述的配比，对话承担什么功能",',
  '  "emotionalCurve": "情绪曲线：张力怎么起伏与铺垫",',
  '  "ensembleHandling": "配角与群像的处理方式",',
  '  "signatureMove": "这个作者最值得学的一招（一句话）"',
  "}",
].join(NL);

const CONTENT_SCHEMA = [
  "{",
  '  "genre": "题材与卖点",',
  '  "worldRulesShape": "有哪几类规则在起作用（不要记具体设定）",',
  '  "relationshipShape": "人物关系的拓扑结构（谁对立谁、谁欠谁，不要记人名）",',
  '  "plotEngine": "推动故事向前的核心机器是什么",',
  '  "actStructure": [ { "act": "第一幕", "function": "这一幕在做什么" } ],',
  '  "turningPoints": ["转折点的功能，不记具体事件"],',
  '  "endingType": "结局类型",',
  '  "readerExperience": "目标读者与阅读体验",',
  '  "chapterTemplate": [ { "role": "章节角色，如铺垫/升级/回收", "function": "这一章承担什么功能", "tension": 3 } ]',
  "}",
].join(NL);

export interface AnalyzeOptions {
  projectId: ID;
  sourceText: string;
  sourceTitle?: string;
  signal?: AbortSignal;
}

export interface AnalyzeResult {
  ok: boolean;
  blueprint?: StoryBlueprint;
  error?: string;
  model: string;
  sampled: boolean;
  sampleWords: number;
}

/** 拆书：产出技法层 + 内容层 */
export async function analyzeBlueprint(opts: AnalyzeOptions): Promise<AnalyzeResult> {
  const clean = opts.sourceText.split(CR_CHAR).join(NL).trim();
  if (countWords(clean) < 500) {
    return { ok: false, error: "样本太短（不足 500 字），拆不出结构。建议至少给一章正文或一份完整大纲。", model: "", sampled: false, sampleWords: 0 };
  }

  const { text: sample, sampled } = sampleText(clean);
  const sampleWords = countWords(clean);

  const system = await systemWithProject(
    opts.projectId,
    [
      "你是资深小说编辑，擅长把一本小说拆成可复用的写作技法。",
      "你的读者是写作者，他要学的是『这本书为什么好看』，不是『这本书讲了什么』。",
      "技法描述必须具体到能指导写作，例如『每章结尾抛一个新疑问，答案隔两章才给』，",
      "而不是『节奏紧凑』这种空话。",
      "分析情节结构时只描述功能（这一幕在做什么、这个转折改变了什么），不要复述具体事件。",
    ].join(NL),
  );

  const user = [
    "### 待拆解的参考文本",
    opts.sourceTitle ? "（来源标注：" + opts.sourceTitle + "）" : "",
    sampled ? "以下是节选：开头连续，之后按全文百分比均匀取样。" : "以下是全文。",
    "",
    sample,
    "",
    "### 任务",
    "把这本书拆成两部分。",
    "",
    "第一部分【技法层】：它怎么写出来的 —— 视角、时间处理、语言、段落、",
    "信息释放节奏、钩子、对话配比、情绪曲线、群像处理，以及这个作者最值得学的一招。",
    "",
    "第二部分【内容层】：它讲了什么类型的 story —— 题材、世界规则的种类、",
    "人物关系的拓扑、情节引擎、几幕结构、转折点的功能、结局类型、读者体验。",
    "**内容层只描述结构与功能，不要复述具体情节、不要写具体人名。**",
    "",
    "另外给出一个「章节功能模板」：这类书的一章通常承担什么功能，按顺序列 4~8 条。",
  ].join(NL);

  const res = await runJson<Record<string, unknown>>({
    taskKind: "blueprint",
    projectId: opts.projectId,
    system,
    user,
    jsonSchemaHint: jsonInstruction("{" + NL + '  "technique": ' + TECHNIQUE_SCHEMA + "," + NL + '  "content": ' + CONTENT_SCHEMA + NL + "}"),
    context: { projectId: opts.projectId, sections: ["profile"], budget: 4000 },
    signal: opts.signal,
  });

  if (!res.ok || !res.parsed?.ok) {
    return { ok: false, error: res.error ?? "模型输出不是合法 JSON", model: res.model, sampled, sampleWords };
  }

  const data = res.parsed.data as Record<string, unknown>;
  const t = (data.technique as Record<string, unknown>) ?? {};
  const c = (data.content as Record<string, unknown>) ?? {};

  const str = (o: Record<string, unknown>, k: string) => pickStr(o, k) || "（模型未给出）";

  const blueprint: StoryBlueprint = {
    technique: {
      pov: str(t, "pov"),
      timeHandling: str(t, "timeHandling"),
      proseStyle: str(t, "proseStyle"),
      paragraphing: str(t, "paragraphing"),
      informationRelease: str(t, "informationRelease"),
      hooks: str(t, "hooks"),
      dialogueRatio: str(t, "dialogueRatio"),
      emotionalCurve: str(t, "emotionalCurve"),
      ensembleHandling: str(t, "ensembleHandling"),
      signatureMove: str(t, "signatureMove"),
    },
    content: {
      genre: str(c, "genre"),
      worldRulesShape: str(c, "worldRulesShape"),
      relationshipShape: str(c, "relationshipShape"),
      plotEngine: str(c, "plotEngine"),
      actStructure: asArray<Record<string, unknown>>(c.actStructure)
        .map((a) => ({ act: pickStr(a, "act") || "一幕", function: pickStr(a, "function") }))
        .filter((a) => a.function)
        .slice(0, 8),
      turningPoints: asArray<unknown>(c.turningPoints).map((x) => asString(x)).filter(Boolean).slice(0, 12),
      endingType: str(c, "endingType"),
      readerExperience: str(c, "readerExperience"),
    },
    chapterTemplate: asArray<Record<string, unknown>>(c.chapterTemplate ?? data.chapterTemplate)
      .map((r) => ({
        role: pickStr(r, "role") || "章节",
        function: pickStr(r, "function"),
        tension: Math.max(1, Math.min(5, Math.round(asNumber(r.tension, 3)))),
      }))
      .filter((r) => r.function)
      .slice(0, 10),
    model: res.model,
    analyzedAt: new Date().toISOString(),
    sampleWords,
  };

  return { ok: true, blueprint, model: res.model, sampled, sampleWords };
}

/* ------------------------------------------------------------------ */
/* 按蓝图生成新作                                                      */
/* ------------------------------------------------------------------ */

export interface GenerateFromBlueprintOptions {
  projectId: ID;
  blueprint: StoryBlueprint;
  /** 作者的新点子 —— 这才是故事的来源 */
  premise: string;
  chapterCount?: number;
  wordsPerChapter?: number;
  signal?: AbortSignal;
}

export interface GeneratedStory {
  title: string;
  logline: string;
  premise: string;
  characters: { name: string; role: string; tagline?: string; want?: string; flaw?: string }[];
  world: { title: string; category: string; body: string; importance: number }[];
  rules: { title: string; statement: string; severity: string }[];
  arcs: { title: string; summary?: string; goal?: string; conflict?: string; outcome?: string }[];
  chapters: { title: string; summary?: string; tension?: number; hook?: string }[];
}

export interface GenerateFromBlueprintResult {
  ok: boolean;
  story?: GeneratedStory;
  error?: string;
  model: string;
}

const STORY_SCHEMA = [
  "{",
  '  "title": "书名（全新，不得与参考书相似）",',
  '  "logline": "一句话故事（25字内，要有钩子）",',
  '  "premise": "核心高概念（150字内）",',
  '  "characters": [ { "name": "全新中文姓名", "role": "protagonist|antagonist|deuteragonist|mentor|foil|love-interest|sidekick|minor", "tagline": "一句话定位", "want": "表层欲望", "flaw": "致命缺陷" } ],',
  '  "world": [ { "title": "全新条目名", "category": "geography|history|politics|magic|technology|religion|economy|species|culture|organization|item|language|custom", "body": "具体内容", "importance": 3 } ],',
  '  "rules": [ { "title": "规则名", "statement": "不可违反的硬规则", "severity": "error|warn|info" } ],',
  '  "arcs": [ { "title": "卷名", "summary": "本卷写什么", "goal": "主角目标", "conflict": "核心冲突", "outcome": "结束状态" } ],',
  '  "chapters": [ { "title": "章节标题", "summary": "本章发生什么", "tension": 3, "hook": "章末留下的问题" } ]',
  "}",
].join(NL);

/**
 * 按蓝图生成新作。
 *
 * 关键约束写在提示词里并反复强调：
 *  - 技法层全部照用（那是学来的手艺）
 *  - 内容层全部重做（人物、世界、事件、名字都不许沿用）
 *  - 不许出现参考书里的任何成句表述
 *
 * 生成完还会跑一次原创性自检（在 UI 层做，因为需要参考书原文）。
 */
export async function generateFromBlueprint(opts: GenerateFromBlueprintOptions): Promise<GenerateFromBlueprintResult> {
  const project = await db.projects.get(opts.projectId);
  const t = opts.blueprint.technique;
  const c = opts.blueprint.content;
  const chapters = Math.max(3, Math.min(60, opts.chapterCount ?? 12));
  const perChapter = Math.max(800, Math.min(6000, opts.wordsPerChapter ?? 2500));

  const system = await systemWithProject(
    opts.projectId,
    [
      "你是顶级故事策划。这次的任务是：用一套已经拆解好的写作技法，写一个**全新的故事**。",
      "必须严格遵守：",
      "1. 技法层（视角、节奏、信息释放、钩子、语言处理）要完全照做 —— 那是要学的手艺。",
      "2. 内容层必须全部重做：人物、姓名、世界设定、专有名词、具体事件，一个都不能沿用。",
      "3. 不得出现参考书里的任何成句表述；也不要把参考书的情节换个名字重写一遍。",
      "4. 故事的血肉来自作者给的新点子，技法只是组织方式。",
      "如果发现自己在复述参考书的情节，立刻换一个完全不同的走向。",
    ].join(NL),
  );

  const user = [
    "### 作者的创作点子（故事的来源）",
    opts.premise,
    "",
    "### 要照做的技法（来自参考书拆解）",
    "视角：" + t.pov,
    "时间处理：" + t.timeHandling,
    "语言：" + t.proseStyle,
    "段落与场景：" + t.paragraphing,
    "**信息释放节奏：" + t.informationRelease + "**",
    "钩子：" + t.hooks,
    "对话配比：" + t.dialogueRatio,
    "情绪曲线：" + t.emotionalCurve,
    "群像处理：" + t.ensembleHandling,
    "最值得学的一招：" + t.signatureMove,
    "",
    "### 结构参照（只借用骨架，不借用血肉）",
    "幕结构：" + (c.actStructure.map((a) => a.act + "=" + a.function).join("；") || "（无）"),
    "转折点功能：" + (c.turningPoints.join("；") || "（无）"),
    "情节引擎类型：" + c.plotEngine,
    "人物关系拓扑：" + c.relationshipShape,
    "结局类型：" + c.endingType,
    "",
    "### 章节功能模板（新作的每一章要承担类似功能，但内容全新）",
    opts.blueprint.chapterTemplate.map((r2, i) => i + 1 + ". [" + r2.role + "] " + r2.function + "（张力 " + r2.tension + "）").join(NL) || "（无）",
    "",
    "### 输出要求",
    "基于作者的点子，设计一个完整的新故事：",
    "- 3~7 位人物（含反派），姓名全新且与参考书无关",
    "- 6~12 条世界观条目，全部重新设计",
    "- 3~6 条世界硬规则",
    "- 分卷结构",
    "- " + chapters + " 章章节大纲，每章约 " + perChapter + " 字，章末都要留钩子",
    "",
    project ? "（本书标题可参考：" + project.title + "，但请以新设计为准）" : "",
  ].filter(Boolean).join(NL);

  const res = await runJson<Record<string, unknown>>({
    taskKind: "imitate",
    projectId: opts.projectId,
    system,
    user,
    jsonSchemaHint: jsonInstruction(STORY_SCHEMA),
    context: { projectId: opts.projectId, sections: ["profile"], budget: 4000 },
    signal: opts.signal,
  });

  if (!res.ok || !res.parsed?.ok) {
    return { ok: false, error: res.error ?? "模型输出不是合法 JSON", model: res.model };
  }

  const d = res.parsed.data as Record<string, unknown>;
  const story: GeneratedStory = {
    title: pickStr(d, "title") || "未命名",
    logline: pickStr(d, "logline"),
    premise: pickStr(d, "premise"),
    characters: asArray<Record<string, unknown>>(d.characters).map((r2) => ({
      name: pickStr(r2, "name"),
      role: pickStr(r2, "role") || "minor",
      tagline: pickStr(r2, "tagline") || undefined,
      want: pickStr(r2, "want") || undefined,
      flaw: pickStr(r2, "flaw") || undefined,
    })).filter((x) => x.name),
    world: asArray<Record<string, unknown>>(d.world).map((r2) => ({
      title: pickStr(r2, "title"),
      category: pickStr(r2, "category") || "custom",
      body: pickStr(r2, "body"),
      importance: Math.max(1, Math.min(5, Math.round(asNumber(r2.importance, 3)))),
    })).filter((x) => x.title && x.body),
    rules: asArray<Record<string, unknown>>(d.rules).map((r2) => ({
      title: pickStr(r2, "title"),
      statement: pickStr(r2, "statement"),
      severity: pickStr(r2, "severity") || "warn",
    })).filter((x) => x.title && x.statement),
    arcs: asArray<Record<string, unknown>>(d.arcs).map((r2) => ({
      title: pickStr(r2, "title"),
      summary: pickStr(r2, "summary") || undefined,
      goal: pickStr(r2, "goal") || undefined,
      conflict: pickStr(r2, "conflict") || undefined,
      outcome: pickStr(r2, "outcome") || undefined,
    })).filter((x) => x.title),
    chapters: asArray<Record<string, unknown>>(d.chapters).map((r2) => ({
      title: pickStr(r2, "title"),
      summary: pickStr(r2, "summary") || undefined,
      tension: Math.max(1, Math.min(5, Math.round(asNumber(r2.tension, 3)))),
      hook: pickStr(r2, "hook") || undefined,
    })).filter((x) => x.title),
  };

  return { ok: true, story, model: res.model };
}
