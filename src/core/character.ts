import type { ID, ISO, Timestamped } from './base';

export type CharacterRole =
  | 'protagonist' | 'antagonist' | 'deuteragonist' | 'mentor'
  | 'foil' | 'love-interest' | 'sidekick' | 'minor' | 'cameo';

export type CharacterStatus = 'alive' | 'dead' | 'missing' | 'unknown' | 'transformed';

export interface Character extends Timestamped {
  id: ID;
  projectId: ID;
  name: string;
  /** 别名 / 称呼，用于一致性检测识别同一人 */
  aliases: string[];
  role: CharacterRole;
  /** 一句话定位 */
  tagline?: string;
  age?: string;
  gender?: string;
  pronouns?: string;
  appearance?: string;
  personality?: string;
  /** 说话方式：口癖、语气、常用词、禁用词 */
  voice?: CharacterVoice;
  /** 背景故事 */
  background?: string;
  /** 核心欲望 */
  want?: string;
  /** 真正需要 */
  need?: string;
  /** 内心恐惧 */
  fear?: string;
  /** 致命缺陷 */
  flaw?: string;
  /** 人物弧光 */
  arc?: string;
  /** 秘密 */
  secrets?: string;
  /** 技能 / 能力 */
  abilities?: string[];
  /** 所属势力 */
  factionIds: ID[];
  /** 首次出场章节 */
  firstAppearanceChapterId?: ID;
  status: CharacterStatus;
  /** 角色专属写作提示，进入 AI 上下文 */
  writingNotes?: string;
  color?: string;
  avatarEmoji?: string;
  tags: string[];
  /** 角色在故事中的状态变化节点 */
  milestones: CharacterMilestone[];
  /** 用户自定义扩展字段 */
  custom: Record<string, string>;
}

/** 让人物说话"像他"：用于对话风格校验和生成 */
export interface CharacterVoice {
  /** 语气标签：冷淡/咋呼/文绉绉 */
  tone?: string;
  /** 口癖、句尾助词 */
  verbalTics?: string[];
  /** 常用词 */
  favoriteWords?: string[];
  /** 绝不会说的话 */
  neverSays?: string[];
  /** 平均句长 */
  sentenceLength?: 'short' | 'medium' | 'long';
  /** 语域：粗俗/日常/文雅/古风/学术 */
  register?: string;
  /** 示例台词（few-shot） */
  sampleLines?: string[];
  /** 潜台词习惯 */
  subtext?: string;
}

export interface CharacterMilestone {
  id: ID;
  chapterId?: ID;
  /** 剧情内时间 */
  storyTime?: string;
  label: string;
  detail?: string;
}

export type RelationKind =
  | 'family' | 'lover' | 'spouse' | 'friend' | 'ally' | 'rival'
  | 'enemy' | 'mentor' | 'student' | 'colleague' | 'subordinate'
  | 'superior' | 'acquaintance' | 'other';

/** 人物关系（有向边） */
export interface Relationship extends Timestamped {
  id: ID;
  projectId: ID;
  fromId: ID;
  toId: ID;
  kind: RelationKind;
  /** 单向情感值 -100..100 */
  affinity: number;
  /** 公开程度 */
  visibility: 'public' | 'secret' | 'one-sided';
  /** 关系描述 */
  description?: string;
  sinceChapterId?: ID;
  endedChapterId?: ID;
  /** 关系演变 */
  history: { chapterId?: ID; affinity: number; note?: string }[];
}

/** AI 从正文抽取的人物卡（待人工确认） */
export interface ExtractedCharacter {
  name: string;
  aliases: string[];
  role?: CharacterRole;
  evidence: { chapterId: ID; quote: string }[];
  suggestedFields: Partial<Pick<Character, 'tagline' | 'appearance' | 'personality' | 'age' | 'gender'>>;
  confidence: number;
}

export interface CharacterAppearance {
  /** 复合主键：`${characterId}::${chapterId}` */
  id: string;
  characterId: ID;
  chapterId: ID;
  mentioned: number;
  dialogueLines: number;
  words: number;
  /** 该章时的角色状态描述 */
  state?: string;
  sceneIds?: ID[];
}

export interface NameVariant {
  canonical: ID;
  variants: string[];
  updatedAt: ISO;
}
