import type { ID, ISO, StoryTime, Timestamped } from './base';

export type PovStyle =
  | 'first'          // 第一人称
  | 'third-limited'  // 第三人称限知
  | 'third-omniscient'
  | 'second'         // 第二人称
  | 'mixed';

export type TenseStyle = 'past' | 'present';

export type ProjectStatus = 'planning' | 'drafting' | 'revising' | 'completed' | 'archived';

export type LengthClass = 'short' | 'novella' | 'novel' | 'epic' | 'webnovel';

/** 作品核心元数据 */
export interface Project extends Timestamped {
  id: ID;
  title: string;
  subtitle?: string;
  author?: string;
  /** 一句话故事（logline） */
  logline?: string;
  synopsis?: string;
  genres: string[];
  tags: string[];
  themes: string[];
  pov: PovStyle;
  tense: TenseStyle;
  /** 主要叙事人称对应的角色（第一人称时必填） */
  narratorId?: ID;
  targetWords: number;
  targetChapterWords: number;
  lengthClass: LengthClass;
  status: ProjectStatus;
  /** 参考风格：描述性文字，进入 system prompt */
  styleGuide?: string;
  /** 禁用词 / 写作红线 */
  forbidden: string[];
  /** 自定义补充指令，直接拼进 system prompt */
  customInstructions?: string;
  coverColor?: string;
  language: string;
  /** 已完成 AI 建档的版本号，用于判断是否需要重建 */
  bibleVersion?: number;
  stats: ProjectStats;
}

export interface ProjectStats {
  words: number;
  chapters: number;
  /** 已写的场景数 */
  scenes: number;
  /** 首次创作时间 */
  startedAt?: ISO;
  lastWrittenAt?: ISO;
  /** 累计写作天数 */
  writingDays: number;
}

/** 一句话灵感 → 完整故事圣经 的会话记录 */
export interface GenesisRun extends Timestamped {
  id: ID;
  projectId: ID;
  /** 用户的种子输入 */
  seed: string;
  seedKind: 'idea' | 'title' | 'premise' | 'world';
  /** 用户勾选的约束 */
  constraints: GenesisConstraints;
  /** 分阶段产物 */
  stages: GenesisStage[];
  status: 'pending' | 'running' | 'done' | 'failed';
  error?: string;
  appliedAt?: ISO;
}

export interface GenesisConstraints {
  genres: string[];
  lengthClass: LengthClass;
  pov: PovStyle;
  toneKeywords: string[];
  /** 参考作品（用于风格，不做抄袭） */
  references: string[];
  avoid: string[];
}

export type GenesisStageKind =
  | 'premise'      // 核心前提 / 高概念
  | 'characters'   // 主要人物
  | 'world'        // 世界观
  | 'structure'    // 三幕/多卷结构
  | 'outline'      // 章节大纲
  | 'firstScene';  // 开篇场景

export interface GenesisStage {
  kind: GenesisStageKind;
  status: 'pending' | 'running' | 'done' | 'failed';
  /** 原始 JSON 结果，按 kind 对应不同结构 */
  data?: unknown;
  raw?: string;
  error?: string;
  model?: string;
  tokens?: number;
  ms?: number;
}

export interface WritingGoal extends Timestamped {
  id: ID;
  projectId: ID;
  /** 每日目标字数 */
  dailyWords: number;
  /** 截止日期 */
  deadline?: ISO;
  /** 每周目标 */
  weeklyWords?: number;
  enabled: boolean;
}

export interface WritingSession extends Timestamped {
  id: ID;
  projectId: ID;
  chapterId?: ID;
  startedAt: ISO;
  endedAt?: ISO;
  /** 本次新增字符数（净增） */
  wordsAdded: number;
  wordsRemoved: number;
  /** 键盘活跃毫秒数 */
  activeMs: number;
  /** 心流模式 */
  flow: boolean;
  note?: string;
}

export interface PomodoroRecord extends Timestamped {
  id: ID;
  projectId: ID;
  startedAt: ISO;
  minutes: number;
  completed: boolean;
  wordsAdded: number;
}

export interface TimelineEvent extends Timestamped {
  id: ID;
  projectId: ID;
  title: string;
  description?: string;
  /** 剧情内时间 */
  inWorldTime: StoryTime;
  /** 数值化排序键，允许跨时间轴排序 */
  orderKey: number;
  /** 持续天数，0 表示瞬时事件 */
  durationDays?: number;
  /** 发生在哪些章节 */
  chapterIds: ID[];
  participantIds: ID[];
  locationId?: ID;
  importance: 1 | 2 | 3 | 4 | 5;
  /** 卷/幕归属 */
  arcId?: ID;
}
