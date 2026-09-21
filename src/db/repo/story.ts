import type { ChapterMetric, ID, Issue, PlotThread, StyleFingerprint, TimelineEvent } from '@/core';
import { db } from '../database';
import { newId } from '@/utils/id';

// ---------------- 伏笔 / 支线 ----------------

export async function listThreads(projectId: ID): Promise<PlotThread[]> {
  const list = await db.plotThreads.where('projectId').equals(projectId).toArray();
  const rank: Record<PlotThread['priority'], number> = { main: 0, major: 1, minor: 2 };
  return list.sort((a, b) => rank[a.priority] - rank[b.priority] || a.title.localeCompare(b.title, 'zh'));
}

export async function upsertThread(projectId: ID, patch: Partial<PlotThread> & { title: string }): Promise<PlotThread> {
  const now = new Date().toISOString();
  if (patch.id) {
    const existing = await db.plotThreads.get(patch.id);
    if (existing) {
      const next = { ...existing, ...patch, updatedAt: now } as PlotThread;
      await db.plotThreads.put(next);
      return next;
    }
  }
  const thread: PlotThread = {
    id: patch.id ?? newId('thr'),
    projectId,
    kind: patch.kind ?? 'foreshadow',
    title: patch.title,
    description: patch.description,
    plantedChapterId: patch.plantedChapterId,
    plannedPayoffChapterId: patch.plannedPayoffChapterId,
    payoffChapterId: patch.payoffChapterId,
    status: patch.status ?? 'planned',
    priority: patch.priority ?? 'major',
    entityIds: patch.entityIds ?? [],
    characterIds: patch.characterIds ?? [],
    plantQuote: patch.plantQuote,
    payoffQuote: patch.payoffQuote,
    lastSeenChapterOrder: patch.lastSeenChapterOrder,
    notes: patch.notes,
    createdAt: now,
    updatedAt: now,
  };
  await db.plotThreads.put(thread);
  return thread;
}

export async function updateThread(id: ID, patch: Partial<PlotThread>): Promise<void> {
  await db.plotThreads.where('id').equals(id).modify((x) => { Object.assign(x, patch, { updatedAt: new Date().toISOString() }); });
}

export async function deleteThread(id: ID): Promise<void> {
  await db.plotThreads.delete(id);
}

/**
 * 伏笔健康度扫描：找出"埋了很久没回收""计划回收章已过但没回收"的伏笔。
 */
export async function auditThreads(projectId: ID): Promise<
  { thread: PlotThread; problem: 'overdue' | 'stale' | 'unplanted' | 'orphan'; detail: string }[]
> {
  const [threads, chapters] = await Promise.all([listThreads(projectId), db.chapters.where('projectId').equals(projectId).toArray()]);
  const byId = new Map(chapters.map((c) => [c.id, c]));
  const maxOrder = chapters.reduce((m, c) => Math.max(m, c.order), 0);
  const problems: { thread: PlotThread; problem: 'overdue' | 'stale' | 'unplanted' | 'orphan'; detail: string }[] = [];

  for (const t of threads) {
    if (t.status === 'resolved' || t.status === 'abandoned') continue;
    const planned = t.plannedPayoffChapterId ? byId.get(t.plannedPayoffChapterId) : undefined;
    const planted = t.plantedChapterId ? byId.get(t.plantedChapterId) : undefined;

    if (!t.plantedChapterId) {
      problems.push({ thread: t, problem: 'unplanted', detail: '尚未确认埋设章节' });
      continue;
    }
    if (planned && planned.order <= maxOrder && planted && planned.order <= maxOrder) {
      problems.push({ thread: t, problem: 'overdue', detail: `计划在第${planned.order + 1}章回收，当前已写到第${maxOrder + 1}章` });
      continue;
    }
    if (planted && maxOrder - planted.order >= 15) {
      problems.push({ thread: t, problem: 'stale', detail: `已埋设 ${maxOrder - planted.order} 章未回收` });
    }
  }
  return problems;
}

// ---------------- 时间线 ----------------

export async function listTimeline(projectId: ID): Promise<TimelineEvent[]> {
  const list = await db.timelineEvents.where('projectId').equals(projectId).toArray();
  return list.sort((a, b) => a.orderKey - b.orderKey);
}

export async function upsertTimelineEvent(
  projectId: ID,
  patch: Partial<TimelineEvent> & { title: string },
): Promise<TimelineEvent> {
  const now = new Date().toISOString();
  if (patch.id) {
    const existing = await db.timelineEvents.get(patch.id);
    if (existing) {
      const next = { ...existing, ...patch, updatedAt: now } as TimelineEvent;
      await db.timelineEvents.put(next);
      return next;
    }
  }
  const event: TimelineEvent = {
    id: patch.id ?? newId('evt'),
    projectId,
    title: patch.title,
    description: patch.description,
    inWorldTime: patch.inWorldTime ?? '',
    orderKey: patch.orderKey ?? Date.now(),
    durationDays: patch.durationDays,
    chapterIds: patch.chapterIds ?? [],
    participantIds: patch.participantIds ?? [],
    locationId: patch.locationId,
    importance: patch.importance ?? 3,
    arcId: patch.arcId,
    createdAt: now,
    updatedAt: now,
  };
  await db.timelineEvents.put(event);
  return event;
}

export async function deleteTimelineEvent(id: ID): Promise<void> {
  await db.timelineEvents.delete(id);
}

// ---------------- 指标 ----------------

export async function listMetrics(projectId: ID): Promise<ChapterMetric[]> {
  const list = await db.metrics.where('projectId').equals(projectId).toArray();
  return list.sort((a, b) => a.order - b.order);
}

export async function saveMetric(metric: Omit<ChapterMetric, 'id' | 'computedAt'> & { id?: ID }): Promise<ChapterMetric> {
  const row: ChapterMetric = {
    ...metric,
    id: metric.id ?? `${metric.projectId}::${metric.chapterId}`,
    computedAt: new Date().toISOString(),
  };
  await db.metrics.put(row);
  return row;
}

// ---------------- 文风指纹 ----------------

export async function getStyleFingerprint(projectId: ID): Promise<StyleFingerprint | undefined> {
  const list = await db.styles.where('projectId').equals(projectId).toArray();
  return list.sort((a, b) => (a.computedAt < b.computedAt ? 1 : -1))[0];
}

export async function saveStyleFingerprint(fp: StyleFingerprint): Promise<void> {
  await db.styles.put(fp);
}

// ---------------- 问题（一致性报告） ----------------

export async function listIssues(projectId: ID, filter?: { status?: Issue['status']; chapterId?: ID }): Promise<Issue[]> {
  let list = await db.issues.where('projectId').equals(projectId).toArray();
  if (filter?.status) list = list.filter((i) => i.status === filter.status);
  if (filter?.chapterId) list = list.filter((i) => i.chapterId === filter.chapterId);
  const sev: Record<Issue['severity'], number> = { blocker: 0, error: 1, warn: 2, info: 3 };
  return list.sort((a, b) => sev[a.severity] - sev[b.severity] || (a.createdAt < b.createdAt ? 1 : -1));
}

export async function upsertIssue(issue: Partial<Issue> & { projectId: ID; title: string; kind: Issue['kind']; severity: Issue['severity'] }): Promise<Issue> {
  const now = new Date().toISOString();
  if (issue.id) {
    const existing = await db.issues.get(issue.id);
    if (existing) {
      const next = { ...existing, ...issue, updatedAt: now } as Issue;
      await db.issues.put(next);
      return next;
    }
  }
  const row: Issue = {
    id: issue.id ?? newId('iss'),
    projectId: issue.projectId,
    chapterId: issue.chapterId,
    kind: issue.kind,
    severity: issue.severity,
    title: issue.title,
    detail: issue.detail ?? '',
    evidence: issue.evidence,
    conflictsWith: issue.conflictsWith,
    suggestion: issue.suggestion,
    fixPrompt: issue.fixPrompt,
    status: issue.status ?? 'open',
    source: issue.source ?? 'llm',
    detector: issue.detector,
    createdAt: now,
    updatedAt: now,
  };
  await db.issues.put(row);
  return row;
}

export async function updateIssue(id: ID, patch: Partial<Issue>): Promise<void> {
  await db.issues.where('id').equals(id).modify((x) => { Object.assign(x, patch, { updatedAt: new Date().toISOString() }); });
}

export async function clearIssues(projectId: ID, detector?: string): Promise<void> {
  const list = await db.issues.where('projectId').equals(projectId).toArray();
  for (const i of list) {
    if (!detector || i.detector === detector) await db.issues.delete(i.id);
  }
}
