import type { Arc, Chapter, ChapterStatus } from "@/core";
import { CHAPTER_STATUS_COLOR, CHAPTER_STATUS_LABEL } from "@/app/theme";

/** HeroUI Chip 支持的语义色（把 theme 里的 string 收敛成联合类型，避免 any） */
export type ChipColor = "default" | "accent" | "success" | "warning" | "danger";

const CHIP_COLORS: ChipColor[] = ["default", "accent", "success", "warning", "danger"];

/** 章节状态 → 徽标颜色 */
export function chapterStatusColor(status: string): ChipColor {
  const value = CHAPTER_STATUS_COLOR[status];
  return CHIP_COLORS.find((c) => c === value) ?? "default";
}

/** 章节状态 → 中文名 */
export function chapterStatusLabel(status: string): string {
  return CHAPTER_STATUS_LABEL[status] ?? status;
}

/** 状态下拉选项（顺序即写作流程顺序） */
export const CHAPTER_STATUS_ORDER: ChapterStatus[] = ["idea", "outlined", "drafting", "drafted", "revising", "done", "cut"];

/** 场景节拍类型 → 中文名 */
export const BEAT_KIND_LABEL: Record<string, string> = {
  setup: "铺垫",
  hook: "钩子",
  inciting: "激励事件",
  rising: "上升",
  midpoint: "中点",
  complication: "复杂化",
  crisis: "危机",
  climax: "高潮",
  resolution: "收束",
  breather: "喘息",
  reveal: "揭示",
};

/** 分卷配色（新建卷按顺序取用） */
export const ARC_COLORS = ["#7c5cff", "#2dd4bf", "#f59e0b", "#f43f5e", "#38bdf8", "#a3e635", "#c084fc", "#fb7185"];

export function arcColor(index: number): string {
  return ARC_COLORS[((index % ARC_COLORS.length) + ARC_COLORS.length) % ARC_COLORS.length];
}

/** 张力值钳制到 -5..5 的整数 */
export function clampTension(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-5, Math.min(5, Math.round(value)));
}

/** 带正负号的张力文本 */
export function tensionText(tension: number): string {
  return (tension > 0 ? "+" : "") + tension;
}

/** 张力值的中文描述 */
export function tensionLabel(tension: number): string {
  if (tension <= -4) return "极低谷";
  if (tension <= -2) return "低谷";
  if (tension < 0) return "稍缓";
  if (tension === 0) return "平缓";
  if (tension < 2) return "微升";
  if (tension < 4) return "紧张";
  return "高潮";
}

export interface ChapterGroup {
  /** 所属卷；undefined 表示"未分卷" */
  arc?: Arc;
  chapters: Chapter[];
}

/**
 * 把章节按卷分组：卷按 arcs 的传入顺序，章节保持 chapters 的传入顺序。
 * arcId 指向已不存在的卷时，一并归入"未分卷"，避免章节在树里丢失。
 */
export function groupChapters(arcs: Arc[], chapters: Chapter[]): ChapterGroup[] {
  const known = new Set(arcs.map((a) => a.id));
  const groups: ChapterGroup[] = arcs.map((arc) => ({ arc, chapters: chapters.filter((c) => c.arcId === arc.id) }));
  const loose = chapters.filter((c) => !c.arcId || !known.has(c.arcId));
  if (loose.length) groups.push({ arc: undefined, chapters: loose });
  return groups;
}

export function flattenGroups(groups: ChapterGroup[]): Chapter[] {
  return groups.flatMap((g) => g.chapters);
}

/** 章节所属分组的键：卷 id，或 null（未分卷 / 卷已被删除） */
export function groupKeyOf(chapter: Chapter, arcs: Arc[]): string | null {
  return chapter.arcId && arcs.some((a) => a.id === chapter.arcId) ? chapter.arcId : null;
}

/** 一组章节的总字数 */
export function sumWords(chapters: Chapter[]): number {
  return chapters.reduce((n, c) => n + (c.wordCount ?? 0), 0);
}

/** 错误信息归一化 */
export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "未知错误";
}
