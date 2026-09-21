import type { Character, ID, WorldCategory } from "@/core";
import { db } from "@/db/database";
import { listCharacters } from "@/db/repo/cast";
import { runJson, systemWithProject } from "./runner";
import { jsonInstruction } from "./prompts";
import { asArray, asNumber, asString, pickStr } from "./json";

const NL = String.fromCharCode(10);

/**
 * 按需生成：人物 / 世界观条目。
 *
 * 为什么要有这个模块（而不是复用一句话成书）：
 * 「一句话成书」是五阶段流水线，会连带改书名、分卷、章节，代价很大。
 * 而作者常常只想"再给我加几个反派"或"补几条力量体系设定" ——
 * 用一个轻量、只碰当前页面的生成入口更合适。
 *
 * 共同设计原则（和一句话成书保持一致）：
 *  - 只生成候选，落库由对话框在作者勾选后进行；
 *  - 生成时把"已有人物名 / 已有条目名"喂给模型，让它避开重复；
 *  - 落库时仍然按名字匹配，命中就更新 —— 重复点击不会产生重复数据。
 */

/** 已存在的东西，喂给模型避免重复，落库时也用它做匹配 */
async function existingSnapshot(projectId: ID): Promise<{ characterNames: string[]; worldTitles: string[] }> {
  const [chars, worlds] = await Promise.all([
    listCharacters(projectId),
    db.worldEntries.where("projectId").equals(projectId).toArray(),
  ]);
  return {
    characterNames: chars.map((c) => c.name),
    worldTitles: worlds.map((w) => w.title),
  };
}

export interface GeneratedCharacter {
  name: string;
  role: Character["role"];
  tagline?: string;
  age?: string;
  gender?: string;
  appearance?: string;
  personality?: string;
  want?: string;
  need?: string;
  fear?: string;
  flaw?: string;
  arc?: string;
  secrets?: string;
  aliases: string[];
  voice: {
    tone?: string;
    verbalTics: string[];
    favoriteWords: string[];
    neverSays: string[];
    register?: string;
    sampleLines: string[];
  };
}

const CHARACTER_SCHEMA = [
  "{",
  '  "characters": [ {',
  '    "name": "中文姓名（符合题材）",',
  '    "role": "protagonist|antagonist|deuteragonist|mentor|foil|love-interest|sidekick|minor",',
  '    "tagline": "一句话定位", "age": "年龄", "gender": "性别",',
  '    "appearance": "外貌（具体到可写进正文）", "personality": "性格（必须含矛盾面）",',
  '    "want": "表层欲望", "need": "深层需要", "fear": "恐惧", "flaw": "致命缺陷",',
  '    "arc": "人物弧光", "secrets": "秘密", "aliases": ["别名或称呼"],',
  '    "voice": { "tone": "语气", "verbalTics": ["口癖"], "favoriteWords": ["常用词"], "neverSays": ["绝不会说的话"], "register": "语域", "sampleLines": ["示例台词"] }',
  "  } ]",
  "}",
].join(NL);

export interface GenerateCharactersOptions {
  projectId: ID;
  /** 作者对这批人物的要求，例如"再给我两个反派，要有师徒关系" */
  instruction?: string;
  /** 想要几个 */
  count?: number;
  signal?: AbortSignal;
}

export interface GenerateCharactersResult {
  ok: boolean;
  characters: GeneratedCharacter[];
  /** 本次生成时已存在的人物名，用于落库时匹配 */
  existingNames: string[];
  model: string;
  error?: string;
}

function normalizeRole(v: string): Character["role"] {
  const s = v.toLowerCase();
  if (/protagonist|主角/.test(s)) return "protagonist";
  if (/antagonist|反派/.test(s)) return "antagonist";
  if (/deuteragonist|第二/.test(s)) return "deuteragonist";
  if (/mentor|导师/.test(s)) return "mentor";
  if (/love|情感|恋人/.test(s)) return "love-interest";
  if (/foil|对照/.test(s)) return "foil";
  if (/sidekick|伙伴/.test(s)) return "sidekick";
  if (/cameo|龙套/.test(s)) return "cameo";
  return "minor";
}

export async function generateCharacters(opts: GenerateCharactersOptions): Promise<GenerateCharactersResult> {
  const project = await db.projects.get(opts.projectId);
  const { characterNames } = await existingSnapshot(opts.projectId);
  const count = Math.max(1, Math.min(8, opts.count ?? 3));

  const system = await systemWithProject(
    opts.projectId,
    [
      "你是人物设计师，擅长设计欲望互相冲突、能自然产生戏剧的人物群像。",
      "每个人物必须有『想要什么』与『真正需要什么』之间的落差，以及一个会害到自己的缺陷。",
      "不要写「性格复杂」「亦正亦邪」这类空话，要写具体到能直接落笔的细节。",
      "口吻卡要能让人一眼分辨出这个人怎么说话：给出口癖、常用词、绝不会说的话。",
    ].join(NL),
  );

  const user = [
    project ? "### 这本书" : "",
    project ? [project.title, project.logline, project.synopsis, project.styleGuide].filter(Boolean).join(NL) : "",
    "",
    characterNames.length ? "### 已经有的人物（不要重复设计这些人，也不要给他们改名字）" : "### 目前还没有任何人物",
    characterNames.length ? characterNames.join("、") : "",
    "",
    "### 本次要求",
    opts.instruction?.trim() || "围绕这本书的核心冲突，补齐还缺的关键角色。",
    "请设计 " + count + " 位人物。",
    "",
    "### 注意",
    "- 人物之间要有可利用的张力（利益冲突、隐瞒、亏欠、竞争同一个目标）。",
    "- 如果已有反派，就补能让反派立体的人（导师、旧友、同僚）；如果还没有，优先补反派。",
    "- 姓名用中文，符合题材气质，不要用「李明」「张三」这类占位名。",
  ].filter(Boolean).join(NL);

  const res = await runJson<Record<string, unknown>>({
    taskKind: "cast-gen",
    projectId: opts.projectId,
    system,
    user,
    jsonSchemaHint: jsonInstruction(CHARACTER_SCHEMA),
    context: { projectId: opts.projectId, sections: ["profile", "outline", "characters", "world", "threads"] },
    signal: opts.signal,
  });

  if (!res.ok || !res.parsed?.ok) {
    return { ok: false, characters: [], existingNames: characterNames, model: res.model, error: res.error ?? "模型输出不是合法 JSON" };
  }

  const data = res.parsed.data as Record<string, unknown>;
  const raw = asArray<Record<string, unknown>>(data.characters ?? data);
  const characters: GeneratedCharacter[] = [];
  for (const item of raw) {
    const name = pickStr(item, "name", "姓名");
    if (!name) continue;
    const voiceRaw = (item.voice as Record<string, unknown>) ?? {};
    characters.push({
      name,
      role: normalizeRole(pickStr(item, "role")),
      tagline: pickStr(item, "tagline", "定位") || undefined,
      age: pickStr(item, "age", "年龄") || undefined,
      gender: pickStr(item, "gender", "性别") || undefined,
      appearance: pickStr(item, "appearance", "外貌") || undefined,
      personality: pickStr(item, "personality", "性格") || undefined,
      want: pickStr(item, "want", "欲望") || undefined,
      need: pickStr(item, "need", "需要") || undefined,
      fear: pickStr(item, "fear", "恐惧") || undefined,
      flaw: pickStr(item, "flaw", "缺陷") || undefined,
      arc: pickStr(item, "arc", "弧光") || undefined,
      secrets: pickStr(item, "secrets", "秘密") || undefined,
      aliases: asArray<unknown>(item.aliases).map((x) => asString(x)).filter(Boolean),
      voice: {
        tone: pickStr(voiceRaw, "tone", "语气") || undefined,
        verbalTics: asArray<unknown>(voiceRaw.verbalTics).map((x) => asString(x)).filter(Boolean),
        favoriteWords: asArray<unknown>(voiceRaw.favoriteWords).map((x) => asString(x)).filter(Boolean),
        neverSays: asArray<unknown>(voiceRaw.neverSays).map((x) => asString(x)).filter(Boolean),
        register: pickStr(voiceRaw, "register", "语域") || undefined,
        sampleLines: asArray<unknown>(voiceRaw.sampleLines).map((x) => asString(x)).filter(Boolean),
      },
    });
    if (characters.length >= 12) break;
  }

  return { ok: true, characters, existingNames: characterNames, model: res.model };
}

/* ------------------------------------------------------------------ */
/* 世界观条目                                                          */
/* ------------------------------------------------------------------ */

export interface GeneratedWorldEntry {
  title: string;
  category: WorldCategory;
  body: string;
  importance: number;
  tags: string[];
}

const WORLD_SCHEMA = [
  "{",
  '  "entries": [ {',
  '    "title": "条目名",',
  '    "category": "geography|history|politics|magic|technology|religion|economy|species|culture|organization|item|language|custom",',
  '    "body": "条目内容：具体、可被正文引用，写清规则与代价",',
  '    "importance": 1,',
  '    "tags": ["标签"]',
  "  } ]",
  "}",
].join(NL);

const ALLOWED_CATEGORIES: WorldCategory[] = [
  "geography", "history", "politics", "magic", "technology", "religion",
  "economy", "species", "culture", "organization", "item", "language", "custom",
];

export function normalizeCategory(v: string): WorldCategory {
  const s = v.toLowerCase().trim();
  const exact = ALLOWED_CATEGORIES.find((c) => c === s);
  if (exact) return exact;
  const map: [RegExp, WorldCategory][] = [
    [/magic|魔法|力量|术法|超能/, "magic"],
    [/geo|地|place|location|城|国/, "geography"],
    [/hist|历史|事件/, "history"],
    [/polit|政治|权力|制度/, "politics"],
    [/tech|科技|机械/, "technology"],
    [/relig|宗教|信仰|神/, "religion"],
    [/econom|经济|货币|贸易/, "economy"],
    [/species|种族|生物|族/, "species"],
    [/cultur|文化|习俗|风俗/, "culture"],
    [/org|组织|门派|帮派|军团/, "organization"],
    [/item|物品|道具|武器/, "item"],
    [/lang|语言|文字/, "language"],
  ];
  for (const [re, cat] of map) if (re.test(s)) return cat;
  return "custom";
}

export interface GenerateWorldOptions {
  projectId: ID;
  instruction?: string;
  count?: number;
  /** 只生成某一类（作者在分类页点生成时用） */
  category?: WorldCategory;
  signal?: AbortSignal;
}

export interface GenerateWorldResult {
  ok: boolean;
  entries: GeneratedWorldEntry[];
  existingTitles: string[];
  model: string;
  error?: string;
}

export async function generateWorldEntries(opts: GenerateWorldOptions): Promise<GenerateWorldResult> {
  const project = await db.projects.get(opts.projectId);
  const { worldTitles } = await existingSnapshot(opts.projectId);
  const count = Math.max(1, Math.min(12, opts.count ?? 5));

  const system = await systemWithProject(
    opts.projectId,
    [
      "你是世界观架构师，擅长设计『能被故事利用』的设定。",
      "每一条设定都要能被情节用上：有规则、有边界、有代价，而不是背景介绍。",
      "力量体系必须写清限制与代价，否则故事会失去张力。",
      "不要写百科式概述，要写『作者看了就知道怎么用』的内容。",
    ].join(NL),
  );

  const user = [
    project ? "### 这本书" : "",
    project ? [project.title, project.logline, project.synopsis, project.styleGuide].filter(Boolean).join(NL) : "",
    "",
    worldTitles.length ? "### 已有的条目（不要重复这些主题）" : "### 目前还没有任何条目",
    worldTitles.length ? worldTitles.join("、") : "",
    "",
    "### 本次要求",
    opts.instruction?.trim() || (opts.category ? "补全「" + opts.category + "」这一类里还缺的关键设定。" : "补齐这本书还缺的关键设定。"),
    opts.category ? "分类统一用 " + opts.category + "。" : "分类按内容选择最贴切的一个。",
    "请生成 " + count + " 条。",
    "",
    "### 注意",
    "- 优先补『后续情节一定会用到』的设定，而不是世界地图上还空着的角落。",
    "- body 里如果有规则，必须同时写清它的代价或限制。",
  ].filter(Boolean).join(NL);

  const res = await runJson<Record<string, unknown>>({
    taskKind: "world-gen",
    projectId: opts.projectId,
    system,
    user,
    jsonSchemaHint: jsonInstruction(WORLD_SCHEMA),
    context: { projectId: opts.projectId, sections: ["profile", "outline", "world", "characters", "rules"] },
    signal: opts.signal,
  });

  if (!res.ok || !res.parsed?.ok) {
    return { ok: false, entries: [], existingTitles: worldTitles, model: res.model, error: res.error ?? "模型输出不是合法 JSON" };
  }

  const data = res.parsed.data as Record<string, unknown>;
  const raw = asArray<Record<string, unknown>>(data.entries ?? data.world ?? data);
  const entries: GeneratedWorldEntry[] = [];
  for (const item of raw) {
    const title = pickStr(item, "title", "条目名", "name");
    const body = pickStr(item, "body", "内容", "description");
    if (!title || !body) continue;
    entries.push({
      title,
      category: opts.category ?? normalizeCategory(pickStr(item, "category", "类型")),
      body,
      importance: Math.max(1, Math.min(5, Math.round(asNumber(item.importance, 3)))),
      tags: asArray<unknown>(item.tags).map((x) => asString(x)).filter(Boolean),
    });
    if (entries.length >= 16) break;
  }

  return { ok: true, entries, existingTitles: worldTitles, model: res.model };
}
