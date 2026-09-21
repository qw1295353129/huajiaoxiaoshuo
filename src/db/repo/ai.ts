import type { AiFeedback, AiGeneration, AiSession, AiSuggestion, ID, PromptTemplate } from '@/core';
import { db } from '../database';
import { newId } from '@/utils/id';

// ---------------- 会话 ----------------

export async function listAiSessions(projectId: ID, limit = 50): Promise<AiSession[]> {
  const list = await db.aiSessions.where('projectId').equals(projectId).toArray();
  return list.filter((s) => !s.archived).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).slice(0, limit);
}

export async function getAiSession(id: ID): Promise<AiSession | undefined> {
  return db.aiSessions.get(id);
}

export async function createAiSession(projectId: ID, patch: Partial<AiSession> & { taskKind: AiSession['taskKind'] }): Promise<AiSession> {
  const now = new Date().toISOString();
  const session: AiSession = {
    id: newId('ais'),
    projectId,
    title: patch.title ?? '新对话',
    taskKind: patch.taskKind,
    chapterId: patch.chapterId,
    messages: patch.messages ?? [],
    contextDigest: patch.contextDigest,
    createdAt: now,
    updatedAt: now,
  };
  await db.aiSessions.put(session);
  return session;
}

export async function updateAiSession(id: ID, patch: Partial<AiSession>): Promise<void> {
  await db.aiSessions.where('id').equals(id).modify((x) => { Object.assign(x, patch, { updatedAt: new Date().toISOString() }); });
}

export async function appendMessage(sessionId: ID, message: AiSession['messages'][number]): Promise<void> {
  await db.aiSessions.where('id').equals(sessionId).modify((s) => {
    s.messages = [...s.messages, message];
    s.updatedAt = new Date().toISOString();
    if (s.title === '新对话' && message.role === 'user') s.title = message.content.slice(0, 24);
  });
}

export async function deleteAiSession(id: ID): Promise<void> {
  await db.aiSessions.delete(id);
}

// ---------------- 生成记录 ----------------

export async function logGeneration(gen: Omit<AiGeneration, 'id' | 'createdAt' | 'updatedAt'>): Promise<AiGeneration> {
  const now = new Date().toISOString();
  const row: AiGeneration = { ...gen, id: newId('gen'), createdAt: now, updatedAt: now };
  await db.generations.put(row);
  return row;
}

export async function listGenerations(projectId: ID, limit = 200): Promise<AiGeneration[]> {
  const list = await db.generations.where('projectId').equals(projectId).toArray();
  return list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, limit);
}

/** token / 成本汇总，用于"AI 用量"仪表盘 */
export async function usageSummary(projectId: ID): Promise<{
  calls: number;
  promptTokens: number;
  completionTokens: number;
  cost: number;
  byTask: { taskKind: string; calls: number; tokens: number }[];
  byDay: { date: string; tokens: number }[];
}> {
  const list = await listGenerations(projectId, 100000);
  const byTaskMap = new Map<string, { calls: number; tokens: number }>();
  const byDayMap = new Map<string, number>();
  let promptTokens = 0;
  let completionTokens = 0;
  let cost = 0;
  for (const g of list) {
    promptTokens += g.promptTokens;
    completionTokens += g.completionTokens;
    cost += g.cost ?? 0;
    const t = byTaskMap.get(g.taskKind) ?? { calls: 0, tokens: 0 };
    t.calls += 1;
    t.tokens += g.promptTokens + g.completionTokens;
    byTaskMap.set(g.taskKind, t);
    const d = g.createdAt.slice(0, 10);
    byDayMap.set(d, (byDayMap.get(d) ?? 0) + g.promptTokens + g.completionTokens);
  }
  return {
    calls: list.length,
    promptTokens,
    completionTokens,
    cost,
    byTask: Array.from(byTaskMap, ([taskKind, v]) => ({ taskKind, ...v })).sort((a, b) => b.tokens - a.tokens),
    byDay: Array.from(byDayMap, ([date, tokens]) => ({ date, tokens })).sort((a, b) => a.date.localeCompare(b.date)),
  };
}

// ---------------- 候选建议 ----------------

export async function saveSuggestion(sug: Omit<AiSuggestion, 'id' | 'createdAt' | 'updatedAt'>): Promise<AiSuggestion> {
  const now = new Date().toISOString();
  const row: AiSuggestion = { ...sug, id: newId('sug'), createdAt: now, updatedAt: now };
  await db.suggestions.put(row);
  return row;
}

export async function listSuggestions(projectId: ID, chapterId?: ID): Promise<AiSuggestion[]> {
  const list = await db.suggestions.where('projectId').equals(projectId).toArray();
  const filtered = chapterId ? list.filter((s) => s.chapterId === chapterId) : list;
  return filtered.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function updateSuggestion(id: ID, patch: Partial<AiSuggestion>): Promise<void> {
  await db.suggestions.where('id').equals(id).modify((x) => { Object.assign(x, patch, { updatedAt: new Date().toISOString() }); });
}

export async function deleteSuggestion(id: ID): Promise<void> {
  await db.suggestions.delete(id);
}

// ---------------- 反馈 ----------------

export async function logFeedback(row: Omit<AiFeedback, 'id' | 'createdAt'>): Promise<void> {
  await db.feedback.put({ ...row, id: newId('fb'), createdAt: new Date().toISOString() });
}

export async function listFeedback(projectId: ID): Promise<AiFeedback[]> {
  return db.feedback.where('projectId').equals(projectId).toArray();
}

/** 最近被差评的生成摘要，用于自动避坑（拼进 system prompt） */
export async function negativeGuidance(projectId: ID, limit = 6): Promise<string[]> {
  const list = await listFeedback(projectId);
  return list
    .filter((f) => f.rating === -1 && f.note)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, limit)
    .map((f) => f.note as string);
}

// ---------------- 提示词模板 ----------------

export async function listPrompts(): Promise<PromptTemplate[]> {
  return db.prompts.toArray();
}

export async function getPromptsByTask(taskKind: PromptTemplate['taskKind']): Promise<PromptTemplate[]> {
  const list = await db.prompts.where('taskKind').equals(taskKind).toArray();
  return list.sort((a, b) => Number(b.builtin) - Number(a.builtin));
}

export async function upsertPrompt(prompt: PromptTemplate): Promise<void> {
  await db.prompts.put(prompt);
}

export async function deletePrompt(id: ID): Promise<void> {
  const p = await db.prompts.get(id);
  if (p?.builtin) return; // 内置模板不可删除，只能重置
  await db.prompts.delete(id);
}

export async function resetPrompt(id: ID): Promise<void> {
  await db.prompts.where('id').equals(id).modify((p) => { p.overridden = false; p.updatedAt = new Date().toISOString(); });
}

// ---------------- 向量 ----------------

export interface EmbeddingRow {
  id: string;
  projectId: ID;
  kind: string;
  refId: ID;
  model: string;
  vector: number[];
  text: string;
}

export async function putEmbedding(row: EmbeddingRow): Promise<void> {
  await db.embeddings.put(row);
}

export async function listEmbeddings(projectId: ID, kind?: string): Promise<EmbeddingRow[]> {
  const all = await db.embeddings.where('projectId').equals(projectId).toArray();
  return kind ? all.filter((e) => e.kind === kind) : all;
}

export async function clearEmbeddings(projectId: ID, kind?: string): Promise<void> {
  const rows = await listEmbeddings(projectId, kind);
  for (const r of rows) await db.embeddings.delete(r.id);
}

/**
 * 按对象 id 删除向量缓存。
 * 记忆被删/被改时调用：向量是围绕 refId 长出来的派生数据，
 * 不删就会留下永远查不到的孤儿行（而且内容变了也判断不出来）。
 */
export async function deleteEmbeddingsFor(refId: ID): Promise<void> {
  await db.embeddings.where('refId').equals(refId).delete().catch(() => undefined);
}
