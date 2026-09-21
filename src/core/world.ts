import type { ID, Timestamped } from './base';

export type WorldCategory =
  | 'geography' | 'history' | 'politics' | 'magic' | 'technology'
  | 'religion' | 'economy' | 'species' | 'culture' | 'organization'
  | 'item' | 'language' | 'custom';

export interface WorldEntry extends Timestamped {
  id: ID;
  projectId: ID;
  category: WorldCategory;
  title: string;
  aliases: string[];
  body: string;
  parentId?: ID;
  tags: string[];
  /** 硬设定规则，AI 生成时必须遵守 */
  rules: WorldRule[];
  /** 交叉引用 [[Title]] 由正文解析得到 */
  refs: ID[];
  /** 重要度 1..5 */
  importance: number;
  imageIds: ID[];
  custom: Record<string, string>;
}

/** 可校验的世界规则（如"内力每十年涨一阶"） */
export interface WorldRule {
  id: ID;
  /** 规则描述 */
  statement: string;
  /** 可机检形式：包含/不包含/正则/数值范围 */
  check?: {
    type: 'forbid-words' | 'require-words' | 'regex' | 'numeric';
    value: string;
    message?: string;
  };
  severity: 'info' | 'warn' | 'error';
  enabled: boolean;
}

export type EntityKind =
  | 'character' | 'world' | 'item' | 'faction' | 'location'
  | 'event' | 'concept' | 'creature' | 'skill' | 'term';

/** 通用实体表：AI 抽取的一切名词都进这里，用于图谱与检索 */
export interface Entity extends Timestamped {
  id: ID;
  projectId: ID;
  kind: EntityKind;
  name: string;
  aliases: string[];
  /** 指向具体实体的 id（人物卡 / 世界观条目） */
  refId?: ID;
  /** 一句话说明 */
  summary?: string;
  firstChapterId?: ID;
  /** 出现次数缓存 */
  mentions: number;
  /** 是否已被作者确认 */
  confirmed: boolean;
  tags: string[];
}

export interface EntityMention {
  id: ID;
  projectId: ID;
  entityId: ID;
  chapterId: ID;
  count: number;
  /** 首次出现的字符偏移 */
  firstOffset: number;
  /** 上下文片段 */
  sample: string;
}

/** 势力 / 组织 */
export interface Faction extends Timestamped {
  id: ID;
  projectId: ID;
  name: string;
  description?: string;
  leaderId?: ID;
  memberIds: ID[];
  /** 与其他势力的关系 */
  stance: Record<ID, 'ally' | 'neutral' | 'hostile' | 'vassal'>;
  power: number;
  color?: string;
}

export type ThreadKind = 'foreshadow' | 'subplot' | 'mystery' | 'promise' | 'arc' | 'theme';
export type ThreadStatus = 'planned' | 'planted' | 'partially-paid' | 'resolved' | 'abandoned' | 'overdue';

/** 伏笔 / 支线（Plot Thread） */
export interface PlotThread extends Timestamped {
  id: ID;
  projectId: ID;
  kind: ThreadKind;
  title: string;
  description?: string;
  /** 埋设章 */
  plantedChapterId?: ID;
  /** 计划回收章 */
  plannedPayoffChapterId?: ID;
  /** 实际回收章 */
  payoffChapterId?: ID;
  status: ThreadStatus;
  /** 重要度：主线 / 支线 / 彩蛋 */
  priority: 'main' | 'major' | 'minor';
  /** 关联实体 */
  entityIds: ID[];
  characterIds: ID[];
  /** 埋设时的原文片段 */
  plantQuote?: string;
  payoffQuote?: string;
  /** 最近一次出现的章节序号，用于"太久没提"告警 */
  lastSeenChapterOrder?: number;
  notes?: string;
}

/** 名词统一表：一个概念可能被写成多种叫法 */
export interface GlossaryTerm extends Timestamped {
  id: ID;
  projectId: ID;
  /** 标准写法 */
  canonical: string;
  variants: string[];
  /** 是否强制统一 */
  strict: boolean;
  note?: string;
}

export interface ContinuityRule extends Timestamped {
  id: ID;
  projectId: ID;
  name: string;
  description: string;
  /** 检查方式 */
  kind: 'forbidden' | 'required' | 'pattern' | 'custom-llm';
  /** 关键字或正则或自然语言规则 */
  value: string;
  severity: 'info' | 'warn' | 'error';
  enabled: boolean;
  scope: 'project' | 'chapter' | 'character';
  scopeId?: ID;
}
