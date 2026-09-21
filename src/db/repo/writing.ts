import type { ID, PomodoroRecord, WritingSession } from '@/core';
import { db } from '../database';
import { newId } from '@/utils/id';
import { dayKey } from '@/utils/format';

export async function startSession(projectId: ID, chapterId?: ID, flow = false): Promise<WritingSession> {
  const now = new Date().toISOString();
  const session: WritingSession = {
    id: newId('sess'),
    projectId,
    chapterId,
    startedAt: now,
    wordsAdded: 0,
    wordsRemoved: 0,
    activeMs: 0,
    flow,
    createdAt: now,
    updatedAt: now,
  };
  await db.sessions.put(session);
  return session;
}

export async function updateSession(id: ID, patch: Partial<WritingSession>): Promise<void> {
  await db.sessions.where('id').equals(id).modify((x) => { Object.assign(x, patch, { updatedAt: new Date().toISOString() }); });
}

export async function endSession(id: ID, patch: Partial<WritingSession> = {}): Promise<void> {
  await updateSession(id, { ...patch, endedAt: new Date().toISOString() });
}

export async function listSessions(projectId: ID, limit = 500): Promise<WritingSession[]> {
  const list = await db.sessions.where('projectId').equals(projectId).toArray();
  return list.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1)).slice(0, limit);
}

/** 每日字数汇总：{ '2026-03-01': 1234 } */
export async function dailyWordCounts(projectId: ID, days = 60): Promise<Record<string, number>> {
  const sessions = await listSessions(projectId, 5000);
  const out: Record<string, number> = {};
  const cutoff = new Date(Date.now() - days * 86400_000).toISOString();
  for (const s of sessions) {
    if (s.startedAt < cutoff) continue;
    const k = dayKey(s.startedAt);
    out[k] = (out[k] ?? 0) + Math.max(0, s.wordsAdded);
  }
  return out;
}

/** 写作热力图数据：最近 N 天 */
export async function heatmap(projectId: ID, days = 180): Promise<{ date: string; words: number }[]> {
  const daily = await dailyWordCounts(projectId, days);
  const out: { date: string; words: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400_000);
    const k = dayKey(d);
    out.push({ date: k, words: daily[k] ?? 0 });
  }
  return out;
}

export async function logPomodoro(projectId: ID, minutes: number, completed: boolean, wordsAdded: number): Promise<void> {
  const now = new Date().toISOString();
  const row: PomodoroRecord = {
    id: newId('pom'),
    projectId,
    startedAt: now,
    minutes,
    completed,
    wordsAdded,
    createdAt: now,
    updatedAt: now,
  };
  await db.pomodoros.put(row);
}

export async function listPomodoros(projectId: ID): Promise<PomodoroRecord[]> {
  return db.pomodoros.where('projectId').equals(projectId).toArray();
}

/** 写作速度：过去 n 分钟每分钟字数 */
export function writingSpeed(wordsAdded: number, activeMs: number): number {
  if (activeMs <= 0) return 0;
  return (wordsAdded / (activeMs / 60000));
}
