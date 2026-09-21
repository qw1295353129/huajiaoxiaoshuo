import type { Character, RelationKind, Relationship } from "@/core";

/** 芯片配色 */
export type Tone = "default" | "accent" | "success" | "warning" | "danger";

// ---------------- 角色 ----------------

export const ROLE_LABELS: Record<Character["role"], string> = {
  protagonist: "主角",
  antagonist: "反派",
  deuteragonist: "第二主角",
  mentor: "导师",
  foil: "对照角色",
  "love-interest": "恋人",
  sidekick: "伙伴",
  minor: "配角",
  cameo: "龙套",
};

/** 节点颜色：按角色定位区分 */
export const ROLE_COLORS: Record<Character["role"], string> = {
  protagonist: "#8b5cf6",
  antagonist: "#f43f5e",
  deuteragonist: "#0ea5e9",
  mentor: "#f59e0b",
  foil: "#14b8a6",
  "love-interest": "#ec4899",
  sidekick: "#84cc16",
  minor: "#a3a3a3",
  cameo: "#d4d4d4",
};

export const ROLE_ORDER: Character["role"][] = [
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

export function roleLabel(role: string): string {
  return ROLE_LABELS[role as Character["role"]] ?? role;
}

export function roleColor(role: string, fallback = "#a3a3a3"): string {
  return ROLE_COLORS[role as Character["role"]] ?? fallback;
}

/** 「主角团」= 主角 / 第二主角 / 反派 */
export const MAIN_ROLES: Character["role"][] = ["protagonist", "deuteragonist", "antagonist"];

export const STATUS_LABELS: Record<Character["status"], string> = {
  alive: "在世",
  dead: "已死亡",
  missing: "失踪",
  unknown: "未知",
  transformed: "已转化",
};

// ---------------- 关系 ----------------

export const RELATION_KIND_LABELS: Record<RelationKind, string> = {
  family: "亲人",
  lover: "恋人",
  spouse: "配偶",
  friend: "朋友",
  ally: "盟友",
  rival: "对手",
  enemy: "敌对",
  mentor: "师徒（师）",
  student: "师徒（徒）",
  colleague: "同僚",
  subordinate: "下属",
  superior: "上级",
  acquaintance: "相识",
  other: "其他",
};

export const RELATION_KINDS = Object.keys(RELATION_KIND_LABELS) as RelationKind[];

/** 边颜色：按关系类型区分 */
export const RELATION_COLORS: Record<RelationKind, string> = {
  family: "#f59e0b",
  lover: "#ec4899",
  spouse: "#db2777",
  friend: "#22c55e",
  ally: "#14b8a6",
  rival: "#f97316",
  enemy: "#ef4444",
  mentor: "#8b5cf6",
  student: "#a855f7",
  colleague: "#0ea5e9",
  subordinate: "#64748b",
  superior: "#475569",
  acquaintance: "#94a3b8",
  other: "#9ca3af",
};

/** 「敌对关系」：用于筛选 */
export const HOSTILE_KINDS: RelationKind[] = ["enemy", "rival"];

export const RELATION_KIND_TONES: Record<RelationKind, Tone> = {
  family: "warning",
  lover: "danger",
  spouse: "danger",
  friend: "success",
  ally: "success",
  rival: "warning",
  enemy: "danger",
  mentor: "accent",
  student: "accent",
  colleague: "default",
  subordinate: "default",
  superior: "default",
  acquaintance: "default",
  other: "default",
};

export function relationLabel(kind: string): string {
  return RELATION_KIND_LABELS[kind as RelationKind] ?? kind;
}

export function relationColor(kind: string, fallback = "#9ca3af"): string {
  return RELATION_COLORS[kind as RelationKind] ?? fallback;
}

export function relationTone(kind: string): Tone {
  return RELATION_KIND_TONES[kind as RelationKind] ?? "default";
}

/** 情感值描述 */
export function affinityLabel(affinity: number): string {
  const a = Math.abs(affinity);
  if (a < 10) return "中立";
  const polarity = affinity > 0 ? "好感" : "敌意";
  if (a < 30) return "轻微" + polarity;
  if (a < 60) return polarity + "明显";
  if (a < 85) return "强烈" + polarity;
  return "执念级" + polarity;
}

export function affinityTone(affinity: number): Tone {
  if (affinity > 55) return "success";
  if (affinity > 15) return "accent";
  if (affinity > -15) return "default";
  if (affinity > -55) return "warning";
  return "danger";
}

/** 边宽：情感越强越粗 */
export function edgeWidth(affinity: number): number {
  return 1.2 + (Math.min(100, Math.abs(affinity)) / 100) * 3.4;
}

/** 边透明度：情感越强越不透明 */
export function edgeOpacity(affinity: number): number {
  return 0.35 + (Math.min(100, Math.abs(affinity)) / 100) * 0.55;
}

/** 节点半径：出场越多越大 */
export function nodeRadius(appearances: number): number {
  return Math.max(18, Math.min(48, 18 + Math.sqrt(Math.max(0, appearances)) * 4.5));
}

/** 关系的方向描述 */
export function relationDirectionLabel(relationship: Relationship): string {
  if (relationship.visibility === "one-sided") return "单向";
  if (relationship.visibility === "secret") return "隐秘";
  return "公开";
}
