import type { Character, CharacterRole, CharacterStatus, RelationKind } from "@/core";

/**
 * 人物模块共用的标签表与纯函数。
 * 列表页、详情页、AI 补全都从这里取，避免同一个枚举在多个文件里各写一份中文。
 */

export type ChipColor = "default" | "accent" | "success" | "warning" | "danger";

/** 角色类型：顺序即"主要程度"，用于排序与筛选下拉 */
export const ROLE_ORDER: CharacterRole[] = [
  "protagonist",
  "antagonist",
  "deuteragonist",
  "mentor",
  "love-interest",
  "foil",
  "sidekick",
  "minor",
  "cameo",
];

export const ROLE_LABEL: Record<CharacterRole, string> = {
  protagonist: "主角",
  antagonist: "反派",
  deuteragonist: "第二主角",
  mentor: "导师",
  "love-interest": "情感线",
  foil: "对照角色",
  sidekick: "伙伴",
  minor: "配角",
  cameo: "龙套",
};

export const ROLE_COLOR: Record<CharacterRole, ChipColor> = {
  protagonist: "accent",
  antagonist: "danger",
  deuteragonist: "accent",
  mentor: "success",
  "love-interest": "warning",
  foil: "default",
  sidekick: "success",
  minor: "default",
  cameo: "default",
};

export function roleLabel(role: string | undefined): string {
  return ROLE_LABEL[role as CharacterRole] ?? (role || "未分类");
}

/** 越小越主要 */
export function roleWeight(role: CharacterRole | undefined): number {
  const i = ROLE_ORDER.indexOf(role as CharacterRole);
  return i < 0 ? ROLE_ORDER.length : i;
}

export const STATUS_ORDER: CharacterStatus[] = ["alive", "dead", "missing", "unknown", "transformed"];

export const STATUS_LABEL: Record<CharacterStatus, string> = {
  alive: "在世",
  dead: "已故",
  missing: "失踪",
  unknown: "未知",
  transformed: "蜕变",
};

export const STATUS_COLOR: Record<CharacterStatus, ChipColor> = {
  alive: "success",
  dead: "danger",
  missing: "warning",
  unknown: "default",
  transformed: "accent",
};

export const RELATION_ORDER: RelationKind[] = [
  "family",
  "lover",
  "spouse",
  "friend",
  "ally",
  "rival",
  "enemy",
  "mentor",
  "student",
  "colleague",
  "subordinate",
  "superior",
  "acquaintance",
  "other",
];

export const RELATION_LABEL: Record<RelationKind, string> = {
  family: "家人",
  lover: "恋人",
  spouse: "配偶",
  friend: "朋友",
  ally: "盟友",
  rival: "对手",
  enemy: "敌人",
  mentor: "师长",
  student: "学生",
  colleague: "同僚",
  subordinate: "下属",
  superior: "上级",
  acquaintance: "相识",
  other: "其他",
};

export function relationLabel(kind: string | undefined): string {
  return RELATION_LABEL[kind as RelationKind] ?? (kind || "其他");
}

/** 语域候选（可自由输入，这里只做下拉建议） */
export const REGISTER_PRESETS = ["市井粗俗", "日常口语", "文雅书面", "古风文言", "学术严谨", "军旅硬朗", "行业黑话"];

export const SENTENCE_LENGTH_LABEL: Record<"short" | "medium" | "long", string> = {
  short: "短句为主",
  medium: "长短交替",
  long: "长句为主",
};

/** 情感值文案：滑块旁边给一句人话，比 -37 好懂 */
export function affinityLabel(v: number): string {
  if (v >= 80) return "生死相托";
  if (v >= 50) return "亲密无间";
  if (v >= 20) return "亲近";
  if (v > -20) return "中立";
  if (v > -50) return "有隔阂";
  if (v > -80) return "敌意";
  return "不共戴天";
}

export function affinityColor(v: number): ChipColor {
  if (v >= 50) return "success";
  if (v >= 20) return "accent";
  if (v > -20) return "default";
  if (v > -50) return "warning";
  return "danger";
}

/**
 * 头像配色：用 id 做稳定哈希，保证同一个人每次渲染颜色一致。
 * 注意必须是完整类名字面量，Tailwind 才能扫描到（不能运行时拼类名）。
 */
const AVATAR_CLASSES = [
  "bg-violet-500/15 text-violet-600 dark:text-violet-300",
  "bg-sky-500/15 text-sky-600 dark:text-sky-300",
  "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
  "bg-amber-500/15 text-amber-600 dark:text-amber-300",
  "bg-rose-500/15 text-rose-600 dark:text-rose-300",
  "bg-cyan-500/15 text-cyan-600 dark:text-cyan-300",
  "bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-300",
  "bg-teal-500/15 text-teal-600 dark:text-teal-300",
];

export function hashString(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) >>> 0;
  return h;
}

export function avatarClass(seed: string): string {
  return AVATAR_CLASSES[hashString(seed || "?") % AVATAR_CLASSES.length];
}

/** 没有 emoji 时用名字首字：中文取首字，英文取首字母大写 */
export function avatarInitial(name: string): string {
  const t = (name ?? "").trim();
  if (!t) return "?";
  const first = t[0];
  return /[a-zA-Z]/.test(first) ? first.toUpperCase() : first;
}

/** 多行文本 <-> 字符串数组（口癖、台词样例这类"一行一条"的字段） */
export function linesToArray(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function arrayToLines(list: string[] | undefined): string {
  return (list ?? []).join("\n");
}

/** 标签输入的切分规则：中英文逗号、顿号、换行都算分隔符 */
export function splitTags(text: string): string[] {
  return text
    .split(/[,，、;；\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 卡片/列表里展示的搜索文本 */
export function searchableText(c: Character): string {
  return [c.name, c.tagline, c.age, c.gender, ...(c.aliases ?? []), ...(c.tags ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/** 关系里的"另一方" */
export function otherSide<T extends { fromId: string; toId: string }>(rel: T, characterId: string): string {
  return rel.fromId === characterId ? rel.toId : rel.fromId;
}
