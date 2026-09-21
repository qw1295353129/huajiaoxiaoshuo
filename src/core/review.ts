import type { ID, ISO, Timestamped } from './base';

/**
 * 审稿协作模型。
 *
 * 设计取舍：评论与修订建议都**锚定在正文纯文本偏移上**（而不是 TipTap 的 ProseMirror 位置）。
 * 原因：ProseMirror 位置会随任何一次编辑漂移，作者改一个字，所有评论就错位了；
 * 偏移量虽然也会漂移，但可以在每次读正文时用"引用原文"重新定位，实现简单且足够稳。
 */

/** 评论锚点：记录引用原文与偏移，用于在正文里重新定位 */
export interface ReviewAnchor {
  /** 纯文本起始偏移（可能因编辑而漂移，定位时以 quote 为准） */
  from: number;
  to: number;
  /** 引用原文，定位的权威依据 */
  quote: string;
  /** 引用前后各 20 字，用于在 quote 重复时消歧 */
  prefix?: string;
  suffix?: string;
}

export interface CommentReply {
  id: ID;
  author: string;
  body: string;
  createdAt: ISO;
}

/** 行内评论 / 批注 */
export interface ChapterComment extends Timestamped {
  id: ID;
  projectId: ID;
  chapterId: ID;
  anchor?: ReviewAnchor;
  author: string;
  body: string;
  /** 评论线程 */
  replies: CommentReply[];
  resolved: boolean;
  /** 评论类型：普通批注 / 审稿清单项 / 问题定位 */
  kind: 'note' | 'checklist' | 'issue';
  /** kind = issue 时关联的问题 id */
  issueId?: ID;
  /** 审稿清单项的标签，如"新人首章必须有钩子" */
  checklistLabel?: string;
}

export type SuggestionStatus = 'pending' | 'accepted' | 'rejected';

/** 修订建议：替换 / 删除 / 插入 */
export interface ReviewSuggestion extends Timestamped {
  id: ID;
  projectId: ID;
  chapterId: ID;
  kind: 'replace' | 'delete' | 'insert';
  anchor: ReviewAnchor;
  /** 替换或插入的新文本；kind = delete 时为空 */
  proposed: string;
  /** 建议理由 */
  reason?: string;
  author: string;
  status: SuggestionStatus;
  /** 来源：人写的，还是 AI 生成的 */
  source: 'human' | 'ai';
  /** AI 生成时记录任务类型与生成记录 id */
  taskKind?: string;
  generationId?: ID;
  resolvedAt?: ISO;
}

/** 审稿清单模板：给编辑用的检查项 */
export interface ChecklistItem {
  id: string;
  label: string;
  /** 作用范围 */
  scope: 'chapter' | 'book';
  /** 说明，展示在提示里 */
  hint?: string;
  /** 是否需要逐章勾选 */
  perChapter?: boolean;
}

/** 内置审稿清单——新人稿与连载稿最常被退的问题 */
export const BUILTIN_CHECKLIST: ChecklistItem[] = [
  { id: 'hook-first-300', label: '前 300 字有钩子', scope: 'chapter', hint: '读者决定是否继续读，通常只给前 300 字', perChapter: true },
  { id: 'protagonist-goal', label: '主角本章有明确目标', scope: 'chapter', hint: '没有目标的章节等于没有张力', perChapter: true },
  { id: 'conflict-present', label: '存在真实阻力', scope: 'chapter', hint: '阻力可以是人、环境、或自身', perChapter: true },
  { id: 'ending-hook', label: '结尾留了悬念', scope: 'chapter', hint: '让读者想翻下一页', perChapter: true },
  { id: 'pov-consistent', label: '视角没有越界', scope: 'chapter', hint: '限知视角不能写主角看不到的事', perChapter: true },
  { id: 'dialogue-distinct', label: '人物说话方式可区分', scope: 'chapter', hint: '遮住名字也能猜出是谁说的', perChapter: true },
  { id: 'no-info-dump', label: '没有设定倾倒', scope: 'chapter', hint: '背景信息要拆散在动作与对话里', perChapter: true },
  { id: 'name-consistent', label: '人名与称呼统一', scope: 'book', hint: '同一人不要换着叫' },
  { id: 'timeline-sane', label: '时间线没有矛盾', scope: 'book' },
  { id: 'foreshadow-tracked', label: '埋下的伏笔有回收计划', scope: 'book' },
  { id: 'word-count-ok', label: '章节长度在目标区间', scope: 'book', hint: '过短显得敷衍，过长读者会疲劳' },
];

/** 审稿会话统计：给审稿面板显示进度 */
export interface ReviewStats {
  comments: number;
  openComments: number;
  pendingSuggestions: number;
  accepted: number;
  rejected: number;
}
