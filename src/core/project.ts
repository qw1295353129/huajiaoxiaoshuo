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

/**
 * 篇幅档案：篇幅是"这本书有多大"的唯一真相来源。
 *
 * 之前项目里只有「篇幅 → 目标字数」的映射（还散落在 onboarding 里），
 * 而「每卷章节数」写死 12、不随篇幅变化 —— 短篇和中篇会得到同样的 12 章，
 * 生成出来的结构当然不对（短篇 1 万字被拆成 12 章，每章不到 1000 字）。
 *
 * 这里把三者绑在一起：一遍篇幅确定，字数、卷数、每卷章节数、单章字数都跟着定。
 * 数值取自各类篇幅的常见做法，都可在界面上改。
 */
export interface LengthProfile {
  /** 目标总字数 */
  targetWords: number;
  /** 建议卷数 */
  volumes: number;
  /** 每卷章节数（默认值） */
  chaptersPerVolume: number;
  /** 单章目标字数 */
  chapterWords: number;
  /** 界面上的说明 */
  hint: string;
}

/**
 * 各篇幅的默认值。
 *
 * 这些数字必须**自洽**：卷数 × 每卷章数 × 单章字数 ≈ 目标字数。
 * 第一版就是按直觉写的，结果网文 5×40×2500 = 50 万字，而目标是 150 万字，
 * 差了整整三倍 —— 生成出来的结构必然和篇幅对不上。测试里专门有一条自洽性检查。
 *
 * 数值取中文长篇小说与网文的常见做法，都可在界面上改。
 */
export const LENGTH_PROFILES: Record<LengthClass, LengthProfile> = {
  // 短篇一次写完，不分卷，重点在"一口气读完"
  short: { targetWords: 10000, volumes: 1, chaptersPerVolume: 5, chapterWords: 2000, hint: '1 万字以内' },
  // 中篇有章节节奏，通常仍是一卷
  novella: { targetWords: 60000, volumes: 1, chaptersPerVolume: 15, chapterWords: 4000, hint: '3~8 万字' },
  // 传统长篇：每卷 40 章属于常见规模
  novel: { targetWords: 360000, volumes: 4, chaptersPerVolume: 45, chapterWords: 2000, hint: '20~40 万字' },
  epic: { targetWords: 900000, volumes: 6, chaptersPerVolume: 60, chapterWords: 2500, hint: '80 万字以上' },
  // 网文连载：章节短、更新快，卷与章的数量都远多于传统长篇
  webnovel: { targetWords: 1500000, volumes: 10, chaptersPerVolume: 75, chapterWords: 2000, hint: '百万字以上' },
};

export function lengthProfile(k: LengthClass): LengthProfile {
  return LENGTH_PROFILES[k] ?? LENGTH_PROFILES.novel;
}

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
