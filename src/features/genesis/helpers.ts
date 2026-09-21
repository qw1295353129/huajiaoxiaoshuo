import type { GenesisStageKind, GenesisRun } from "@/core";
import type { ApplyGenesisOptions, BibleData } from "@/ai/genesis";
import { WORLD_CATEGORY_LABELS } from "@/db/defaults";

/** 从 AI 返回的原始 JSON 里安全取值（字段名可能中英混用） */
export function pick(raw: unknown, ...keys: string[]): string {
  if (!raw || typeof raw !== "object") return "";
  const obj = raw as Record<string, unknown>;
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
    if (Array.isArray(value)) {
      const text = value.map((v) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "")).filter(Boolean);
      if (text.length) return text.join("；");
    }
  }
  return "";
}

/** 取数组字段 */
export function pickList(raw: unknown, ...keys: string[]): string[] {
  if (!raw || typeof raw !== "object") return [];
  const obj = raw as Record<string, unknown>;
  for (const key of keys) {
    const value = obj[key];
    if (Array.isArray(value)) {
      const list = value.map((v) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "")).filter(Boolean);
      if (list.length) return list;
    }
    if (typeof value === "string" && value.trim()) return value.split(/[、,，;；]/).map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

/** 取嵌套对象上的文本，如 voice.tone */
export function pickNested(raw: unknown, outer: string, ...keys: string[]): string {
  if (!raw || typeof raw !== "object") return "";
  return pick((raw as Record<string, unknown>)[outer], ...keys);
}

const CATEGORY_KEYS = Object.keys(WORLD_CATEGORY_LABELS);

/** 把 AI 返回的分类词归一到 WorldCategory */
export function categoryOf(raw: unknown): string {
  const s = pick(raw, "category", "类型", "kind").toLowerCase();
  if (CATEGORY_KEYS.includes(s)) return s;
  if (/地理|地点|地图|place|region/.test(s)) return "geography";
  if (/历史|history/.test(s)) return "history";
  if (/政治|权力|politics/.test(s)) return "politics";
  if (/力量|魔法|修炼|体系|magic|power/.test(s)) return "magic";
  if (/科技|技术|tech/.test(s)) return "technology";
  if (/宗教|信仰|religion/.test(s)) return "religion";
  if (/经济|货币|economy/.test(s)) return "economy";
  if (/种族|物种|species|race/.test(s)) return "species";
  if (/文化|习俗|culture|custom-?trad/.test(s)) return "culture";
  if (/组织|势力|门派|organization|faction/.test(s)) return "organization";
  if (/物品|道具|武器|item/.test(s)) return "item";
  if (/语言|文字|language/.test(s)) return "language";
  return "custom";
}

export function categoryLabel(key: string): string {
  return WORLD_CATEGORY_LABELS[key] ?? "自定义";
}

// ---------------- 阶段 ----------------

export const PIPELINE: GenesisStageKind[] = ["premise", "characters", "world", "structure", "outline"];

export const STAGE_LABELS: Record<GenesisStageKind, string> = {
  premise: "核心设定",
  characters: "人物",
  world: "世界观",
  structure: "分卷结构",
  outline: "章节大纲",
  firstScene: "开篇场景",
};

export const STAGE_HINTS: Record<GenesisStageKind, string> = {
  premise: "书名、高概念、主题、基调与开篇正文",
  characters: "主要人物的欲望、缺陷与弧光",
  world: "世界观条目与硬规则",
  structure: "每一卷的目标、冲突与结束状态",
  outline: "逐章的标题、梗概与张力值",
  firstScene: "开篇场景正文",
};

// ---------------- 落库 ----------------

export type PartKey = NonNullable<ApplyGenesisOptions["parts"]>[number];

export const PART_KEYS: PartKey[] = ["profile", "characters", "world", "rules", "structure", "chapters", "opening"];

export const PART_LABELS: Record<PartKey, string> = {
  profile: "作品档案（书名/简介/主题）",
  characters: "人物卡",
  world: "世界观条目",
  rules: "世界硬规则",
  structure: "分卷结构",
  chapters: "章节大纲",
  opening: "开篇正文（写入第一章）",
};

export const ALL_PARTS: Record<PartKey, boolean> = {
  profile: true,
  characters: true,
  world: true,
  rules: true,
  structure: true,
  chapters: true,
  opening: true,
};

/** 取核心设定阶段的产物 */
export function bibleOf(run?: GenesisRun): BibleData | undefined {
  return run?.stages.find((s) => s.kind === "premise" && (s.status === "done" || s.data))?.data as BibleData | undefined;
}

/** 按勾选过滤后再落库：只写入被采纳的人物与世界观条目 */
export function filterRun(run: GenesisRun, selectedChars: Set<number>, selectedWorld: Set<number>): GenesisRun {
  return {
    ...run,
    stages: run.stages.map((stage) => {
      if (stage.kind !== "premise" || !stage.data) return stage;
      const bible = stage.data as BibleData;
      return {
        ...stage,
        data: {
          ...bible,
          characters: bible.characters.filter((_, i) => selectedChars.has(i)),
          world: bible.world.filter((_, i) => selectedWorld.has(i)),
        },
      };
    }),
  };
}

export const RUN_STATUS_META: Record<GenesisRun["status"], { label: string; color: "default" | "accent" | "success" | "warning" | "danger" }> = {
  pending: { label: "排队中", color: "default" },
  running: { label: "生成中", color: "accent" },
  done: { label: "已完成", color: "success" },
  failed: { label: "有阶段失败", color: "danger" },
};

export const ROLE_LABELS: Record<string, string> = {
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

const ROLE_MATCHERS: [RegExp, string][] = [
  [/protagonist|主角/, "主角"],
  [/antagonist|反派/, "反派"],
  [/deuteragonist|第二/, "第二主角"],
  [/mentor|导师/, "导师"],
  [/love|情感|恋人/, "情感线"],
  [/foil|对照/, "对照角色"],
  [/sidekick|伙伴/, "伙伴"],
  [/cameo|龙套/, "龙套"],
];

/** 人物定位标签（中英混写的返回都能认） */
export function roleLabel(raw: unknown): string {
  const s = pick(raw, "role", "定位", "position").toLowerCase();
  if (!s) return "配角";
  for (const [re, label] of ROLE_MATCHERS) if (re.test(s)) return label;
  return s;
}
