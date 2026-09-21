import type { Character, EntityKind, ID, WorldCategory } from "@/core";
import { db } from "@/db/database";
import { replaceAppearances, upsertRelationship } from "@/db/repo/cast";
import { recomputeProjectStats } from "@/db/repo/projects";
import { replaceMentions, upsertEntity, upsertGlossary } from "@/db/repo/world";
import { upsertThread } from "@/db/repo/story";
import { saveMetric, upsertTimelineEvent } from "@/db/repo/story";
import { newId } from "@/utils/id";
import { countWords, splitParagraphs, stripHtml } from "@/utils/text";
import { dialogueStats, measureChapter, scanKnownNames } from "@/utils/entity-scan";
import { analyzeStyle } from "@/utils/style-analyzer";
import { runJson, systemWithProject } from "./runner";
import { ENTITY_SCHEMA, SUMMARIZE_SCHEMA, jsonInstruction } from "./prompts";
import { asArray, asNumber, asString, pickStr } from "./json";

const NL = String.fromCharCode(10);

export interface ExtractedBundle {
  characters: {
    name: string;
    aliases: string[];
    role: Character["role"];
    tagline: string;
    appearance: string;
    personality: string;
    evidence: string;
  }[];
  entities: { name: string; kind: EntityKind; summary: string }[];
  relationships: { from: string; to: string; kind: string; affinity: number; description: string }[];
  timeline: { title: string; inWorldTime: string; participants: string[]; location: string; importance: number }[];
  glossary: { canonical: string; variants: string[] }[];
  foreshadows: { title: string; description: string; quote: string; plannedPayoff: string }[];
  raw: string;
}

/** 从单章正文抽取设定素材（不落库，返回提案供用户确认） */
export async function extractFromChapter(
  projectId: ID,
  chapterId: ID,
  opts: { signal?: AbortSignal; focus?: string } = {},
): Promise<{ ok: boolean; bundle?: ExtractedBundle; error?: string; model?: string }> {
  const chapter = await db.chapters.get(chapterId);
  const content = await db.chapterContents.get(chapterId);
  if (!chapter || !content) return { ok: false, error: "章节不存在" };
  const text = content.text || stripHtml(content.html);
  if (countWords(text) < 100) return { ok: false, error: "本章内容太短，至少 100 字才值得抽取" };

  const system = await systemWithProject(
    projectId,
    [
      "你是信息抽取引擎，从小说正文中提取结构化设定素材。",
      "铁律：只提取正文里真实出现的名字与事实，绝不推断、绝不补充、绝不杜撰。",
      "同一实体的不同称呼要合并为 aliases；正文没写的字段留空字符串。",
    ].join(NL),
  );

  const res = await runJson({
    taskKind: "extract-entities",
    projectId,
    chapterId,
    system,
    user: [
      "### 章节正文",
      "第" + (chapter.order + 1) + "章 " + chapter.title,
      "",
      text.slice(0, 24000),
      "",
      "### 抽取要求",
      opts.focus ? "重点关注：" + opts.focus : "提取本章新出现或首次明确的人物、名词、关系、事件、伏笔与名词写法。",
    ].join(NL),
    jsonSchemaHint: jsonInstruction(ENTITY_SCHEMA),
    // 抽取任务不需要拖入大量上下文，避免模型"抄上下文"而不是"读正文"
    context: { projectId, chapterId, sections: ["profile", "characters"], budget: 4000 },
    signal: opts.signal,
  });

  if (!res.ok || !res.parsed?.ok) return { ok: false, error: res.error ?? "解析失败", model: res.model };
  const d = res.parsed.data as Record<string, unknown>;

  const bundle: ExtractedBundle = {
    characters: asArray<Record<string, unknown>>(d.characters).map((c) => ({
      name: pickStr(c, "name", "姓名"),
      aliases: asArray<unknown>(c.aliases).map((x) => asString(x)),
      role: normalizeRole(pickStr(c, "role")),
      tagline: pickStr(c, "tagline", "定位"),
      appearance: pickStr(c, "appearance", "外貌"),
      personality: pickStr(c, "personality", "性格"),
      evidence: pickStr(c, "evidence", "依据"),
    })),
    entities: asArray<Record<string, unknown>>(d.entities).map((e) => ({
      name: pickStr(e, "name", "名称"),
      kind: normalizeEntityKind(pickStr(e, "kind", "类型")),
      summary: pickStr(e, "summary", "说明"),
    })),
    relationships: asArray<Record<string, unknown>>(d.relationships).map((r) => ({
      from: pickStr(r, "from", "甲"),
      to: pickStr(r, "to", "乙"),
      kind: pickStr(r, "kind", "类型") || "other",
      affinity: asNumber(r.affinity),
      description: pickStr(r, "description", "说明"),
    })),
    timeline: asArray<Record<string, unknown>>(d.timeline).map((t) => ({
      title: pickStr(t, "title", "事件"),
      inWorldTime: pickStr(t, "inWorldTime", "时间"),
      participants: asArray<unknown>(t.participants).map((x) => asString(x)),
      location: pickStr(t, "location", "地点"),
      importance: Math.max(1, Math.min(5, Math.round(asNumber(t.importance, 3)))),
    })),
    glossary: asArray<Record<string, unknown>>(d.glossary).map((g) => ({
      canonical: pickStr(g, "canonical", "标准"),
      variants: asArray<unknown>(g.variants).map((x) => asString(x)),
    })),
    foreshadows: asArray<Record<string, unknown>>(d.foreshadows).map((f) => ({
      title: pickStr(f, "title", "伏笔"),
      description: pickStr(f, "description", "说明"),
      quote: pickStr(f, "quote", "原文"),
      plannedPayoff: pickStr(f, "plannedPayoff", "回收"),
    })),
    raw: res.text,
  };
  return { ok: true, bundle, model: res.model };
}

export interface ApplyResult {
  characters: number;
  entities: number;
  relationships: number;
  timeline: number;
  glossary: number;
  threads: number;
}

/** 把抽取提案写入资料库（增量合并，已存在的只补空字段） */
export async function applyExtraction(
  projectId: ID,
  chapterId: ID,
  bundle: ExtractedBundle,
  opts: { selected?: { characters?: string[]; entities?: string[]; timeline?: string[]; glossary?: string[]; foreshadows?: string[] } } = {},
): Promise<ApplyResult> {
  const result: ApplyResult = { characters: 0, entities: 0, relationships: 0, timeline: 0, glossary: 0, threads: 0 };
  const now = new Date().toISOString();
  const existingChars = await db.characters.where("projectId").equals(projectId).toArray();
  const byName = new Map<string, Character>();
  for (const c of existingChars) {
    byName.set(c.name, c);
    for (const a of c.aliases) byName.set(a, c);
  }

  const wantChars = opts.selected?.characters;
  for (const c of bundle.characters) {
    if (wantChars && !wantChars.includes(c.name)) continue;
    const found = byName.get(c.name) ?? c.aliases.map((a) => byName.get(a)).find(Boolean);
    if (found) {
      const patch: Partial<Character> = { updatedAt: now };
      if (!found.tagline && c.tagline) patch.tagline = c.tagline;
      if (!found.appearance && c.appearance) patch.appearance = c.appearance;
      if (!found.personality && c.personality) patch.personality = c.personality;
      if (!found.aliases.length && c.aliases.length) patch.aliases = c.aliases;
      await db.characters.where("id").equals(found.id).modify((x) => { Object.assign(x, patch); });
    } else {
      const created: Character = {
        id: newId("chr"),
        projectId,
        name: c.name,
        aliases: c.aliases,
        role: c.role,
        tagline: c.tagline || undefined,
        appearance: c.appearance || undefined,
        personality: c.personality || undefined,
        abilities: [],
        factionIds: [],
        status: "alive",
        tags: ["自动抽取"],
        milestones: [],
        custom: {},
        firstAppearanceChapterId: chapterId,
        createdAt: now,
        updatedAt: now,
      };
      await db.characters.put(created);
      byName.set(created.name, created);
      for (const a of created.aliases) byName.set(a, created);
      result.characters += 1;
    }
  }

  const wantEntities = opts.selected?.entities;
  for (const e of bundle.entities) {
    if (wantEntities && !wantEntities.includes(e.name)) continue;
    const saved = await upsertEntity(projectId, e.name, e.kind, {
      summary: e.summary,
      firstChapterId: chapterId,
      mentions: 1,
    });
    if (saved) result.entities += 1;
  }

  for (const r of bundle.relationships) {
    const from = byName.get(r.from);
    const to = byName.get(r.to);
    if (!from || !to) continue;
    await upsertRelationship(projectId, from.id, to.id, {
      kind: normalizeRelation(r.kind),
      affinity: r.affinity,
      description: r.description,
    });
    result.relationships += 1;
  }

  const wantTimeline = opts.selected?.timeline;
  for (const t of bundle.timeline) {
    if (wantTimeline && !wantTimeline.includes(t.title)) continue;
    const participantIds = t.participants.map((p) => byName.get(p)?.id).filter((x): x is ID => Boolean(x));
    await upsertTimelineEvent(projectId, {
      title: t.title,
      inWorldTime: t.inWorldTime,
      orderKey: Date.now() + Math.random(),
      chapterIds: [chapterId],
      participantIds,
      importance: t.importance as 1 | 2 | 3 | 4 | 5,
    });
    result.timeline += 1;
  }

  const wantGlossary = opts.selected?.glossary;
  for (const g of bundle.glossary) {
    if (!g.canonical) continue;
    if (wantGlossary && !wantGlossary.includes(g.canonical)) continue;
    await upsertGlossary(projectId, g.canonical, g.variants);
    result.glossary += 1;
  }

  for (const f of bundle.foreshadows) {
    if (!f.title) continue;
    await upsertThread(projectId, {
      title: f.title,
      kind: "foreshadow",
      description: f.description,
      plantedChapterId: chapterId,
      plantQuote: f.quote || undefined,
      status: "planted",
      priority: "major",
    });
    result.threads += 1;
  }

  return result;
}

function normalizeRole(v: string): Character["role"] {
  const s = v.toLowerCase();
  const allowed: Character["role"][] = [
    "protagonist", "antagonist", "deuteragonist", "mentor", "foil", "love-interest", "sidekick", "minor", "cameo",
  ];
  if (allowed.includes(s as Character["role"])) return s as Character["role"];
  if (/主角|protagonist/.test(s)) return "protagonist";
  if (/反派|antagonist/.test(s)) return "antagonist";
  if (/配角|minor/.test(s)) return "minor";
  return "minor";
}

function normalizeEntityKind(v: string): EntityKind {
  const s = v.toLowerCase();
  const allowed: EntityKind[] = [
    "character", "world", "item", "faction", "location", "event", "concept", "creature", "skill", "term",
  ];
  if (allowed.includes(s as EntityKind)) return s as EntityKind;
  if (/地点|location|place/.test(s)) return "location";
  if (/组织|势力|faction/.test(s)) return "faction";
  if (/物品|item/.test(s)) return "item";
  if (/事件|event/.test(s)) return "event";
  if (/技能|功法|skill/.test(s)) return "skill";
  return "term";
}

function normalizeRelation(v: string): Parameters<typeof upsertRelationship>[3] extends undefined ? never : NonNullable<Parameters<typeof upsertRelationship>[3]>["kind"] extends undefined ? never : NonNullable<NonNullable<Parameters<typeof upsertRelationship>[3]>["kind"]> {
  const s = v.toLowerCase();
  const allowed = ["family", "lover", "spouse", "friend", "ally", "rival", "enemy", "mentor", "student", "colleague", "subordinate", "superior", "acquaintance", "other"] as const;
  const found = allowed.find((x) => x === s);
  if (found) return found;
  if (/敌|仇|enemy/.test(s)) return "enemy";
  if (/友|friend/.test(s)) return "friend";
  if (/师|mentor/.test(s)) return "mentor";
  if (/亲人|家|family/.test(s)) return "family";
  return "other";
}

// ==================== 章节索引 ====================

export interface IndexResult {
  chapterId: ID;
  summary: string;
  events: string[];
  charactersPresent: string[];
  stateChanges: { who: string; change: string }[];
  openQuestions: string[];
  words: number;
}

/** 为单章生成摘要 + 状态变更 + 出场统计 + 指标 */
export async function indexChapter(projectId: ID, chapterId: ID, signal?: AbortSignal): Promise<{ ok: boolean; result?: IndexResult; error?: string }> {
  const chapter = await db.chapters.get(chapterId);
  const content = await db.chapterContents.get(chapterId);
  if (!chapter || !content) return { ok: false, error: "章节不存在" };
  const text = content.text || stripHtml(content.html);
  if (countWords(text) < 80) return { ok: false, error: "内容太短" };

  // ---- 本地部分（不花 token） ----
  const style = analyzeStyle(text);
  const measure = measureChapter(text);
  const knownChars = await db.characters.where("projectId").equals(projectId).toArray();
  const knownWorld = await db.worldEntries.where("projectId").equals(projectId).toArray();
  const names = [
    ...knownChars.map((c) => ({ id: c.id, name: c.name, aliases: c.aliases, kind: "character" })),
    ...knownWorld.map((w) => ({ id: w.id, name: w.title, aliases: w.aliases, kind: "world" })),
  ];
  const hits = scanKnownNames(text, names);
  const presentCharIds = hits
    .filter((h) => knownChars.some((c) => c.id === h.refId))
    .map((h) => h.refId as ID);

  const dlg = (await import("@/utils/entity-scan")).dialogueStats(text, names);

  await replaceAppearances(
    chapterId,
    dlg.map((d) => {
      const ch = knownChars.find((c) => c.name === d.speaker);
      return {
        id: ch ? ch.id + "::" + chapterId : "unknown::" + chapterId + "::" + d.speaker,
        characterId: ch ? ch.id : "unknown",
        chapterId,
        mentioned: hits.find((h) => h.name === d.speaker)?.count ?? 0,
        dialogueLines: d.lines,
        words: d.chars,
      };
    }),
  );

  await replaceMentions(
    chapterId,
    hits
      .filter((h) => h.refId)
      .map((h) => ({
        projectId,
        entityId: h.refId as ID,
        chapterId,
        count: h.count,
        firstOffset: h.firstOffset,
        sample: h.sample,
      })),
  );

  await saveMetric({
    projectId,
    chapterId,
    order: chapter.order,
    wordCount: measure.wordCount,
    dialogueRatio: style.dialogueRatio,
    avgSentenceLength: style.avgSentenceLength,
    tension: chapter.tension,
    castIds: presentCharIds.length ? presentCharIds : chapter.characterIds,
    newEntities: 0,
  });

  // ---- LLM 部分：摘要 ----
  const system = await systemWithProject(
    projectId,
    "你负责为长篇小说做章节归档。你的摘要必须客观、只记录事实，不做文学评价，不添加原文没有的信息。",
  );
  const res = await runJson({
    taskKind: "chapter-summary",
    projectId,
    chapterId,
    system,
    user: ["### 章节正文", "第" + (chapter.order + 1) + "章 " + chapter.title, "", text.slice(0, 20000), "", "### 任务", "生成本章归档摘要与状态变更清单。"].join(NL),
    jsonSchemaHint: jsonInstruction(SUMMARIZE_SCHEMA),
    context: { projectId, chapterId, sections: ["profile", "characters", "threads"], budget: 6000 },
    signal,
  });

  if (!res.ok || !res.parsed?.ok) return { ok: false, error: res.error ?? "解析失败" };
  const d = res.parsed.data as Record<string, unknown>;
  const summary = pickStr(d, "summary", "梗概");
  const result: IndexResult = {
    chapterId,
    summary,
    events: asArray<unknown>(d.events).map((x) => asString(x)),
    charactersPresent: asArray<unknown>(d.charactersPresent).map((x) => asString(x)),
    stateChanges: asArray<Record<string, unknown>>(d.stateChanges).map((s) => ({
      who: pickStr(s, "who", "人物"),
      change: pickStr(s, "change", "变化"),
    })),
    openQuestions: asArray<unknown>(d.openQuestions).map((x) => asString(x)),
    words: measure.wordCount,
  };

  // 回写章节摘要与出场人物
  await db.chapters.where("id").equals(chapterId).modify((c) => {
    if (!c.summary && summary) c.summary = summary;
    if (!c.characterIds.length && presentCharIds.length) c.characterIds = presentCharIds;
    c.updatedAt = new Date().toISOString();
  });

  // 首个出场章节回填
  for (const id of presentCharIds) {
    await db.characters.where("id").equals(id).modify((c) => {
      if (!c.firstAppearanceChapterId) c.firstAppearanceChapterId = chapterId;
    });
  }

  return { ok: true, result };
}

/** 批量索引未归档的章节 */
export async function runIndex(
  projectId: ID,
  opts: { onlyMissing?: boolean; signal?: AbortSignal; onProgress?: (done: number, total: number, title: string) => void } = {},
): Promise<{ done: number; failed: { chapterId: ID; error: string }[] }> {
  const chapters = (await db.chapters.where("projectId").equals(projectId).toArray()).sort((a, b) => a.order - b.order);
  const targets = opts.onlyMissing === false ? chapters : chapters.filter((c) => !c.summary || c.wordCount === 0);
  const failed: { chapterId: ID; error: string }[] = [];
  let done = 0;
  for (const c of targets) {
    if (opts.signal?.aborted) break;
    opts.onProgress?.(done, targets.length, c.title);
    const r = await indexChapter(projectId, c.id, opts.signal);
    if (!r.ok) failed.push({ chapterId: c.id, error: r.error ?? "未知错误" });
    done += 1;
  }
  await recomputeProjectStats(projectId);
  return { done, failed };
}

// ==================== 故事圣经 ====================

export interface StoryBible {
  generatedAt: string;
  title: string;
  logline: string;
  synopsis: string;
  themes: string[];
  characters: { name: string; role: string; tagline: string; want: string; need: string; arc: string }[];
  world: { title: string; category: WorldCategory; body: string }[];
  rules: { name: string; description: string }[];
  threads: { title: string; status: string; priority: string; description: string }[];
  timeline: { title: string; inWorldTime: string; description: string }[];
  chapterSummaries: { order: number; title: string; summary: string; words: number }[];
  markdown: string;
}

/** 汇总当前项目所有设定，产出可读的「故事圣经」 */
export async function buildStoryBible(projectId: ID): Promise<StoryBible | undefined> {
  const project = await db.projects.get(projectId);
  if (!project) return undefined;
  const [characters, world, rules, threads, timeline, chapters] = await Promise.all([
    db.characters.where("projectId").equals(projectId).toArray(),
    db.worldEntries.where("projectId").equals(projectId).toArray(),
    db.rules.where("projectId").equals(projectId).toArray(),
    db.plotThreads.where("projectId").equals(projectId).toArray(),
    db.timelineEvents.where("projectId").equals(projectId).toArray(),
    db.chapters.where("projectId").equals(projectId).toArray(),
  ]);
  chapters.sort((a, b) => a.order - b.order);
  timeline.sort((a, b) => a.orderKey - b.orderKey);

  const bible: StoryBible = {
    generatedAt: new Date().toISOString(),
    title: project.title,
    logline: project.logline ?? "",
    synopsis: project.synopsis ?? "",
    themes: project.themes,
    characters: characters.map((c) => ({
      name: c.name,
      role: c.role,
      tagline: c.tagline ?? "",
      want: c.want ?? "",
      need: c.need ?? "",
      arc: c.arc ?? "",
    })),
    world: world.map((w) => ({ title: w.title, category: w.category, body: w.body })),
    rules: rules.map((r) => ({ name: r.name, description: r.description })),
    threads: threads.map((t) => ({ title: t.title, status: t.status, priority: t.priority, description: t.description ?? "" })),
    timeline: timeline.map((t) => ({ title: t.title, inWorldTime: t.inWorldTime, description: t.description ?? "" })),
    chapterSummaries: chapters.map((c) => ({ order: c.order, title: c.title, summary: c.summary ?? "", words: c.wordCount })),
    markdown: "",
  };

  const md: string[] = [];
  md.push("# " + bible.title);
  if (bible.logline) md.push("", "> " + bible.logline);
  if (bible.synopsis) md.push("", bible.synopsis);
  if (bible.themes.length) md.push("", "**主题**：" + bible.themes.join("、"));
  md.push("", "## 人物");
  for (const c of bible.characters) {
    md.push("", "### " + c.name + "（" + c.role + "）");
    if (c.tagline) md.push("- 定位：" + c.tagline);
    if (c.want) md.push("- 欲望：" + c.want);
    if (c.need) md.push("- 需要：" + c.need);
    if (c.arc) md.push("- 弧光：" + c.arc);
  }
  if (bible.world.length) {
    md.push("", "## 世界观");
    for (const w of bible.world) md.push("", "### " + w.title + "（" + w.category + "）", w.body);
  }
  if (bible.rules.length) {
    md.push("", "## 硬性规则");
    for (const r of bible.rules) md.push("- **" + r.name + "**：" + r.description);
  }
  if (bible.threads.length) {
    md.push("", "## 伏笔与支线");
    for (const t of bible.threads) md.push("- [" + t.status + "] " + t.title + "：" + t.description);
  }
  if (bible.timeline.length) {
    md.push("", "## 时间线");
    for (const t of bible.timeline) md.push("- " + (t.inWorldTime ? "[" + t.inWorldTime + "] " : "") + t.title + (t.description ? "：" + t.description : ""));
  }
  if (bible.chapterSummaries.length) {
    md.push("", "## 章节脉络");
    for (const c of bible.chapterSummaries) {
      md.push("- 第" + (c.order + 1) + "章 " + c.title + "（" + c.words + " 字）：" + (c.summary || "（未归档）"));
    }
  }
  bible.markdown = md.join(NL);
  return bible;
}

export { splitParagraphs, dialogueStats };
