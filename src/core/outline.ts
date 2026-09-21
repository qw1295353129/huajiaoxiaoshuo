import type { ID, StoryTime, Timestamped } from './base';

export type ArcKind = 'volume' | 'part' | 'act' | 'subplot' | 'side-story';
export type ArcStatus = 'planned' | 'writing' | 'done' | 'abandoned';

/** 卷 / 部 / 幕 */
export interface Arc extends Timestamped {
  id: ID;
  projectId: ID;
  title: string;
  kind: ArcKind;
  summary?: string;
  order: number;
  status: ArcStatus;
  targetWords?: number;
  /** 本卷的叙事目标（主角想要什么 / 阻碍是什么） */
  goal?: string;
  conflict?: string;
  outcome?: string;
  color?: string;
}

export type ChapterStatus = 'idea' | 'outlined' | 'drafting' | 'drafted' | 'revising' | 'done' | 'cut';

export interface Chapter extends Timestamped {
  id: ID;
  projectId: ID;
  arcId?: ID;
  title: string;
  /** 大纲摘要 / 章节目标 */
  summary?: string;
  /** 本章要完成的剧情推进点 */
  goals: string[];
  /** POV 角色 */
  povCharacterId?: ID;
  /** 出场角色 */
  characterIds: ID[];
  locationIds: ID[];
  /** 剧情内时间 */
  storyTime?: StoryTime;
  order: number;
  status: ChapterStatus;
  /** 正文词数（缓存值） */
  wordCount: number;
  /** 情绪强度 -5..5，用于情绪曲线 */
  tension: number;
  /** 悬念钩子 */
  hook?: string;
  /** 章节结尾的钩子 */
  cliffhanger?: string;
  /** 本章埋设/回收的伏笔 */
  plantsThreadIds: ID[];
  paysThreadIds: ID[];
  /** 主要冲突类型 */
  conflictType?: ConflictType;
  /** 场景节拍 */
  beats: Beat[];
  notes?: string;
  /** 标签 */
  tags: string[];
}

export type ConflictType =
  | 'man-vs-self' | 'man-vs-man' | 'man-vs-nature'
  | 'man-vs-society' | 'man-vs-fate' | 'man-vs-technology' | 'none';

/** 场景 / 节拍 */
export interface Beat {
  id: ID;
  /** 一句话概括 */
  summary: string;
  kind: BeatKind;
  /** 情绪值 */
  tension?: number;
  done: boolean;
}

export type BeatKind =
  | 'setup' | 'hook' | 'inciting' | 'rising' | 'midpoint'
  | 'complication' | 'crisis' | 'climax' | 'resolution' | 'breather' | 'reveal';

/** 正文单独存表，避免列表页加载大文本 */
export interface ChapterContent {
  chapterId: ID;
  projectId: ID;
  /** HTML（TipTap） */
  html: string;
  /** 纯文本缓存，用于检索/统计 */
  text: string;
  updatedAt: string;
  /** 内容版本号，用于乐观并发 */
  rev: number;
}

/** 版本快照 */
export interface Snapshot extends Timestamped {
  id: ID;
  projectId: ID;
  chapterId: ID;
  label: string;
  kind: 'manual' | 'auto' | 'pre-ai' | 'post-ai' | 'import';
  html: string;
  text: string;
  wordCount: number;
  /** AI 改写时记录任务 id */
  taskId?: ID;
}

export type OutlineNodeKind = 'premise' | 'theme' | 'arc' | 'chapter' | 'beat' | 'note';

/** 用于画布的树形大纲 */
export interface OutlineNode extends Timestamped {
  id: ID;
  projectId: ID;
  parentId?: ID;
  kind: OutlineNodeKind;
  title: string;
  body?: string;
  order: number;
  refId?: ID;
}
