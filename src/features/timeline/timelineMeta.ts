import type { Chapter, ID, TimelineEvent } from "@/core";
import { cnToNumber } from "@/utils/text";

/** 芯片 / 统计卡配色 */
export type Tone = "default" | "accent" | "success" | "warning" | "danger";

// ---------------- 重要性 ----------------

export const IMPORTANCE_LABELS: Record<number, string> = {
  1: "过场",
  2: "日常",
  3: "重要",
  4: "关键",
  5: "转折",
};

export const IMPORTANCE_TONES: Record<number, Tone> = {
  1: "default",
  2: "accent",
  3: "accent",
  4: "warning",
  5: "danger",
};

/** 时间轴上的圆点颜色（1 冷 → 5 热） */
export const IMPORTANCE_HEX: Record<number, string> = {
  1: "#a3a3a3",
  2: "#38bdf8",
  3: "#8b5cf6",
  4: "#f59e0b",
  5: "#f43f5e",
};

export function importanceLabel(importance: number): string {
  return IMPORTANCE_LABELS[importance] ?? "未知";
}

export function importanceTone(importance: number): Tone {
  return IMPORTANCE_TONES[importance] ?? "default";
}

export function importanceHex(importance: number): string {
  return IMPORTANCE_HEX[importance] ?? "#a3a3a3";
}

/** ●●●○○ 形式的重要性指示 */
export function importanceDots(importance: number): string {
  const n = Math.min(5, Math.max(0, Math.round(importance)));
  return "●".repeat(n) + "○".repeat(5 - n);
}

// ---------------- 剧情内时间解析 ----------------

const SEASON_OFFSET: Record<string, number> = { 春: 0, 夏: 1, 秋: 2, 冬: 3 };

/** 一天之内的粗略偏移，用于同一时间粒度下的排序 */
const DAYPART_OFFSET: Record<string, number> = {
  凌晨: 0.02,
  黎明: 0.04,
  清晨: 0.06,
  早晨: 0.08,
  上午: 0.12,
  正午: 0.2,
  中午: 0.2,
  午后: 0.26,
  下午: 0.3,
  傍晚: 0.5,
  黄昏: 0.55,
  入夜: 0.6,
  半夜: 0.75,
  深夜: 0.8,
  午夜: 0.85,
};

export interface ParsedStoryTime {
  /** 可比较的数值（越大表示越晚） */
  value: number;
  year?: number;
  month?: number;
  day?: number;
  /** 归一化后的可读标签 */
  label: string;
}

const NUM_PATTERN = "([0-9]+|[零〇一二两三四五六七八九十百千]+)";
const YEAR_RE = new RegExp("(?:第\\s*)?" + NUM_PATTERN + "\\s*(?:年|载)");
const MONTH_RE = new RegExp(NUM_PATTERN + "\\s*月");
const DAY_RE = new RegExp(NUM_PATTERN + "\\s*[日号]");

/**
 * 把自由文本的剧情内时间（"第三年·春"、"景和十二年三月"）解析为可比较的数值。
 * 纯启发式：只认识「年 / 月 / 日 / 季节 / 时段」这几类词，解析不出来就返回 undefined，
 * 由冲突检测器跳过比对，绝不瞎猜。
 */
export function parseStoryTime(input?: string): ParsedStoryTime | undefined {
  if (!input) return undefined;
  const text = input.trim();
  if (!text) return undefined;

  const yearMatch = text.match(YEAR_RE);
  const monthMatch = text.match(MONTH_RE);
  const dayMatch = text.match(DAY_RE);
  const seasonKey = Object.keys(SEASON_OFFSET).find((s) => text.includes(s));
  const daypartKey = Object.keys(DAYPART_OFFSET).find((k) => text.includes(k));

  if (!yearMatch && !monthMatch && !dayMatch && !seasonKey && !daypartKey) return undefined;

  const year = yearMatch ? cnToNumber(yearMatch[1]) : undefined;
  const month = monthMatch ? cnToNumber(monthMatch[1]) : undefined;
  const day = dayMatch ? cnToNumber(dayMatch[1]) : undefined;

  const y = year ?? 0;
  const m = month && month > 0 ? month : 1;
  const d = day && day > 0 ? day : 1;
  const season = seasonKey ? SEASON_OFFSET[seasonKey] : 0;
  const daypart = daypartKey ? DAYPART_OFFSET[daypartKey] : 0;

  const value = y * 100000 + m * 1000 + d * 10 + season + daypart;

  const parts: string[] = [];
  if (year !== undefined) parts.push("第" + year + "年");
  if (seasonKey) parts.push(seasonKey);
  if (month) parts.push(month + "月");
  if (day) parts.push(day + "日");
  if (daypartKey) parts.push(daypartKey);

  return { value, year, month, day, label: parts.join("") || text };
}

/** 剧情内时间的排序值：解析失败的排在最后 */
export function storyTimeSortValue(event: TimelineEvent): number {
  return parseStoryTime(event.inWorldTime)?.value ?? Number.MAX_SAFE_INTEGER;
}

// ---------------- 章节辅助 ----------------

export function sortedChapters(chapters: Chapter[]): Chapter[] {
  return [...chapters].sort((a, b) => a.order - b.order);
}

export function chapterLabel(chapters: Chapter[], id?: ID): string {
  if (!id) return "未指定";
  const chapter = chapters.find((c) => c.id === id);
  return chapter ? "第" + (chapter.order + 1) + "章 · " + chapter.title : "章节已删除";
}

export function chapterShortLabel(chapters: Chapter[], id: ID): string {
  const chapter = chapters.find((c) => c.id === id);
  return chapter ? "第" + (chapter.order + 1) + "章" : "已删除章节";
}

/** 事件最早的关联章节序号（0 基），没有关联章节时返回 undefined */
export function firstChapterOrder(event: TimelineEvent, chapters: Chapter[]): number | undefined {
  const orders = event.chapterIds
    .map((id) => chapters.find((c) => c.id === id)?.order)
    .filter((o): o is number => o !== undefined);
  return orders.length ? Math.min(...orders) : undefined;
}

/** 事件关联的章节（按 order 排序） */
export function eventChapters(event: TimelineEvent, chapters: Chapter[]): Chapter[] {
  return sortedChapters(chapters.filter((c) => event.chapterIds.includes(c.id)));
}

/** 时间跨度描述：第一个事件 → 最后一个事件 */
export function timeSpanLabel(events: TimelineEvent[]): string {
  const labels = events
    .map((e) => e.inWorldTime?.trim())
    .filter((t): t is string => Boolean(t));
  if (labels.length === 0) return "未标注";
  if (labels.length === 1) return labels[0];
  return labels[0] + " → " + labels[labels.length - 1];
}
