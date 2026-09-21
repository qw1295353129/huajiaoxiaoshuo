import type {
  ID, MemoryConflict, MemoryEffect, MemoryEvidence, MemoryFact, MemoryKind, MemoryScope, MemorySource, MemoryUsage,
} from "@/core";
import {
  confidenceFrom, detectConflictBetween, findMemoryConflicts, profileMemory, textSimilarity,
  MEMORY_SUGGEST_PAUSE_BAD_RATE, MEMORY_SUGGEST_PAUSE_MIN_INJECTIONS,
} from "@/core";
import { db } from "../database";
import { newId } from "@/utils/id";
import { deleteEmbeddingsFor, listFeedback } from "./ai";

/** 记忆的读写。注入与展示都从这里取，保证排序与过滤规则只有一份。 */

export async function listMemory(
  opts: { scope?: MemoryScope; projectId?: ID; includePaused?: boolean } = {},
): Promise<MemoryFact[]> {
  const all = await db.memory.toArray();
  return all
    .filter((m) => (opts.scope ? m.scope === opts.scope : true))
    .filter((m) => (opts.scope === "project" && opts.projectId ? m.projectId === opts.projectId : true))
    .filter((m) => (opts.includePaused ? true : !m.paused))
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        b.confidence - a.confidence ||
        (a.createdAt < b.createdAt ? 1 : -1),
    );
}

/**
 * 取某本书应当注入的记忆：全局 + 本书自己的。
 * 排序：置顶 → 可信度 → 被用过次数，保证预算被裁时先保重要的。
 */
export async function memoryForProject(
  projectId: ID,
  opts: { includePaused?: boolean } = {},
): Promise<MemoryFact[]> {
  const all = await db.memory.toArray();
  return all
    .filter((m) => !m.paused || opts.includePaused)
    .filter((m) => m.scope === "global" || m.projectId === projectId)
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        b.confidence - a.confidence ||
        b.usedCount - a.usedCount ||
        (a.createdAt < b.createdAt ? 1 : -1),
    );
}

/** 去重键：同一句话不重复生成记忆 */
export function memoryDedupeKey(kind: MemoryKind, text: string): string {
  const PUNCT = /[\s\u3000，。、；：？！「」『』“”‘’（）《》【】…—·,.!?;:'"]/g;
  return kind + "::" + text.replace(PUNCT, "").toLowerCase().slice(0, 120);
}

export interface AddMemoryInput {
  scope: MemoryScope;
  projectId?: ID;
  kind: MemoryKind;
  text: string;
  note?: string;
  source?: MemorySource;
  evidence?: MemoryEvidence[];
  pinned?: boolean;
  taskKinds?: MemoryFact["taskKinds"];
}

export async function addMemory(input: AddMemoryInput): Promise<MemoryFact> {
  const now = new Date().toISOString();
  const fact: MemoryFact = {
    id: newId("mem"),
    scope: input.scope,
    projectId: input.scope === "project" ? input.projectId : undefined,
    kind: input.kind,
    text: input.text.trim(),
    note: input.note,
    source: input.source ?? "user",
    evidence: input.evidence ?? [],
    confidence: confidenceFrom(input.evidence?.length ?? 0, input.source ?? "user"),
    pinned: input.pinned ?? false,
    paused: false,
    taskKinds: input.taskKinds,
    usedCount: 0,
    dedupeKey: memoryDedupeKey(input.kind, input.text),
    createdAt: now,
    updatedAt: now,
  };
  await db.memory.put(fact);
  return fact;
}

export async function updateMemory(id: ID, patch: Partial<MemoryFact>): Promise<void> {
  await db.memory.where("id").equals(id).modify((m) => {
    Object.assign(m, patch, { updatedAt: new Date().toISOString() });
    if (patch.text) m.dedupeKey = memoryDedupeKey(m.kind, patch.text);
  });
}

/**
 * 删除一条记忆，并清掉它留下的派生数据。
 *
 * 为什么必须显式清理：Dexie 没有外键，memoryUsage（效果追踪）与 embeddings（向量缓存）
 * 都是围绕 factId 长出来的附属行。不清理的话，这些行会永远留在库里，
 * 而且会在"重新导入备份/新建同 id 记忆"时把旧统计与旧向量带回来，造成很难查的脏数据。
 */
export async function deleteMemory(id: ID): Promise<void> {
  await db.memory.delete(id);
  await db.memoryUsage.where("factId").equals(id).delete().catch(() => undefined);
  await deleteEmbeddingsFor(id);
  // 别人记着"和它已解决冲突"的那条引用也要抹掉，否则会留下指向空气的 id
  const others = await db.memory.toArray();
  for (const m of others) {
    if (m.conflictsResolvedWith?.includes(id)) {
      await updateMemory(m.id, { conflictsResolvedWith: m.conflictsResolvedWith.filter((x) => x !== id) });
    }
  }
}

export async function toggleMemoryPaused(id: ID): Promise<void> {
  const row = await db.memory.get(id);
  if (!row) return;
  await updateMemory(id, { paused: !row.paused });
}

export async function toggleMemoryPinned(id: ID): Promise<void> {
  const row = await db.memory.get(id);
  if (!row) return;
  const pinned = !row.pinned;
  await updateMemory(id, { pinned, confidence: pinned ? 1 : row.confidence });
}

/** 给一条记忆补证据；证据增加会提升可信度 */
export async function reinforceMemory(id: ID, evidence: MemoryEvidence): Promise<void> {
  await db.memory.where("id").equals(id).modify((m) => {
    if (m.evidence.some((e) => e.quote === evidence.quote && e.kind === evidence.kind)) return;
    m.evidence = [...m.evidence, evidence].slice(-12);
    m.confidence = confidenceFrom(m.evidence.length, m.source);
    m.updatedAt = new Date().toISOString();
  });
}

/** 标记被注入过；usedCount 让"一直有用"的记忆在排序里加权 */
export async function markMemoryUsed(ids: ID[]): Promise<void> {
  if (!ids.length) return;
  const now = new Date().toISOString();
  await db.memory.where("id").anyOf(ids).modify((m) => {
    m.usedCount += 1;
    m.lastUsedAt = now;
  });
}

export async function memoryStats(projectId?: ID): Promise<{
  total: number;
  active: number;
  paused: number;
  pinned: number;
  byKind: Record<string, number>;
}> {
  const all = await db.memory.toArray();
  const scoped = all.filter((m) => m.scope === "global" || (projectId ? m.projectId === projectId : false));
  const byKind: Record<string, number> = {};
  for (const m of scoped) byKind[m.kind] = (byKind[m.kind] ?? 0) + 1;
  return {
    total: scoped.length,
    active: scoped.filter((m) => !m.paused).length,
    paused: scoped.filter((m) => m.paused).length,
    pinned: scoped.filter((m) => m.pinned).length,
    byKind,
  };
}

/** 清空记忆（危险操作，UI 需二次确认） */
export async function clearMemory(scope?: MemoryScope, projectId?: ID): Promise<number> {
  const all = await db.memory.toArray();
  const targets = all
    .filter((m) => (scope ? m.scope === scope : true))
    .filter((m) => (scope === "project" && projectId ? m.projectId === projectId : true));
  for (const m of targets) await deleteMemory(m.id);
  return targets.length;
}

/* ------------------------------------------------------------------ *
 * 冲突检测与处置（纯本地，不调模型）
 * ------------------------------------------------------------------ */

export interface MemoryConflictPair {
  a: MemoryFact;
  b: MemoryFact;
  conflict: MemoryConflict;
}

/** 某本书相关的全部记忆（全局 + 本书），冲突扫描的输入范围 */
async function scopedMemory(projectId?: ID): Promise<MemoryFact[]> {
  const all = await db.memory.toArray();
  return all.filter((m) => m.scope === "global" || (projectId ? m.projectId === projectId : true));
}

/**
 * 扫描冲突对。
 *
 * 已经处置过的组合不会出现在结果里 —— 判定依据是记忆自己的 conflictsResolvedWith，
 * 所以"同一对不要反复提示"这件事不依赖界面状态，刷新页面、换设备导入备份之后依然成立。
 */
export async function scanMemoryConflicts(projectId?: ID): Promise<MemoryConflictPair[]> {
  const facts = await scopedMemory(projectId);
  const byId = new Map(facts.map((f) => [f.id, f]));
  const conflicts = findMemoryConflicts(facts);
  const out: MemoryConflictPair[] = [];
  for (const c of conflicts) {
    const a = byId.get(c.aId);
    const b = byId.get(c.bId);
    if (a && b) out.push({ a, b, conflict: c });
  }
  return out;
}

export interface MemoryDraftInput {
  scope: MemoryScope;
  projectId?: ID;
  kind: MemoryKind;
  text: string;
  taskKinds?: MemoryFact["taskKinds"];
}

/** 把"还没写进库的草稿"包成一条临时记忆，好复用同一套判定逻辑（判定只读 text/kind/scope） */
function draftToFact(draft: MemoryDraftInput): MemoryFact {
  const now = new Date().toISOString();
  return {
    id: "__draft__",
    scope: draft.scope,
    projectId: draft.scope === "project" ? draft.projectId : undefined,
    kind: draft.kind,
    text: draft.text.trim(),
    source: "user",
    evidence: [],
    confidence: 0,
    pinned: false,
    paused: false,
    usedCount: 0,
    taskKinds: draft.taskKinds,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * 新记忆入库前的即时提示：它和已有记忆冲不冲突。
 * 用草稿而不是"先写库再检测"，是因为写库之后再撤回会让作者莫名其妙看到一条脏数据。
 */
export async function previewMemoryConflicts(draft: MemoryDraftInput, projectId?: ID): Promise<MemoryConflictPair[]> {
  const text = draft.text.trim();
  if (!text) return [];
  const project = draft.scope === "project" ? draft.projectId ?? projectId : undefined;
  const facts = await scopedMemory(project);
  const dp = profileMemory(draftToFact({ ...draft, projectId: project }));
  const out: MemoryConflictPair[] = [];
  for (const f of facts) {
    if (f.paused) continue;
    const c = detectConflictBetween(dp, profileMemory(f));
    if (c) out.push({ a: draftToFact({ ...draft, projectId: project }), b: f, conflict: c });
  }
  return out;
}

/** 草稿与已有记忆的"重复但立场一致"提示（不是冲突，只建议合并） */
export async function previewNearDuplicates(
  draft: MemoryDraftInput,
  projectId?: ID,
  threshold = 0.82,
): Promise<{ fact: MemoryFact; similarity: number }[]> {
  const text = draft.text.trim();
  if (!text) return [];
  const project = draft.scope === "project" ? draft.projectId ?? projectId : undefined;
  const facts = await scopedMemory(project);
  const dp = profileMemory(draftToFact({ ...draft, projectId: project }));
  const out: { fact: MemoryFact; similarity: number }[] = [];
  for (const f of facts) {
    if (f.paused || f.kind !== draft.kind) continue;
    const fp = profileMemory(f);
    const sim = textSimilarity(dp.normalized, fp.normalized);
    // 立场也要一致才算"重复"：立场相反的相似文本是冲突，不是重复
    if (sim >= threshold && fp.polarity === dp.polarity) out.push({ fact: f, similarity: sim });
  }
  return out.sort((a, b) => b.similarity - a.similarity);
}

export type MemoryConflictChoice =
  /** 保留 A：暂停 B（不删除，随时可以恢复） */
  | "keep-a"
  /** 保留 B：暂停 A */
  | "keep-b"
  /** 两条都要：都置顶，并且记住"这是我确认过的组合" */
  | "keep-both"
  /** 合并成一条新的，原两条暂停 */
  | "merge";

/** 双方都记下对方，作为"这对我处置过了"的凭据 */
async function linkResolved(aId: ID, bId: ID): Promise<void> {
  const [a, b] = await Promise.all([db.memory.get(aId), db.memory.get(bId)]);
  const now = new Date().toISOString();
  if (a) {
    const next = Array.from(new Set([...(a.conflictsResolvedWith ?? []), bId]));
    await db.memory.where("id").equals(aId).modify((m) => {
      m.conflictsResolvedWith = next;
      m.updatedAt = now;
    });
  }
  if (b) {
    const next = Array.from(new Set([...(b.conflictsResolvedWith ?? []), aId]));
    await db.memory.where("id").equals(bId).modify((m) => {
      m.conflictsResolvedWith = next;
      m.updatedAt = now;
    });
  }
}

/**
 * 处置一对冲突。
 *
 * 处置方式都选"可逆"的：保留一条时是**暂停**另一条而不是删除 ——
 * 作者判断错了还能恢复，删掉就只能重写。两条都保留则一并置顶，
 * 因为置顶意味着"永远注入"，作者等于明确表态"这两条我都要，模型自己权衡"。
 */
export async function resolveMemoryConflict(
  aId: ID,
  bId: ID,
  choice: MemoryConflictChoice,
  opts: { mergedText?: string; mergedKind?: MemoryKind } = {},
): Promise<MemoryFact | undefined> {
  const [a, b] = await Promise.all([db.memory.get(aId), db.memory.get(bId)]);
  if (!a || !b) return undefined;
  let merged: MemoryFact | undefined;

  if (choice === "keep-a") {
    await updateMemory(bId, { paused: true });
  } else if (choice === "keep-b") {
    await updateMemory(aId, { paused: true });
  } else if (choice === "keep-both") {
    await updateMemory(aId, { pinned: true, confidence: 1 });
    await updateMemory(bId, { pinned: true, confidence: 1 });
  } else {
    const text = (opts.mergedText ?? "").trim() || a.text + "；" + b.text;
    merged = await addMemory({
      scope: a.scope,
      projectId: a.projectId,
      kind: opts.mergedKind ?? a.kind,
      text,
      source: "user",
      pinned: true,
      note: "由两条冲突的记忆合并而来（原两条已暂停，可随时恢复）",
      evidence: [
        { kind: "manual", quote: "合并自：" + a.text, at: new Date().toISOString() },
        { kind: "manual", quote: "合并自：" + b.text, at: new Date().toISOString() },
      ],
    });
    await updateMemory(aId, { paused: true });
    await updateMemory(bId, { paused: true });
    await linkResolved(merged.id, aId);
    await linkResolved(merged.id, bId);
  }

  await linkResolved(aId, bId);
  return merged;
}

/* ------------------------------------------------------------------ *
 * 效果追踪（memoryUsage + feedback）
 * ------------------------------------------------------------------ */

/** 记录"这次生成用了哪些记忆"。绝不抛错：统计失败不能影响写作 */
export async function recordMemoryUsage(
  entries: { projectId: ID; generationId?: ID; factId: ID; via?: MemoryUsage["via"] }[],
): Promise<number> {
  if (!entries.length) return 0;
  const now = new Date().toISOString();
  const rows: MemoryUsage[] = entries.map((e) => ({
    id: newId("mus"),
    projectId: e.projectId,
    generationId: e.generationId,
    factId: e.factId,
    via: e.via,
    createdAt: now,
  }));
  try {
    await db.memoryUsage.bulkPut(rows);
    return rows.length;
  } catch {
    return 0;
  }
}

/** 某次生成用了哪些记忆（"这次为什么写成这样"的可解释入口） */
export async function memoryUsageForGeneration(generationId: ID): Promise<MemoryUsage[]> {
  return db.memoryUsage.where("generationId").equals(generationId).toArray();
}

/**
 * 记忆效果统计。
 *
 * 差评率的分母是"被作者评价过的生成次数"，不是"注入次数"：
 * 一次注入没被评价，说明作者没表态，把它算进分母会把差评率稀释成没意义的数字。
 */
export async function memoryEffectStats(projectId?: ID, factIds?: ID[]): Promise<Map<ID, MemoryEffect>> {
  const rows = projectId
    ? await db.memoryUsage.where("projectId").equals(projectId).toArray()
    : await db.memoryUsage.toArray();
  const wanted = factIds ? new Set(factIds) : undefined;
  const facts = await db.memory.toArray();
  const usedCountById = new Map(facts.map((f) => [f.id, f.usedCount]));
  const feedback = projectId ? await listFeedback(projectId) : await db.feedback.toArray();

  // 同一次生成可能被评价多次（先点赞后差评），以最后一次为准
  const ratingByGen = new Map<ID, 1 | -1>();
  for (const f of [...feedback].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (f.generationId) ratingByGen.set(f.generationId, f.rating);
  }

  const acc = new Map<ID, { injections: number; gens: Set<ID>; rated: number; negative: number; last?: string }>();
  for (const r of rows) {
    if (wanted && !wanted.has(r.factId)) continue;
    const cur = acc.get(r.factId) ?? { injections: 0, gens: new Set<ID>(), rated: 0, negative: 0 };
    cur.injections += 1;
    if (r.generationId) {
      cur.gens.add(r.generationId);
      const rating = ratingByGen.get(r.generationId);
      if (rating !== undefined) {
        cur.rated += 1;
        if (rating === -1) cur.negative += 1;
      }
    }
    if (!cur.last || cur.last < r.createdAt) cur.last = r.createdAt;
    acc.set(r.factId, cur);
  }

  const out = new Map<ID, MemoryEffect>();
  const ids = wanted ?? new Set<ID>([...acc.keys(), ...usedCountById.keys()]);
  for (const id of ids) {
    const cur = acc.get(id);
    const legacy = usedCountById.get(id) ?? 0;
    // 追踪表是 v4 才有的；升级前的老记忆只有 usedCount，用它兜底才不会让界面显示"注入 0 次"
    const injections = Math.max(cur?.injections ?? 0, legacy);
    const rated = cur?.rated ?? 0;
    const negative = cur?.negative ?? 0;
    const badRate = rated ? negative / rated : 0;
    out.set(id, {
      factId: id,
      injections,
      generations: cur?.gens.size ?? 0,
      rated,
      negative,
      badRate,
      lastUsedAt: cur?.last,
      suggestPause: injections >= MEMORY_SUGGEST_PAUSE_MIN_INJECTIONS && badRate >= MEMORY_SUGGEST_PAUSE_BAD_RATE,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 召回查询文本
 * ------------------------------------------------------------------ */

/**
 * 语义召回用的"当前写作内容"。
 *
 * 取最近**编辑过**的章节（按 updatedAt）而不是"顺序上的当前章"：作者真正在写的
 * 那一章才是记忆该对齐的语境，而 systemWithProject 这一层拿不到界面的当前章节 id。
 * 内容只取结尾 800 字：正在写的部分比开头更能代表接下来要写什么。
 */
export async function buildRecallQuery(projectId: ID, chapterId?: ID): Promise<string> {
  let chapter = chapterId ? await db.chapters.get(chapterId) : undefined;
  if (!chapter) {
    const list = await db.chapters.where("projectId").equals(projectId).toArray();
    chapter = list.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0];
  }
  if (!chapter) return "";
  const content = await db.chapterContents.get(chapter.id);
  const parts = [
    chapter.title,
    chapter.summary,
    chapter.goals?.length ? chapter.goals.join("；") : "",
    chapter.hook ?? "",
    (content?.text ?? "").slice(-800),
  ].filter(Boolean);
  return parts.join("\n").slice(0, 2000);
}
