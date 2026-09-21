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

export const MEMORY_MIN_CONFIDENCE = 0.25;

/** 由证据数量推算可信度（手动置顶的按 1 处理） */
export function confidenceFrom(evidenceCount: number, source: MemorySource): number {
  // 作者亲手写的直接可信；自动提取的按证据数缓慢增长
  if (source === 'user') return 1;
  return Math.min(0.9, 0.3 + evidenceCount * 0.15);
}
