/** 全局基础类型。所有实体共用一套 ID / 时间戳约定。 */

export type ID = string;
/** ISO-8601 字符串 */
export type ISO = string;
/** 剧情内时间：允许 "第3年·春" 这类模糊描述 */
export type StoryTime = string;

export interface Timestamped {
  createdAt: ISO;
  updatedAt: ISO;
}

export function isDefined<T>(v: T | null | undefined): v is T {
  return v !== null && v !== undefined;
}

export type SortOrder = 'asc' | 'desc';

/** 所有可被 AI 引用的实体都实现它，用于上下文组装与引用追溯 */
export interface Contextual {
  id: ID;
  /** 给模型看的紧凑文本表示 */
  toContextBlock(): string;
}
