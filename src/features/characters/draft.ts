import type { Character, CharacterRole, CharacterStatus, CharacterVoice } from "@/core";

/**
 * 详情页的编辑草稿：把 Character 摊平成字符串/数组，方便受控输入。
 * 保存时只提交当前区块涉及的字段，避免整对象回写覆盖别处的改动。
 */

export type SentenceLength = "" | "short" | "medium" | "long";

export interface VoiceDraft {
  tone: string;
  register: string;
  verbalTics: string[];
  favoriteWords: string[];
  neverSays: string[];
  sentenceLength: SentenceLength;
  sampleLines: string[];
  subtext: string;
}

export interface CharacterDraft {
  name: string;
  aliases: string[];
  role: CharacterRole;
  tagline: string;
  age: string;
  gender: string;
  pronouns: string;
  status: CharacterStatus;
  avatarEmoji: string;
  tags: string[];
  writingNotes: string;
  appearance: string;
  personality: string;
  background: string;
  want: string;
  need: string;
  fear: string;
  flaw: string;
  arc: string;
  secrets: string;
  abilities: string[];
  voice: VoiceDraft;
}

export type DraftKey = keyof CharacterDraft;

/** 区块 -> 字段，保存按钮按区块提交 */
export const SECTIONS = {
  basics: ["name", "aliases", "role", "tagline", "age", "gender", "pronouns", "status", "avatarEmoji", "tags", "writingNotes"],
  appearance: ["appearance"],
  personality: ["personality"],
  drive: ["want", "need", "fear", "flaw"],
  arc: ["arc", "secrets"],
  abilities: ["abilities"],
  background: ["background"],
  voice: ["voice"],
} as const satisfies Record<string, readonly DraftKey[]>;

export type SectionKey = keyof typeof SECTIONS;

export function emptyVoice(): VoiceDraft {
  return {
    tone: "",
    register: "",
    verbalTics: [],
    favoriteWords: [],
    neverSays: [],
    sentenceLength: "",
    sampleLines: [],
    subtext: "",
  };
}

function voiceToDraft(v?: CharacterVoice): VoiceDraft {
  return {
    tone: v?.tone ?? "",
    register: v?.register ?? "",
    verbalTics: v?.verbalTics ?? [],
    favoriteWords: v?.favoriteWords ?? [],
    neverSays: v?.neverSays ?? [],
    sentenceLength: (v?.sentenceLength as SentenceLength) ?? "",
    sampleLines: v?.sampleLines ?? [],
    subtext: v?.subtext ?? "",
  };
}

/** Character -> 草稿。所有可空字段统一成空字符串/空数组，脏检查才好比较 */
export function toDraft(c: Character): CharacterDraft {
  return {
    name: c.name ?? "",
    aliases: c.aliases ?? [],
    role: c.role ?? "minor",
    tagline: c.tagline ?? "",
    age: c.age ?? "",
    gender: c.gender ?? "",
    pronouns: c.pronouns ?? "",
    status: c.status ?? "unknown",
    avatarEmoji: c.avatarEmoji ?? "",
    tags: c.tags ?? [],
    writingNotes: c.writingNotes ?? "",
    appearance: c.appearance ?? "",
    personality: c.personality ?? "",
    background: c.background ?? "",
    want: c.want ?? "",
    need: c.need ?? "",
    fear: c.fear ?? "",
    flaw: c.flaw ?? "",
    arc: c.arc ?? "",
    secrets: c.secrets ?? "",
    abilities: c.abilities ?? [],
    voice: voiceToDraft(c.voice),
  };
}

/** 键排序后的稳定序列化：用于脏检查，避免对象字面量顺序不同导致误判 */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(stableJson).join(",") + "]";
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return (
      "{" +
      Object.keys(obj)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + stableJson(obj[k]))
        .join(",") +
      "}"
    );
  }
  return JSON.stringify(value ?? null);
}

function pick(source: CharacterDraft, keys: readonly DraftKey[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = source[k];
  return out;
}

/** 某个区块相对数据库里的值是否有改动 */
export function isSectionDirty(draft: CharacterDraft, current: CharacterDraft, keys: readonly DraftKey[]): boolean {
  return stableJson(pick(draft, keys)) !== stableJson(pick(current, keys));
}

/** 全部可编辑字段：头部"保存全部"用 */
export const ALL_DRAFT_KEYS: DraftKey[] = ["name", "aliases", "role", "tagline", "age", "gender", "pronouns", "status", "avatarEmoji", "tags", "writingNotes", "appearance", "personality", "background", "want", "need", "fear", "flaw", "arc", "secrets", "abilities", "voice"];

/** 是否有任何区块有改动（用于头部"保存全部"） */
export function isAnyDirty(draft: CharacterDraft, current: CharacterDraft): boolean {
  return isSectionDirty(draft, current, ALL_DRAFT_KEYS);
}

/** 空字符串 -> undefined，空数组保留（数组本身是合法值） */
function textOrUndefined(v: string): string | undefined {
  const t = v.trim();
  return t ? v : undefined;
}

function cleanVoice(v: VoiceDraft): CharacterVoice | undefined {
  const out: CharacterVoice = {};
  if (v.tone.trim()) out.tone = v.tone.trim();
  if (v.register.trim()) out.register = v.register.trim();
  if (v.verbalTics.length) out.verbalTics = v.verbalTics;
  if (v.favoriteWords.length) out.favoriteWords = v.favoriteWords;
  if (v.neverSays.length) out.neverSays = v.neverSays;
  if (v.sentenceLength) out.sentenceLength = v.sentenceLength;
  if (v.sampleLines.length) out.sampleLines = v.sampleLines;
  if (v.subtext.trim()) out.subtext = v.subtext.trim();
  return Object.keys(out).length ? out : undefined;
}

/** 草稿区块 -> updateCharacter 的补丁（只含该区块字段） */
export function buildPatch(draft: CharacterDraft, keys: readonly DraftKey[]): Partial<Character> {
  const patch: Record<string, unknown> = {};
  for (const key of keys) {
    if (key === "voice") {
      patch.voice = cleanVoice(draft.voice);
      continue;
    }
    const value = draft[key];
    if (Array.isArray(value)) {
      patch[key] = value;
      continue;
    }
    if (key === "name") {
      // 姓名是必填项，由调用方校验，这里只去空格
      patch.name = draft.name.trim();
      continue;
    }
    if (typeof value === "string") {
      patch[key] = textOrUndefined(value);
      continue;
    }
    patch[key] = value;
  }
  return patch as Partial<Character>;
}
