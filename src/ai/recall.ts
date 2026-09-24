import type { ID, MemoryFact } from '@/core';
import { buildRecallQuery } from '@/db/repo/memory';
import { cosine, embedOne, embeddingSettings, lastEmbeddingError, memoryVectors } from './embedding';

/**
 * 语义召回：按"当前在写什么"挑记忆。
 *
 * 为什么需要它：记忆多了之后，按 credibility 排序注入其实是在赌 ——
 * 一条很可信但和当前章节毫不相干的记忆，会挤掉那条真正相关的。
 * 规则排序回答不了"这次该用哪几条"，只有把当前正文/大纲和记忆放进同一个向量空间才行。
 *
 * 三条设计上的取舍：
 *
 * 1. **合并而不是替换**：召回结果和规则排序结果**合并去重**，不是二选一。
 *    规则排序里的置顶与高可信条目是作者明确表态过的，不能被相似度顶掉；
 *    语义召回负责把"相关但不够可信、以前排不进前 12"的记忆捞上来。
 * 2. **置顶永远注入**：置顶的排在最前，且不受 limit 影响。
 * 3. **彻底降级**：开关没开、没有查询文本、服务不可达、模型没拉、返回格式不认识 ——
 *    任何一种情况都返回规则顺序，且不抛错、不弹窗、不写错误提示。
 *    唯一的痕迹是设置页里那一行"当前状态"，供想排查的人看。
 */

export interface RecallOutcome {
  /** 最终注入顺序（已合并去重） */
  facts: MemoryFact[];
  /** 是否真的用上了语义召回 */
  semantic: boolean;
  /** 被语义召回的 id（界面展示"这条为什么被注入"、测试断言都靠它） */
  pickedIds: ID[];
  /** 降级原因，只给设置页看，不打扰写作 */
  note?: string;
}

/**
 * 纯函数：把召回结果与规则排序合并。
 *
 * 顺序 = 置顶（原序） → 语义召回命中（相似度序） → 其余（规则序）。
 * 导出它是为了让"合并策略"能单独测，不必真的搭一个向量服务。
 */
export function mergeRecallOrder(ruleOrder: MemoryFact[], pickedIds: ID[], limit?: number): MemoryFact[] {
  const pinned = ruleOrder.filter((f) => f.pinned);
  const pinnedIds = new Set(pinned.map((f) => f.id));
  const picked: MemoryFact[] = [];
  for (const id of pickedIds) {
    const hit = ruleOrder.find((f) => f.id === id);
    if (hit && !pinnedIds.has(hit.id)) picked.push(hit);
  }
  const used = new Set<ID>([...pinnedIds, ...picked.map((f) => f.id)]);
  const rest = ruleOrder.filter((f) => !used.has(f.id));
  const merged = [...pinned, ...picked, ...rest];
  return limit && limit > 0 ? merged.slice(0, limit) : merged;
}

export interface RecallOptions {
  projectId: ID;
  /** 已经按规则排好序的候选记忆 */
  facts: MemoryFact[];
  /** 查询文本；不传则用「最近编辑章节的正文与大纲」（见 repo/memory.buildRecallQuery） */
  query?: string;
  chapterId?: ID;
  /** 合并后最多留几条 */
  limit?: number;
  /** 语义召回取几条；默认取设置里的 topK */
  topK?: number;
}

// ================= 全板块语义重排 =================
//
// 上下文各板块（人物/世界/伏笔/时间线/历史片段）先由规则选出候选，
// 再用这里的纯函数在候选内部按向量相似度重排。规则回答不了"这次该带哪些"，
// 但硬信号（本章出场、计划回收、置顶）必须留在最前 —— 所以重排只管非硬成员。

export interface RerankResult {
  /** 重排后的顺序；applied=false 时等于原候选顺序 */
  ids: ID[];
  /** 语义是否真的生效（false = 调用方直接用规则顺序） */
  applied: boolean;
}

export interface RerankOptions {
  /** 硬成员：保持规则顺序、永远排最前、不受相似度影响 */
  hardIds?: ID[];
  /** 非硬成员最多留几个（硬成员不占预算、不被裁掉） */
  limit?: number;
}

/**
 * 纯函数：候选集内部按余弦相似度重排。
 *
 * 顺序 = 硬成员（规则序） → 相似度为正的（相似度序，同分保持规则序）。
 * 三种不生效的情况（返回 applied=false，调用方退回规则顺序）：
 * 1. 没有 query 向量；
 * 2. 没有非硬候选可排；
 * 3. 非硬候选里一条相似度都没有 —— 与 recallMemories 的
 *    "没有相似度为正就退回规则排序"保持一致，避免语义链路把内容清空。
 *
 * 相似度 <= 0 或缺向量的非硬候选在生效时被剔除（"取舍"就是它们）；
 * limit 只作用于非硬成员。
 */
export function rerankBySimilarity(
  candidates: ID[],
  vectors: Map<ID, number[]>,
  queryVec: number[] | null,
  opts: RerankOptions = {},
): RerankResult {
  if (!candidates.length) return { ids: [], applied: false };
  if (!queryVec || !queryVec.length) return { ids: candidates, applied: false };

  const candSet = new Set(candidates);
  const hardSet = new Set((opts.hardIds ?? []).filter((id) => candSet.has(id)));
  const hard = candidates.filter((id) => hardSet.has(id));
  const rest = candidates.filter((id) => !hardSet.has(id));
  if (!rest.length) return { ids: candidates, applied: false };

  const scored: { id: ID; score: number }[] = [];
  for (const id of rest) {
    const vec = vectors.get(id);
    if (!vec) continue;
    const score = cosine(queryVec, vec);
    if (score > 0) scored.push({ id, score });
  }
  if (!scored.length) return { ids: candidates, applied: false };

  scored.sort((a, b) => b.score - a.score); // 稳定排序：同分保持规则序
  const limit = opts.limit && opts.limit > 0 ? opts.limit : scored.length;
  return { ids: [...hard, ...scored.slice(0, limit).map((s) => s.id)], applied: true };
}

// ================= 历史段落分片 =================

/** 单段超过这个长度按句截断（缓存与嵌入都按截断后的文本走） */
export const PASSAGE_MAX_CHARS = 600;
/** 短于这个长度的段没有检索价值（与原 BM25 取段口径一致） */
export const PASSAGE_MIN_CHARS = 20;

export interface PassageChunk {
  /** chapterId:序号；序号在保留段落中连续，正文变化后靠 text 判缓存失效 */
  id: string;
  text: string;
}

/**
 * 纯函数：章节正文 → 段落级分片。
 *
 * 按换行切段、丢掉 <=20 字的短段，超长段按句截到 600 字（一句就超的硬切）。
 * 粒度与原 BM25 检索一致，召回输出格式（章节 + 片段）不用变。
 */
export function splitPassages(chapterId: ID, text: string): PassageChunk[] {
  const out: PassageChunk[] = [];
  const paras = (text ?? '').split(/\n+/).map((p) => p.trim()).filter((p) => p.length > PASSAGE_MIN_CHARS);
  for (const p of paras) {
    out.push({ id: chapterId + ':' + out.length, text: truncateAtSentence(p, PASSAGE_MAX_CHARS) });
  }
  return out;
}

/** 按句截断到 max 字：优先在句尾收口，第一句就超长时硬切 */
function truncateAtSentence(s: string, max: number): string {
  if (s.length <= max) return s;
  const sentences = s.match(/[^。！？!?；;]+[。！？!?；;]?/g);
  if (!sentences) return s.slice(0, max);
  let acc = '';
  for (const sent of sentences) {
    if (acc.length && acc.length + sent.length > max) break;
    acc += sent;
    if (acc.length >= max) break;
  }
  return acc.slice(0, max);
}

export async function recallMemories(opts: RecallOptions): Promise<RecallOutcome> {
  const { facts } = opts;
  if (!facts.length) return { facts, semantic: false, pickedIds: [] };

  const cfg = embeddingSettings();
  // 默认关闭：没开就一定不做任何额外工作（不读章节、不发请求），行为与改动前完全一致
  if (!cfg.enabled) return { facts, semantic: false, pickedIds: [] };

  let query = (opts.query ?? '').trim();
  if (!query) {
    try {
      query = (await buildRecallQuery(opts.projectId, opts.chapterId)).trim();
    } catch {
      query = '';
    }
  }
  if (!query) return { facts, semantic: false, pickedIds: [], note: '还没有正文或大纲可以作为召回query' };

  const queryVec = await embedOne(query, cfg);
  if (!queryVec) {
    return { facts, semantic: false, pickedIds: [], note: lastEmbeddingError() ?? '向量服务不可用，已退回规则排序' };
  }

  const { vectors } = await memoryVectors(opts.projectId, facts, cfg);
  if (!vectors.size) {
    return { facts, semantic: false, pickedIds: [], note: lastEmbeddingError() ?? '没有可用的记忆向量，已退回规则排序' };
  }

  const topK = Math.max(1, opts.topK ?? cfg.topK);
  const scored = facts
    .filter((f) => vectors.has(f.id))
    .map((f) => ({ fact: f, score: cosine(queryVec, vectors.get(f.id) as number[]) }))
    .sort((a, b) => b.score - a.score);
  // 相似度 <= 0 说明方向都不同（或向量是零向量），这种"召回"没有意义
  const pickedIds = scored.filter((s) => s.score > 0).slice(0, topK).map((s) => s.fact.id);

  if (!pickedIds.length) {
    return { facts, semantic: false, pickedIds: [], note: '没有相似度为正的记忆，已退回规则排序' };
  }

  return {
    facts: mergeRecallOrder(facts, pickedIds, opts.limit),
    semantic: true,
    pickedIds,
  };
}
