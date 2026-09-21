import type { ID } from "@/core";
import { asArray, asNumber, asStringArray, pickStr } from "@/ai/json";
import { jsonInstruction, OUTLINE_SCHEMA } from "@/ai/prompts";
import { runJson, systemWithProject } from "@/ai/runner";
import { createArc, createChapter, updateChapter } from "@/db/repo/outline";
import { arcColor, clampTension } from "./outlineMeta";

const NL = "\n";

/** AI 生成的单章草稿 */
export interface OutlineDraftChapter {
  title: string;
  summary: string;
  goals: string[];
  tension: number;
  hook: string;
  cliffhanger: string;
}

/** AI 生成的单卷草稿 */
export interface OutlineDraftArc {
  title: string;
  summary: string;
  goal: string;
  conflict: string;
  outcome: string;
  chapters: OutlineDraftChapter[];
}

export interface OutlineDraft {
  title: string;
  logline: string;
  arcs: OutlineDraftArc[];
  model: string;
}

export interface GenerateOutlineInput {
  volumeCount: number;
  chaptersPerVolume: number;
  /** 作者补充要求（可空） */
  requirement?: string;
  signal?: AbortSignal;
}

export type GenerateOutlineResult = { ok: true; draft: OutlineDraft } | { ok: false; error: string };

/**
 * 生成「卷 + 章」大纲草稿（只生成，不落库；由 UI 预览确认后再写入）。
 * 走统一的 runJson，模型未配置 / 网络失败都会以 { ok:false, error } 返回，不抛异常。
 */
export async function generateOutlineDraft(projectId: ID, input: GenerateOutlineInput): Promise<GenerateOutlineResult> {
  try {
    const system = await systemWithProject(
      projectId,
      "你是长篇结构设计师。章节之间必须有因果链，张力要成曲线（铺垫—上升—危机—高潮—回落），不要每章都一样。",
    );
    const res = await runJson({
      taskKind: "outline",
      projectId,
      system,
      user: [
        "### 任务",
        "为这部作品补全卷章结构：设计 " + input.volumeCount + " 卷，每卷 " + input.chaptersPerVolume + " 章。",
        "每卷给出：卷名、150 字内梗概、本卷目标（主角想要什么）、核心冲突、结束时的状态变化。",
        "每章给出：章节名、80 字内梗概、2~3 条推进点、张力值（-5~5 的整数）、开篇钩子。",
        "全书要有一条逐卷升级的主线，后一卷的冲突量级必须高于前一卷。",
        input.requirement?.trim() ? "作者补充要求：" + input.requirement.trim() : "",
      ]
        .filter(Boolean)
        .join(NL),
      jsonSchemaHint: jsonInstruction(OUTLINE_SCHEMA),
      context: { projectId, sections: ["profile", "characters", "world", "threads"] },
      signal: input.signal,
    });

    if (!res.ok || !res.parsed?.ok) return { ok: false, error: res.error ?? "AI 没有返回可解析的结构" };
    const data = res.parsed.data as Record<string, unknown>;
    const arcs = parseArcs(data);
    if (!arcs.length) return { ok: false, error: "AI 返回的结构里没有卷，请重试或换一个模型" };

    return {
      ok: true,
      draft: {
        title: pickStr(data, "title", "书名"),
        logline: pickStr(data, "logline", "一句话故事"),
        arcs,
        model: res.model,
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function parseArcs(data: Record<string, unknown>): OutlineDraftArc[] {
  const primary = asArray<Record<string, unknown>>(data.arcs);
  const raw = primary.length ? primary : asArray<Record<string, unknown>>(data.volumes);
  return raw.map((arc, i) => ({
    title: pickStr(arc, "title", "name", "卷名") || "第" + (i + 1) + "卷",
    summary: pickStr(arc, "summary", "梗概"),
    goal: pickStr(arc, "goal", "目标"),
    conflict: pickStr(arc, "conflict", "冲突"),
    outcome: pickStr(arc, "outcome", "结果"),
    chapters: parseChapters(arc),
  }));
}

function parseChapters(arc: Record<string, unknown>): OutlineDraftChapter[] {
  const primary = asArray<Record<string, unknown>>(arc.chapters);
  const raw = primary.length ? primary : asArray<Record<string, unknown>>(arc["章节"]);
  return raw.map((c, i) => ({
    title: pickStr(c, "title", "name", "章节名") || "第" + (i + 1) + "章",
    summary: pickStr(c, "summary", "梗概"),
    goals: asStringArray(c.goals).length ? asStringArray(c.goals) : asStringArray(c["推进点"]),
    tension: clampTension(asNumber(c.tension, 0)),
    hook: pickStr(c, "hook", "悬念"),
    cliffhanger: pickStr(c, "cliffhanger", "结尾悬念"),
  }));
}

export interface WriteOutlineResult {
  arcs: number;
  chapters: number;
  firstChapterId?: ID;
}

/** 把预览确认后的草稿写入数据库：逐卷 createArc，逐章 createChapter + updateChapter 补全字段 */
export async function writeOutlineDraft(projectId: ID, draft: OutlineDraft): Promise<WriteOutlineResult> {
  let arcCount = 0;
  let chapterCount = 0;
  let firstChapterId: ID | undefined;

  for (let i = 0; i < draft.arcs.length; i++) {
    const item = draft.arcs[i];
    const arc = await createArc(projectId, item.title, {
      summary: item.summary || undefined,
      goal: item.goal || undefined,
      conflict: item.conflict || undefined,
      outcome: item.outcome || undefined,
      color: arcColor(i),
      targetWords: item.chapters.length ? item.chapters.length * 3000 : undefined,
    });
    arcCount += 1;

    for (const chapter of item.chapters) {
      const created = await createChapter(projectId, { title: chapter.title, arcId: arc.id });
      if (!firstChapterId) firstChapterId = created.id;
      await updateChapter(created.id, {
        summary: chapter.summary || undefined,
        goals: chapter.goals,
        tension: chapter.tension,
        hook: chapter.hook || undefined,
        cliffhanger: chapter.cliffhanger || undefined,
        status: chapter.summary || chapter.goals.length ? "outlined" : "idea",
      });
      chapterCount += 1;
    }
  }

  return { arcs: arcCount, chapters: chapterCount, firstChapterId };
}
