import type { ID, ISO, Timestamped } from './base';
import type { AiTaskKind } from './ai';

/**
 * 写作记忆。
 *
 * 设计取舍（很重要，决定了它和"向量记忆"是两种东西）：
 *
 * 1. **可解释**：每条记忆都是一句人话，作者能看懂、能改、能删。
 *    不做黑箱向量检索——作者不知道系统"记住了什么"时，不会信任它。
 *
 * 2. **有出处**：每条都记得自己从哪来（哪次反馈、哪条建议、哪一章），
 *    点得回去。这样作者能判断"这条记忆还成立吗"。
 *
 * 3. **有证据计数**：同一个偏好被验证 5 次，比只出现 1 次的可信。
 *    confidence 随证据增长，注入时按可信度排序。
 *
 * 4. **可关闭**：任何一条都能暂停（data.paused），不必删除。
 */

export type MemoryScope = 'global' | 'project';
export type MemorySource = 'user' | 'feedback' | 'suggestion' | 'issue' | 'metrics' | 'review';

/** 记忆类型与应用方式 */
export type MemoryKind =
  /** 写作偏好：注入 system prompt，直接约束生成（如"不要总结腔"） */
  | 'preference'
  /** 教训：作者明确拒绝过的做法（如"别用长段心理描写"） */
  | 'lesson'
  /** 设定事实：注入上下文，保证前后一致（如"铜钟只在死者出现时响"） */
  | 'fact'
  /** 名词约定：称呼标准写法（如"沈砚"不写成"沈研"） */
  | 'convention'
  /** 工作习惯：只用于提示与统计，不进模型（如"平均 3 天写一章"） */
  | 'insight';

/** 哪些类型会注入给模型 */
export const MODEL_FACING_KINDS: MemoryKind[] = ['preference', 'lesson', 'fact', 'convention'];

export const MEMORY_KIND_LABEL: Record<MemoryKind, string> = {
  preference: '写作偏好',
  lesson: '经验教训',
  fact: '设定事实',
  convention: '名词约定',
  insight: '工作习惯',
};

export const MEMORY_SCOPE_LABEL: Record<MemoryScope, string> = {
  global: '全书通用',
  project: '仅本书',
};

export const MEMORY_SOURCE_LABEL: Record<MemorySource, string> = {
  user: '你手动添加',
  feedback: '来自你的反馈',
  suggestion: '来自采纳记录',
  issue: '来自一致性问题',
  metrics: '来自写作数据',
  review: '来自审稿',
};

/** 出处：能点回去的引用 */
export interface MemoryEvidence {
  /** 证据类型，决定跳转方式 */
  kind: 'feedback' | 'suggestion' | 'issue' | 'chapter' | 'manual' | 'reviewSuggestion';
  refId?: ID;
  chapterId?: ID;
  /** 证据原文（一句话） */
  quote: string;
  /** 记录时间，用于展示 */
  at: ISO;
}

export interface MemoryFact extends Timestamped {
  id: ID;
  scope: MemoryScope;
  /** scope = project 时必填 */
  projectId?: ID;
  kind: MemoryKind;
  /** 一句话说完，会直接拼进 prompt，所以要求短而具体 */
  text: string;
  /** 补充说明，给作者看，不进模型 */
  note?: string;
  source: MemorySource;
  /** 支撑这条记忆的证据，可多条 */
  evidence: MemoryEvidence[];
  /** 可信度 0~1，随证据数量与用户确认增长 */
  confidence: number;
  /** 作者手动置顶：永远注入，且不被预算裁掉 */
  pinned: boolean;
  /** 暂停使用（保留但不再注入） */
  paused: boolean;
  /** 生效范围：限定某类任务才注入 */
  taskKinds?: AiTaskKind[];
  /** 被注入过多少次 */
  usedCount: number;
  lastUsedAt?: ISO;
  /** 自动提取时的去重键，避免同一句话反复生成 */
  dedupeKey?: string;
  /**
   * 已判定过冲突、并给出处置意见的对方 id。
   *
   * 为什么记在记忆自己身上，而不是另开一张"冲突处置表"：
   * 1. 冲突是两条记忆之间的**属性**，处置结果跟着记忆走最自然：删掉一条，记录自动消失，
   *    不会留下一张需要级联清理、还可能指向已删记忆的孤表。
   * 2. 不需要再升一次数据库版本（这次已经为了 memoryUsage 升到 v4，能少一次就少一次）。
   * 3. 导出/备份/级联删除全都自动跟着走，不用在每个数据出口补一遍。
   * 代价是"谁先记的"信息会丢（双方都会记对方），但我们只需要知道"这对我处理过了"。
   */
  conflictsResolvedWith?: ID[];
}

/** 一次记忆提取的结果，供界面展示 diff */
export interface MemoryExtraction {
  /** 新发现的记忆 */
  created: MemoryFact[];
  /** 已有记忆获得新证据（confidence 提升） */
  reinforced: { fact: MemoryFact; evidence: MemoryEvidence }[];
  /** 本可以生成但被去重跳过的 */
  skipped: number;
  /** 扫描了哪些来源 */
  scanned: { feedback: number; suggestions: number; issues: number; review: number; sessions: number };
}

/**
 * 一条记忆被某次生成用过的记录（记忆效果追踪）。
 *
 * 为什么单独一张表，而不是在 MemoryFact 上再加计数器：
 * usedCount 只能回答"注入过几次"，回答不了"注入之后变好还是变坏"——后者必须把
 * **记忆**和**生成结果 / 作者评价**连起来。事实表里存不下这种一对多关系。
 *
 * generationId 复用 AiGeneration.id：评价（AiFeedback.generationId）本来就指向它，
 * 于是"用了哪些记忆 → 这次生成 → 作者给了什么评价"这条链不用引入任何新 id。
 */
export interface MemoryUsage {
  id: ID;
  projectId: ID;
  /** 关联的 AiGeneration.id；生成没落库（如模型不可用）时为 undefined */
  generationId?: ID;
  factId: ID;
  /** 这条记忆是怎么被选中的：规则排序 or 语义召回。用于排查"为什么这次注入了它" */
  via?: 'rule' | 'semantic';
  createdAt: ISO;
}

/** 一条记忆的效果统计（由 memoryUsage + feedback 聚合而来） */
export interface MemoryEffect {
  factId: ID;
  /** 被注入的总次数 */
  injections: number;
  /** 参与过的生成次数（去重） */
  generations: number;
  /** 其中被作者评价过的生成次数 */
  rated: number;
  /** 被评价为差评的生成次数 */
  negative: number;
  /** 差评率 = negative / rated；没有评价时为 0（不是"差"） */
  badRate: number;
  lastUsedAt?: ISO;
  /** 注入够多 + 差评率够高 → 建议暂停。只提示，绝不自动暂停 */
  suggestPause: boolean;
}

export const MEMORY_MIN_CONFIDENCE = 0.25;

/** 「建议暂停」的门槛：注入 ≥5 次且差评率 ≥50%（写在一处，界面与统计共用） */
export const MEMORY_SUGGEST_PAUSE_MIN_INJECTIONS = 5;
export const MEMORY_SUGGEST_PAUSE_BAD_RATE = 0.5;

/** 由证据数量推算可信度（手动置顶的按 1 处理） */
export function confidenceFrom(evidenceCount: number, source: MemorySource): number {
  // 作者亲手写的直接可信；自动提取的按证据数缓慢增长
  if (source === 'user') return 1;
  return Math.min(0.9, 0.3 + evidenceCount * 0.15);
}
