import type { ID, MemoryEvidence, MemoryFact, MemoryKind, MemoryScope, MemorySource } from "@/core";
import { confidenceFrom } from "@/core";
import { db } from "../database";
import { newId } from "@/utils/id";

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

export async function deleteMemory(id: ID): Promise<void> {
  await db.memory.delete(id);
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
  for (const m of targets) await db.memory.delete(m.id);
  return targets.length;
}
