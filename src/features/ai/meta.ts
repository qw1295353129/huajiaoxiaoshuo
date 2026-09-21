import type { Citation, ContextSource } from "@/core";

/** 一次生成的运行时元信息（仅当前会话内存中保留，落库的是 citations / usage） */
export interface RunMeta {
  model: string;
  providerId: string;
  ms: number;
  ok: boolean;
  error?: string;
  contextTokens: number;
  sources: ContextSource[];
}

/** 上下文来源的中文名 */
export const SOURCE_KIND_LABELS: Record<ContextSource["kind"], string> = {
  chapter: "章节正文",
  summary: "摘要",
  character: "人物",
  world: "世界观",
  thread: "伏笔支线",
  timeline: "时间线",
  rule: "写作规则",
  "user-note": "作者备注",
  retrieval: "检索片段",
};

/** 把上下文来源压成可落库的引用记录（ChatMessage.citations） */
export function toCitation(source: ContextSource): Citation {
  const citation: Citation = { label: source.label };
  if (source.kind === "chapter") citation.chapterId = source.refId;
  else if (source.kind === "world") citation.worldEntryId = source.refId;
  else if (source.kind === "thread") citation.threadId = source.refId;
  else citation.entityId = source.refId;
  return citation;
}

/**
 * 消息里没有运行时元信息时，按优先级兜底展示上下文来源：
 * 1. 消息落库的 contextSources（含 token 与裁剪标记，最完整）
 * 2. citations（只有标签，token 显示为 0）
 */
export function fallbackSources(citations?: Citation[], persisted?: ContextSource[]): ContextSource[] {
  if (persisted && persisted.length) return persisted;
  return (citations ?? []).map((c) => ({
    kind: c.chapterId ? "chapter" : c.worldEntryId ? "world" : c.threadId ? "thread" : "retrieval",
    refId: c.chapterId ?? c.worldEntryId ?? c.threadId ?? c.entityId,
    label: c.label,
    tokens: 0,
  }));
}
