import type { Arc, Chapter, Character, GenesisConstraints, GenesisRun, GenesisStage, ID, PovStyle, WorldCategory } from "@/core";
import { lengthProfile } from "@/core";
import { db } from "@/db/database";
import {
  createChapter, createArc, listArcs, listChapters, saveChapterContent, updateArc, updateChapter,
} from "@/db/repo/outline";
import type { ContinuityRule } from "@/core";
import { createCharacter, listCharacters, updateCharacter, upsertRelationship } from "@/db/repo/cast";
import { upsertGlossary, upsertRule, upsertWorldEntry } from "@/db/repo/world";
import { upsertThread } from "@/db/repo/story";
import { updateGenesisRun, createGenesisRun } from "@/db/repo/genesis";
import { updateProject } from "@/db/repo/projects";
import { countWords, textToHtml } from "@/utils/text";
import { runJson, systemWithProject } from "./runner";
import { CHAPTER_BEATS_SCHEMA, GENESIS_SCHEMA, OUTLINE_SCHEMA, craftFor, jsonInstruction } from "./prompts";
import { asArray, asArrayAny, asNumber, asString, pickStr } from "./json";

const NL = String.fromCharCode(10);

// ==================== 一句话成书 ====================

export interface GenesisOptions {
  projectId: ID;
  seed: string;
  seedKind?: GenesisRun["seedKind"];
  constraints: GenesisConstraints;
  /** 生成到哪一步停下 */
  until?: "premise" | "characters" | "world" | "structure" | "outline";
  chaptersPerVolume?: number;
  signal?: AbortSignal;
  onStage?: (stage: GenesisStage) => void;
}

/**
 * 分阶段构建故事圣经，每阶段成功就落库到 GenesisRun.stages，中断后可继续。
 * 阶段之间把上一阶段的结论喂给下一阶段，保证内部一致。
 */
export async function runGenesis(opts: GenesisOptions): Promise<GenesisRun> {
  const run = await createGenesisRun(opts.projectId, opts.seed, opts.constraints);
  await updateGenesisRun(run.id, { status: "running", seedKind: opts.seedKind ?? "idea" });

  const kinds: GenesisStage["kind"][] = ["premise", "characters", "world", "structure", "outline"];
  const stopAt = opts.until ? kinds.indexOf(opts.until) : kinds.length - 1;
  const stages: GenesisStage[] = kinds.map((k) => ({ kind: k, status: "pending" }));

  const persist = async () => {
    await updateGenesisRun(run.id, { stages });
    const stage = stages.find((s) => s.status === "running") ?? stages.find((s) => s.status === "failed");
    if (stage) opts.onStage?.(stage);
  };

  // ---------- 阶段 1：核心设定（书名/高概念/人物/世界观/规则） ----------
  stages[0].status = "running";
  await persist();
  const premise = await generateBible(opts);
  if (!premise.ok) {
    stages[0].status = "failed";
    stages[0].error = premise.error;
    await updateGenesisRun(run.id, { stages, status: "failed", error: premise.error });
    return { ...run, stages, status: "failed", error: premise.error };
  }
  stages[0].status = "done";
  stages[0].data = premise.bible;
  stages[0].model = premise.model;
  stages[0].tokens = premise.tokens;
  stages[1].status = "done";
  stages[1].data = premise.bible?.characters ?? [];
  stages[2].status = "done";
  stages[2].data = { world: premise.bible?.world ?? [], rules: premise.bible?.rules ?? [] };
  await persist();

  if (stopAt < 3) {
    await updateGenesisRun(run.id, { stages, status: "done" });
    return { ...run, stages, status: "done" };
  }

  // ---------- 阶段 4：分卷结构 ----------
  stages[3].status = "running";
  await persist();
  const structure = await generateStructure(opts, premise.bible, stages);
  if (!structure.ok) {
    stages[3].status = "failed";
    stages[3].error = structure.error;
    await updateGenesisRun(run.id, { stages, status: "failed", error: structure.error });
    return { ...run, stages, status: "failed", error: structure.error };
  }
  stages[3].status = "done";
  stages[3].data = structure.arcs;
  stages[3].model = structure.model;
  await persist();

  // ---------- 阶段 5：章节大纲 ----------
  if (stopAt >= 4) {
    stages[4].status = "running";
    await persist();
    const outline = await generateChapterOutline(opts, premise.bible, structure.arcs, stages);
    if (outline.ok) {
      stages[4].status = "done";
      stages[4].data = outline.chapters;
      stages[4].model = outline.model;
    } else {
      stages[4].status = "failed";
      stages[4].error = outline.error;
    }
    await persist();
  }

  const anyFailed = stages.some((s) => s.status === "failed");
  await updateGenesisRun(run.id, { stages, status: anyFailed ? "failed" : "done" });
  return { ...run, stages, status: anyFailed ? "failed" : "done" };
}

export interface BibleData {
  title: string;
  subtitle: string;
  logline: string;
  premise: string;
  themes: string[];
  tone: string;
  characters: Record<string, unknown>[];
  world: Record<string, unknown>[];
  rules: Record<string, unknown>[];
  structure: Record<string, unknown>[];
  openingScene: string;
}

async function generateBible(
  opts: GenesisOptions,
): Promise<{ ok: boolean; bible?: BibleData; error?: string; model: string; tokens: number }> {
  const project = await db.projects.get(opts.projectId);
  const system = await systemWithProject(
    opts.projectId,
    [
      "你是顶级故事策划，能把一个模糊的点子扩张成一个完整、自洽、有商业潜力的长篇故事。",
      "你产出的设定必须具体到可以被直接写作：人物要有互相冲突的欲望，世界观要有可被利用的规则。",
      "不要写「这是一个关于……的故事」这类空话。",
    ].join(NL),
  );

  const constraints = [
    opts.constraints.genres.length ? "体裁：" + opts.constraints.genres.join("、") : "",
    "目标篇幅：" + lengthLabel(opts.constraints.lengthClass),
    "叙事视角：" + povLabel(opts.constraints.pov),
    opts.constraints.toneKeywords.length ? "基调关键词：" + opts.constraints.toneKeywords.join("、") : "",
    opts.constraints.references.length ? "参考气质（只借鉴风格，不抄情节）：" + opts.constraints.references.join("、") : "",
    opts.constraints.avoid.length ? "必须避开：" + opts.constraints.avoid.join("、") : "",
    craftFor(opts.constraints.genres),
  ].filter(Boolean).join(NL);

  const res = await runJson({
    taskKind: "genesis",
    projectId: opts.projectId,
    system,
    user: [
      "### 创作种子",
      opts.seed,
      "",
      "### 硬性约束",
      constraints,
      "",
      "### 任务",
      "基于这个种子，设计完整的故事内核：书名、高概念、主要人物（3~7 位，含反派，每个人都有互相冲突的欲望）、世界观条目（6~12 条，其中力量体系必须有明确规则与代价）、世界硬规则（3~6 条）、分卷结构、以及一段 300 字左右的开篇正文。",
      "人物的 name 请使用符合题材的中文姓名；世界条目 body 要写具体内容而不是概述。",
    ].join(NL),
    jsonSchemaHint: jsonInstruction(GENESIS_SCHEMA),
    context: {
      projectId: opts.projectId,
      sections: ["profile"],
      query: opts.seed,
    },
    signal: opts.signal,
  });

  if (!res.ok || !res.parsed?.ok) return { ok: false, error: res.error ?? "解析失败", model: res.model, tokens: res.usage.total };
  const d = res.parsed.data as Record<string, unknown>;
  const bible: BibleData = {
    title: pickStr(d, "title") || project?.title || "未命名",
    subtitle: pickStr(d, "subtitle", "副标题"),
    logline: pickStr(d, "logline"),
    premise: pickStr(d, "premise", "core"),
    themes: asArray<unknown>(d.themes).map((x) => asString(x)),
    tone: pickStr(d, "tone"),
    characters: asArray<Record<string, unknown>>(d.characters),
    world: asArrayAny<Record<string, unknown>>(d, "world", "worldbuilding"),
    rules: asArrayAny<Record<string, unknown>>(d, "rules"),
    structure: asArrayAny<Record<string, unknown>>(d, "structure"),
    openingScene: pickStr(d, "openingScene", "opening"),
  };
  return { ok: true, bible, model: res.model, tokens: res.usage.total };
}

async function generateStructure(
  opts: GenesisOptions,
  bible: BibleData | undefined,
  stages: GenesisStage[],
): Promise<{ ok: boolean; arcs: Arc[]; error?: string; model: string }> {
  const system = await systemWithProject(opts.projectId, "你是长篇结构设计师，擅长把故事拆成张力递进的多卷结构。");
  const perVolume = opts.chaptersPerVolume ?? 12;
  // 卷数来自篇幅档案，不要在这里另写一套判断 ——
  // 之前是写死的 1/3/5，与界面上的「每卷章节数」各算各的，短篇和中篇都被当成 1 卷。
  const profile = lengthProfile(opts.constraints.lengthClass);
  const volumeCount = profile.volumes;

  const res = await runJson({
    taskKind: "outline",
    projectId: opts.projectId,
    system,
    user: [
      "### 故事内核",
      bible?.premise ?? opts.seed,
      bible?.logline ? "一句话故事：" + bible.logline : "",
      bible?.characters?.length ? "主要人物：" + bible.characters.map((c) => pickStr(c, "name")).filter(Boolean).join("、") : "",
      "",
      "### 任务",
      "设计 " + volumeCount + " 卷的宏观结构。每卷要给出：本卷目标、核心冲突、结束时的状态变化，以及本章的关键转折点。",
      "结构必须体现张力递进：每一卷的冲突量级要高于上一卷。",
    ].filter(Boolean).join(NL),
    jsonSchemaHint: jsonInstruction(OUTLINE_SCHEMA),
    context: { projectId: opts.projectId, sections: ["profile"], budget: 8000 },
    signal: opts.signal,
  });

  if (!res.ok || !res.parsed?.ok) return { ok: false, arcs: [], error: res.error ?? "解析失败", model: res.model };
  const d = res.parsed.data as Record<string, unknown>;
  const rawArcs = asArrayAny<Record<string, unknown>>(d, "arcs", "volumes", "structure");
  const now = new Date().toISOString();
  const arcs: Arc[] = rawArcs.map((a, i) => ({
    id: "pending_" + i,
    projectId: opts.projectId,
    title: pickStr(a, "title", "卷名") || "第" + (i + 1) + "卷",
    kind: "volume",
    summary: pickStr(a, "summary", "梗概"),
    goal: pickStr(a, "goal", "目标"),
    conflict: pickStr(a, "conflict", "冲突"),
    outcome: pickStr(a, "outcome", "结果"),
    order: i,
    status: "planned",
    targetWords: perVolume * 3000,
    color: ARC_COLORS[i % ARC_COLORS.length],
    createdAt: now,
    updatedAt: now,
  }));
  void stages;
  return { ok: true, arcs, model: res.model };
}

const ARC_COLORS = ["#7c5cff", "#2dd4bf", "#f59e0b", "#f43f5e", "#38bdf8", "#a3e635", "#c084fc"];

async function generateChapterOutline(
  opts: GenesisOptions,
  bible: BibleData | undefined,
  arcs: Arc[],
  stages: GenesisStage[],
): Promise<{ ok: boolean; chapters: Chapter[]; error?: string; model: string }> {
  const system = await systemWithProject(
    opts.projectId,
    "你是章节大纲专家。每一章都要有明确的推进点与结尾钩子，章节之间要有因果链，不能是并列的事件罗列。",
  );
  const perVolume = opts.chaptersPerVolume ?? 12;
  const now = new Date().toISOString();
  const created: Chapter[] = [];
  let model = "";
  let order = 0;

  for (const arc of arcs) {
    const res = await runJson({
      taskKind: "outline",
      projectId: opts.projectId,
      system,
      user: [
        "### 本卷信息",
        "卷名：" + arc.title,
        "本卷目标：" + (arc.goal ?? "未指定"),
        "核心冲突：" + (arc.conflict ?? "未指定"),
        "结束状态：" + (arc.outcome ?? "未指定"),
        "",
        "### 全局设定摘要",
        bible?.premise ?? "",
        bible?.characters?.length
          ? "人物：" + bible.characters.map((c) => pickStr(c, "name") + "（" + pickStr(c, "tagline") + "）").join("；")
          : "",
        "",
        "### 任务",
        "为这一卷设计 " + perVolume + " 章的章节大纲。每章给出：章节名、80 字内梗概、2~3 条推进点、张力值(-5~5)、结尾悬念。",
        "第 " + (order + 1) + " 章必须是承接上文的强钩子。",
      ].filter(Boolean).join(NL),
      jsonSchemaHint: jsonInstruction(OUTLINE_SCHEMA),
      context: { projectId: opts.projectId, sections: ["profile"], budget: 6000 },
      signal: opts.signal,
    });
    if (!res.ok || !res.parsed?.ok) {
      return { ok: false, chapters: created, error: res.error ?? "解析失败", model: res.model };
    }
    model = res.model;
    const d = res.parsed.data as Record<string, unknown>;
    // 兼容两种返回：arcs[0].chapters 或直接 chapters
    const arcList = asArray<Record<string, unknown>>(d.arcs);
    const rawChapters = arcList.length
      ? asArray<Record<string, unknown>>(arcList[0].chapters)
      : asArray<Record<string, unknown>>(d.chapters);

    for (const c of rawChapters.slice(0, perVolume)) {
      created.push({
        id: "pending_ch_" + order,
        projectId: opts.projectId,
        arcId: arc.id,
        title: pickStr(c, "title", "章节名") || "第" + (order + 1) + "章",
        summary: pickStr(c, "summary", "梗概"),
        goals: asArray<unknown>(c.goals).map((x) => asString(x)),
        characterIds: [],
        locationIds: [],
        plantsThreadIds: [],
        paysThreadIds: [],
        order,
        status: "outlined",
        wordCount: 0,
        tension: Math.max(-5, Math.min(5, asNumber(c.tension, 0))),
        hook: pickStr(c, "hook", "钩子") || undefined,
        beats: [],
        tags: [],
        createdAt: now,
        updatedAt: now,
      });
      order += 1;
    }
  }
  void stages;
  return { ok: true, chapters: created, model };
}

function lengthLabel(k: GenesisConstraints["lengthClass"]): string {
  // 统一从篇幅档案取，附带卷数/章数/单章字数的建议，让模型知道该按什么粒度切分
  const p = lengthProfile(k);
  const name: Record<string, string> = {
    short: "短篇", novella: "中篇", novel: "长篇", epic: "超长篇", webnovel: "网文连载",
  };
  return (
    (name[k] ?? "长篇") + "（" + p.hint + "；建议 " + p.volumes + " 卷、每卷约 " +
    p.chaptersPerVolume + " 章、单章约 " + p.chapterWords + " 字）"
  );
}

function povLabel(p: PovStyle): string {
  const map: Record<PovStyle, string> = {
    first: "第一人称",
    "third-limited": "第三人称限知",
    "third-omniscient": "第三人称全知",
    second: "第二人称",
    mixed: "多视角",
  };
  return map[p];
}

// ==================== 落库 ====================

export interface ApplyGenesisOptions {
  /** 只应用这些部分 */
  parts?: ("profile" | "characters" | "world" | "rules" | "structure" | "chapters" | "opening")[];
  /** 覆盖已有章节 */
  replaceChapters?: boolean;
}

export interface ApplyGenesisResult {
  characters: number;
  worldEntries: number;
  rules: number;
  arcs: number;
  chapters: number;
  openingWords: number;
  /**
   * 本次是"更新已有记录"而不是"新建"的数量。
   *
   * 为什么需要它：这套流程的核心承诺是 **重复应用同一个 run 不会产生重复数据**。
   * 界面必须能把这件事说清楚（"更新了 N 位人物"），否则作者点完「再次应用」
   * 看到人物数没变，会以为是没生效。
   */
  mergedCharacters: number;
  mergedArcs: number;
  mergedChapters: number;
  mergedRules: number;
  /** 开篇写进了哪一章（为空表示没写） */
  openingChapterTitle?: string;
  /** 开篇被跳过时的原因（不覆盖作者已写的内容） */
  openingSkipped?: string;
}

/** 把 GenesisRun 的产物写进项目 */
export async function applyGenesis(projectId: ID, run: GenesisRun, opts: ApplyGenesisOptions = {}): Promise<ApplyGenesisResult> {
  const parts = opts.parts ?? ["profile", "characters", "world", "rules", "structure", "chapters", "opening"];
  const bible = run.stages.find((s) => s.kind === "premise" && s.status === "done")?.data as BibleData | undefined;
  const arcs = (run.stages.find((s) => s.kind === "structure" && s.status === "done")?.data ?? []) as Arc[];
  const chapters = (run.stages.find((s) => s.kind === "outline" && s.status === "done")?.data ?? []) as Chapter[];
  const result: ApplyGenesisResult = {
    characters: 0, worldEntries: 0, rules: 0, arcs: 0, chapters: 0, openingWords: 0,
    mergedCharacters: 0, mergedArcs: 0, mergedChapters: 0, mergedRules: 0,
  };
  const now = new Date().toISOString();

  /**
   * 幂等的前提：先看清项目里已经有什么。
   *
   * 之前的实现是"来什么插什么"，于是点一次「再次应用」人物和分卷就翻一倍。
   * 世界观与规则本来就用了 upsert 所以没出问题 —— 这个差异正是 bug 的来源：
   * 同一套流程里一半幂等一半不幂等，最容易被忽略。
   *
   * 匹配口径与各自的 upsert 保持一致：人物按名字（含别名），分卷/章节按标题。
   */
  const existingCharacters = await listCharacters(projectId);
  const existingArcs = await listArcs(projectId);
  const existingChapters = await listChapters(projectId);
  const charByName = new Map<string, Character>();
  for (const c of existingCharacters) {
    if (!charByName.has(c.name)) charByName.set(c.name, c);
    for (const a of c.aliases) if (a && !charByName.has(a)) charByName.set(a, c);
  }
  const arcByTitle = new Map<string, Arc>();
  for (const a of existingArcs) if (!arcByTitle.has(a.title)) arcByTitle.set(a.title, a);
  const chapterByTitle = new Map<string, Chapter>();
  for (const c of existingChapters) if (!chapterByTitle.has(c.title)) chapterByTitle.set(c.title, c);

  /**
   * 注意 upsertRule 的语义：它是**按 id** upsert —— 不传 id 时永远新建。
   * 名字叫 upsert 很容易让人以为它会按 name 去重（我第一版就上当了，
   * 结果「再次应用」把硬规则也翻了一倍）。所以这里自己按名称匹配。
   */
  const ruleByName = new Map<string, ContinuityRule>();
  for (const r of await db.rules.where("projectId").equals(projectId).toArray()) {
    if (!ruleByName.has(r.name)) ruleByName.set(r.name, r);
  }

  if (bible && parts.includes("profile")) {
    await updateProject(projectId, {
      title: bible.title || undefined,
      subtitle: bible.subtitle || undefined,
      logline: bible.logline || undefined,
      synopsis: bible.premise || undefined,
      themes: bible.themes.length ? bible.themes : undefined,
      styleGuide: bible.tone || undefined,
      bibleVersion: 1,
    });
  }

  const nameToId = new Map<string, ID>();

  if (bible && parts.includes("characters")) {
    for (const raw of bible.characters) {
      const name = pickStr(raw, "name", "姓名");
      if (!name) continue;
      const voiceRaw = (raw.voice as Record<string, unknown>) ?? {};
      const patch = {
        name,
        aliases: asArray<unknown>(raw.aliases).map((x) => asString(x)),
        role: normalizeRole(pickStr(raw, "role")),
        tagline: pickStr(raw, "tagline", "定位") || undefined,
        age: pickStr(raw, "age", "年龄") || undefined,
        gender: pickStr(raw, "gender", "性别") || undefined,
        appearance: pickStr(raw, "appearance", "外貌") || undefined,
        personality: pickStr(raw, "personality", "性格") || undefined,
        want: pickStr(raw, "want", "欲望") || undefined,
        need: pickStr(raw, "need", "需要") || undefined,
        fear: pickStr(raw, "fear", "恐惧") || undefined,
        flaw: pickStr(raw, "flaw", "缺陷") || undefined,
        arc: pickStr(raw, "arc", "弧光") || undefined,
        secrets: pickStr(raw, "secrets", "秘密") || undefined,
        voice: {
          tone: pickStr(voiceRaw, "tone", "语气") || undefined,
          verbalTics: asArray<unknown>(voiceRaw.verbalTics).map((x) => asString(x)),
          favoriteWords: asArray<unknown>(voiceRaw.favoriteWords).map((x) => asString(x)),
          neverSays: asArray<unknown>(voiceRaw.neverSays).map((x) => asString(x)),
          register: pickStr(voiceRaw, "register", "语域") || undefined,
          sampleLines: asArray<unknown>(voiceRaw.sampleLines).map((x) => asString(x)),
        },
        tags: ["AI 建档"],
      };

      /**
       * 先按名字（含别名）找已有的人物。
       *
       * 匹配到就更新而不是新建 —— 这是「再次应用」不产生重复人物的关键。
       * 只覆盖本次带到的字段，作者后续手写的设定（里程碑、关系、出场）不受影响。
       */
      const hit = charByName.get(name) ?? patch.aliases.map((a) => charByName.get(a)).find(Boolean);
      if (hit) {
        await updateCharacter(hit.id, patch);
        nameToId.set(hit.name, hit.id);
        result.mergedCharacters += 1;
      } else {
        const created = await createCharacter(projectId, patch);
        // 同一批里出现重名时，后一个要更新前一个，不能各建一份
        charByName.set(created.name, created);
        for (const a of created.aliases) charByName.set(a, created);
        nameToId.set(created.name, created.id);
        result.characters += 1;
      }
    }
    // 关系：从人物之间的欲望冲突推断，交给后续抽取补充，这里不做猜测
  }

  if (bible && parts.includes("world")) {
    for (const raw of bible.world) {
      const title = pickStr(raw, "title", "条目名", "name");
      if (!title) continue;
      await upsertWorldEntry(projectId, {
        title,
        category: normalizeCategory(pickStr(raw, "category", "类型")),
        body: pickStr(raw, "body", "内容", "description"),
        importance: Math.max(1, Math.min(5, Math.round(asNumber(raw.importance, 3)))),
        tags: ["AI 建档"],
      });
      result.worldEntries += 1;
    }
  }

  if (bible && parts.includes("rules")) {
    for (const raw of bible.rules) {
      const title = pickStr(raw, "title", "名称", "name");
      const statement = pickStr(raw, "statement", "规则", "description");
      if (!title || !statement) continue;
      const patch = {
        name: title,
        description: statement,
        kind: "custom-llm" as const,
        value: statement,
        severity: (/error|硬/.test(pickStr(raw, "severity", "严重度")) ? "error" : "warn") as ContinuityRule["severity"],
        enabled: true,
      };
      // 同名的规则要更新，不能又插一条
      const hit = ruleByName.get(title);
      if (hit) {
        await upsertRule(projectId, { ...patch, id: hit.id });
        result.mergedRules += 1;
      } else {
        const created = await upsertRule(projectId, patch);
        ruleByName.set(created.name, created);
        result.rules += 1;
      }
    }
  }

  const arcIdMap = new Map<string, ID>();
  if (parts.includes("structure")) {
    for (const a of arcs) {
      const patch = {
        kind: "volume" as const,
        summary: a.summary,
        goal: a.goal,
        conflict: a.conflict,
        outcome: a.outcome,
        color: a.color,
      };
      // 与人物同理：按标题匹配后更新，重复应用不会多出分卷
      const hit = arcByTitle.get(a.title);
      if (hit) {
        await updateArc(hit.id, patch);
        arcIdMap.set(a.id, hit.id);
        result.mergedArcs += 1;
      } else {
        const created = await createArc(projectId, a.title, patch);
        arcByTitle.set(created.title, created);
        arcIdMap.set(a.id, created.id);
        result.arcs += 1;
      }
    }
  }

  if (parts.includes("chapters") && chapters.length) {
    if (opts.replaceChapters) {
      const existing = await db.chapters.where("projectId").equals(projectId).toArray();
      for (const c of existing) {
        await db.chapters.delete(c.id);
        await db.chapterContents.delete(c.id);
      }
      /*
        删除后必须清空删除前建的标题映射。
        否则 hit 指向已删行，updateChapter 静默 no-op，
        同名新章永远不会重建（覆盖应用时静默丢数据）。
      */
      chapterByTitle.clear();
    }
    /**
     * 章节也要幂等。没有 replaceChapters 时，之前的实现是"再追加一遍"，
     * 于是同一批章节在项目里出现两次、order 也被打乱。
     *
     * 匹配按标题：命中就只更新大纲层面（arcId / summary / goals / tension / hook），
     * **不动 status 与正文** —— 作者可能已经动笔写了这一章，绝不能被再次应用清掉。
     */
    for (const c of chapters) {
      const arcId = c.arcId ? arcIdMap.get(c.arcId) : undefined;
      const hit = chapterByTitle.get(c.title);
      if (hit) {
        await updateChapter(hit.id, { arcId, summary: c.summary, goals: c.goals, tension: c.tension, hook: c.hook });
        // 已经写过字的章节不退回 outlined，否则写作台会以为还没动笔
        if (hit.wordCount === 0 && hit.status === "idea") {
          await updateChapter(hit.id, { status: "outlined" });
        }
        result.mergedChapters += 1;
      } else {
        const created = await createChapter(projectId, { title: c.title, arcId, summary: c.summary });
        await updateChapter(created.id, { goals: c.goals, tension: c.tension, hook: c.hook, status: "outlined" });
        chapterByTitle.set(created.title, created);
        result.chapters += 1;
      }
    }
  }

  /**
   * 开篇正文：只能写进**空章节**。
   *
   * 之前的实现无条件覆盖第一章 —— 作者已经动笔之后点一次「再次应用」，
   * 亲手写的开头就被生成的开篇顶掉了。这是数据丢失，比重复入库严重得多。
   * 现在按顺序找第一个没写过字的章节；全都写过就整个跳过并告知，绝不覆盖。
   */
  if (bible?.openingScene && parts.includes("opening")) {
    const all = (await db.chapters.where("projectId").equals(projectId).toArray()).sort((a, b) => a.order - b.order);
    const empty = all.filter((c) => c.wordCount === 0);
    const target = empty[0];
    if (target) {
      const html = textToHtml(bible.openingScene.replace(/\n+/g, NL + NL));
      await saveChapterContent(target.id, html, { touchStatus: false });
      result.openingWords = countWords(bible.openingScene);
      result.openingChapterTitle = target.title;
    } else if (all.length) {
      result.openingSkipped = "所有章节都已经写过内容，开篇没有覆盖任何一章";
    }
  }

  // 名词表：把主要人物名登记进去，便于后续一致性检查
  for (const [name] of nameToId) {
    await upsertGlossary(projectId, name, []);
  }

  await updateGenesisRun(run.id, { appliedAt: now });
  void now;
  return result;
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

function normalizeCategory(v: string): WorldCategory {
  const s = v.toLowerCase();
  const allowed: WorldCategory[] = [
    "geography", "history", "politics", "magic", "technology", "religion",
    "economy", "species", "culture", "organization", "item", "language", "custom",
  ];
  if (allowed.includes(s as WorldCategory)) return s as WorldCategory;
  if (/地理|地点|地图/.test(s)) return "geography";
  if (/历史/.test(s)) return "history";
  if (/政治|权力/.test(s)) return "politics";
  if (/力量|魔法|修炼|体系/.test(s)) return "magic";
  if (/科技|技术/.test(s)) return "technology";
  if (/宗教|信仰/.test(s)) return "religion";
  if (/经济|货币/.test(s)) return "economy";
  if (/种族|物种/.test(s)) return "species";
  if (/文化|习俗/.test(s)) return "culture";
  if (/组织|势力|门派/.test(s)) return "organization";
  if (/物品|道具|武器/.test(s)) return "item";
  if (/语言|文字/.test(s)) return "language";
  return "custom";
}

/** 为已有项目的单章生成细纲（大纲页用） */
export async function generateChapterBeats(projectId: ID, chapterId: ID, signal?: AbortSignal) {
  const chapter = await db.chapters.get(chapterId);
  if (!chapter) return { ok: false as const, error: "章节不存在" };
  const system = await systemWithProject(projectId, "你是章节细纲专家，把一个章节目标拆成可直接落笔的场景节拍。");
  const res = await runJson({
    taskKind: "chapter-outline",
    projectId,
    chapterId,
    system,
    user: [
      "### 章节",
      "第" + (chapter.order + 1) + "章 " + chapter.title,
      chapter.summary ? "梗概：" + chapter.summary : "",
      chapter.goals.length ? "要完成的推进点：" + chapter.goals.join("；") : "",
      "",
      "### 任务",
      "把本章拆成 3~6 个场景节拍，标出每个节拍的张力值，并指出应该埋下或回收哪些伏笔。",
    ].filter(Boolean).join(NL),
    jsonSchemaHint: jsonInstruction(CHAPTER_BEATS_SCHEMA),
    context: { projectId, chapterId, sections: ["profile", "outline", "characters", "threads", "world"] },
    signal,
  });
  if (!res.ok || !res.parsed?.ok) return { ok: false as const, error: res.error ?? "解析失败" };
  const d = res.parsed.data as Record<string, unknown>;
  return {
    ok: true as const,
    title: pickStr(d, "title") || chapter.title,
    summary: pickStr(d, "summary"),
    goals: asArray<unknown>(d.goals).map((x) => asString(x)),
    pov: pickStr(d, "pov"),
    characters: asArray<unknown>(d.characters).map((x) => asString(x)),
    location: pickStr(d, "location"),
    storyTime: pickStr(d, "storyTime"),
    tension: asNumber(d.tension),
    hook: pickStr(d, "hook"),
    cliffhanger: pickStr(d, "cliffhanger"),
    conflictType: pickStr(d, "conflictType"),
    beats: asArray<Record<string, unknown>>(d.beats).map((b, i) => ({
      id: "beat_" + i,
      summary: pickStr(b, "summary", "内容"),
      kind: normalizeBeatKind(pickStr(b, "kind")),
      tension: asNumber(b.tension),
      done: false,
    })),
    plants: asArray<unknown>(d.plants).map((x) => asString(x)),
    pays: asArray<unknown>(d.pays).map((x) => asString(x)),
  };
}

function normalizeBeatKind(v: string): Chapter["beats"][number]["kind"] {
  const s = v.toLowerCase();
  const allowed = ["setup", "hook", "inciting", "rising", "midpoint", "complication", "crisis", "climax", "resolution", "breather", "reveal"] as const;
  const found = allowed.find((x) => x === s);
  return found ?? "rising";
}
