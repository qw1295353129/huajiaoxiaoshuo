import type { Chapter, ID, PlotThread } from "@/core";

/** 芯片 / 统计卡配色（对应 HeroUI Chip 的 color 取值） */
export type Tone = "default" | "accent" | "success" | "warning" | "danger";

// ---------------- 类型 ----------------

export const THREAD_KIND_LABELS: Record<PlotThread["kind"], string> = {
  foreshadow: "伏笔",
  subplot: "支线",
  mystery: "谜题",
  promise: "承诺",
  arc: "人物弧光",
  theme: "主题",
};

export const THREAD_KINDS = Object.keys(THREAD_KIND_LABELS) as PlotThread["kind"][];

export const THREAD_KIND_COLORS: Record<PlotThread["kind"], Tone> = {
  foreshadow: "accent",
  subplot: "default",
  mystery: "warning",
  promise: "success",
  arc: "default",
  theme: "default",
};

/** 新建表单里给作者的一句话解释 */
export const THREAD_KIND_HINTS: Record<PlotThread["kind"], string> = {
  foreshadow: "先埋下、后回收的具体线索：一件物品、一句台词、一个反常的细节",
  subplot: "贯穿多章的次要剧情线，有自己的起承转合",
  mystery: "需要读者跟着一起猜的谜题，答案要有公平的线索",
  promise: "对读者做出的承诺：一定会有一场决斗 / 一次重逢",
  arc: "某个角色从 A 变成 B 的成长或堕落轨迹",
  theme: "反复出现的主题意象，靠重复与变奏加深",
};

// ---------------- 状态 ----------------

export const THREAD_STATUS_LABELS: Record<PlotThread["status"], string> = {
  planned: "待埋设",
  planted: "已埋设",
  "partially-paid": "部分回收",
  resolved: "已回收",
  abandoned: "已废弃",
  overdue: "已超期",
};

export const THREAD_STATUSES = Object.keys(THREAD_STATUS_LABELS) as PlotThread["status"][];

export const THREAD_STATUS_COLORS: Record<PlotThread["status"], Tone> = {
  planned: "default",
  planted: "accent",
  "partially-paid": "warning",
  resolved: "success",
  abandoned: "default",
  overdue: "danger",
};

/** 仍未回收的状态集合（用于统计「待回收」） */
export const OPEN_STATUSES: PlotThread["status"][] = ["planned", "planted", "partially-paid", "overdue"];

// ---------------- 优先级 ----------------

export const THREAD_PRIORITY_LABELS: Record<PlotThread["priority"], string> = {
  main: "主线",
  major: "重要",
  minor: "次要",
};

export const THREAD_PRIORITIES = Object.keys(THREAD_PRIORITY_LABELS) as PlotThread["priority"][];

export const THREAD_PRIORITY_COLORS: Record<PlotThread["priority"], Tone> = {
  main: "danger",
  major: "warning",
  minor: "default",
};

// ---------------- 健康度问题 ----------------

export type ThreadProblemKind = "overdue" | "stale" | "unplanted" | "orphan";

export interface ThreadProblem {
  thread: PlotThread;
  problem: ThreadProblemKind;
  detail: string;
}

export const THREAD_PROBLEM_LABELS: Record<ThreadProblemKind, string> = {
  overdue: "计划回收章已过",
  stale: "久未回收",
  unplanted: "尚未埋设",
  orphan: "缺少关联",
};

export const THREAD_PROBLEM_DESCRIPTIONS: Record<ThreadProblemKind, string> = {
  overdue: "计划回收的章节已经写过去了，但伏笔还没有真正回收，读者会开始怀疑这条线被忘了",
  stale: "埋设之后很久没有再提到，需要在中间安排一次提醒，否则读者记不住",
  unplanted: "还没有指定在哪一章埋下，这条伏笔目前只存在于设定里",
  orphan: "既没有关联章节，也没有关联人物或设定",
};

export const THREAD_PROBLEM_TONES: Record<ThreadProblemKind, Tone> = {
  overdue: "danger",
  stale: "warning",
  unplanted: "accent",
  orphan: "default",
};

// ---------------- 章节辅助 ----------------

/** 章节下拉里的显示名 */
export function chapterLabel(chapters: Chapter[], id?: ID): string {
  if (!id) return "未指定";
  const chapter = chapters.find((c) => c.id === id);
  return chapter ? "第" + (chapter.order + 1) + "章 · " + chapter.title : "章节已删除";
}

/** 章节序号（0 基） */
export function chapterOrder(chapters: Chapter[], id?: ID): number | undefined {
  if (!id) return undefined;
  return chapters.find((c) => c.id === id)?.order;
}

/** 项目当前写到第几章（0 基最大序号） */
export function latestOrder(chapters: Chapter[]): number {
  return chapters.reduce((max, c) => Math.max(max, c.order), 0);
}

/**
 * 伏笔的叙事进度 0..1：以「当前写到的最新章」为现在，
 * 在埋设章与计划回收章之间做线性插值，用于卡片上的细进度条。
 */
export function payoffProgress(thread: PlotThread, chapters: Chapter[]): number {
  if (thread.status === "resolved") return 1;
  if (thread.status === "abandoned") return 0;
  const planted = chapterOrder(chapters, thread.plantedChapterId);
  if (planted === undefined) return 0;
  const target = chapterOrder(chapters, thread.payoffChapterId) ?? chapterOrder(chapters, thread.plannedPayoffChapterId);
  if (target === undefined || target <= planted) return 0.4;
  const now = latestOrder(chapters);
  const ratio = (now - planted) / (target - planted);
  return Math.min(1, Math.max(0.05, ratio));
}
