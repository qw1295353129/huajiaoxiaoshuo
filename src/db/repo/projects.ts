import type { ID, Project, ProjectStats, WritingGoal } from '@/core';
import { db } from '../database';
import { newId } from '@/utils/id';

const EMPTY_STATS: ProjectStats = { words: 0, chapters: 0, scenes: 0, writingDays: 0 };

export interface CreateProjectInput {
  title: string;
  genres?: string[];
  pov?: Project['pov'];
  lengthClass?: Project['lengthClass'];
  targetWords?: number;
  logline?: string;
  styleGuide?: string;
  author?: string;
}

export async function listProjects(): Promise<Project[]> {
  const all = await db.projects.toArray();
  return all.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function getProject(id: ID): Promise<Project | undefined> {
  return db.projects.get(id);
}

export async function createProject(input: CreateProjectInput): Promise<Project> {
  const now = new Date().toISOString();
  const project: Project = {
    id: newId('prj'),
    title: input.title.trim() || '未命名作品',
    author: input.author,
    logline: input.logline,
    genres: input.genres ?? [],
    tags: [],
    themes: [],
    pov: input.pov ?? 'third-limited',
    tense: 'past',
    targetWords: input.targetWords ?? defaultTarget(input.lengthClass ?? 'novel'),
    targetChapterWords: 3000,
    lengthClass: input.lengthClass ?? 'novel',
    status: 'planning',
    styleGuide: input.styleGuide,
    forbidden: [],
    language: 'zh-CN',
    stats: { ...EMPTY_STATS },
    createdAt: now,
    updatedAt: now,
  };
  await db.transaction('rw', [db.projects, db.appState], async () => {
    await db.projects.put(project);
    const st = await db.appState.get('singleton');
    if (st) {
      await db.appState.put({
        ...st,
        lastProjectId: project.id,
        recentProjectIds: [project.id, ...st.recentProjectIds.filter((x) => x !== project.id)].slice(0, 12),
        updatedAt: now,
      });
    }
  });
  return project;
}

function defaultTarget(kind: Project['lengthClass']): number {
  switch (kind) {
    case 'short': return 10_000;
    case 'novella': return 60_000;
    case 'novel': return 250_000;
    case 'epic': return 800_000;
    case 'webnovel': return 2_000_000;
    default: return 250_000;
  }
}

export async function updateProject(id: ID, patch: Partial<Project>): Promise<void> {
  const now = new Date().toISOString();
  await db.projects.where('id').equals(id).modify((p) => {
    Object.assign(p, patch, { updatedAt: now });
  });
}

/** 重算并写回统计信息（章节数 / 总字数 / 最后写作时间） */
export async function recomputeProjectStats(id: ID): Promise<ProjectStats> {
  const chapters = await db.chapters.where('projectId').equals(id).toArray();
  const kept = chapters.filter((c) => c.status !== 'cut');
  const words = kept.reduce((sum, c) => sum + (c.wordCount || 0), 0);
  const scenes = kept.reduce((sum, c) => sum + (c.beats?.length ?? 0), 0);
  const sessions = await db.sessions.where('projectId').equals(id).toArray();
  const days = new Set(sessions.map((s) => s.startedAt.slice(0, 10)));
  const stats: ProjectStats = {
    words,
    chapters: kept.length,
    scenes,
    startedAt: sessions.length ? sessions.map((s) => s.startedAt).sort()[0] : undefined,
    lastWrittenAt: sessions.length ? sessions.map((s) => s.endedAt ?? s.startedAt).sort().slice(-1)[0] : undefined,
    writingDays: days.size,
  };
  await db.projects.where('id').equals(id).modify((p) => {
    p.stats = stats;
    p.updatedAt = new Date().toISOString();
  });
  return stats;
}

/**
 * 级联删除作品下所有数据。Dexie 没有外键，这里显式按 projectId 清理。
 */
export async function deleteProject(id: ID): Promise<void> {
  await db.transaction(
    'rw',
    [
      db.projects, db.arcs, db.chapters, db.chapterContents, db.outlineNodes, db.snapshots,
      db.comments, db.reviewSuggestions,
      db.characters, db.relationships, db.characterAppearances, db.worldEntries, db.factions,
      db.entities, db.entityMentions, db.plotThreads, db.timelineEvents, db.glossary, db.rules,
      db.issues, db.metrics, db.styles, db.goals, db.sessions, db.pomodoros, db.aiSessions,
      db.generations, db.suggestions, db.embeddings, db.feedback, db.genesis, db.appState,
      db.memory, db.memoryUsage, db.blueprints,
    ],
    async () => {
      // appearances 没有 projectId 索引，必须在 characters 还在时先收集主键并删除
      const characterIds = (await db.characters.where('projectId').equals(id).primaryKeys()) as string[];
      if (characterIds.length) {
        await db.characterAppearances.where('characterId').anyOf(characterIds).delete();
      }
      const byProject = [
        db.arcs, db.chapters, db.outlineNodes, db.snapshots, db.comments, db.reviewSuggestions,
        db.characters, db.relationships,
        db.worldEntries, db.factions, db.entities, db.entityMentions, db.plotThreads,
        db.timelineEvents, db.glossary, db.rules, db.issues, db.metrics, db.styles, db.goals,
        db.sessions, db.pomodoros, db.aiSessions, db.generations, db.suggestions, db.embeddings,
        db.feedback, db.genesis, db.memory, db.memoryUsage, db.blueprints,
      ];
      for (const table of byProject) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (table as any).where('projectId').equals(id).delete();
      }
      await db.chapterContents.where('projectId').equals(id).delete();
      await db.projects.delete(id);
      const st = await db.appState.get('singleton');
      if (st) {
        await db.appState.put({
          ...st,
          lastProjectId: st.lastProjectId === id ? undefined : st.lastProjectId,
          recentProjectIds: st.recentProjectIds.filter((x) => x !== id),
          updatedAt: new Date().toISOString(),
        });
      }
    },
  );
}

export async function duplicateProject(id: ID, newTitle?: string): Promise<ID | undefined> {
  const src = await getProject(id);
  if (!src) return undefined;
  const now = new Date().toISOString();
  const copy: Project = {
    ...src,
    id: newId('prj'),
    title: newTitle ?? src.title + '（副本）',
    createdAt: now,
    updatedAt: now,
    stats: { ...EMPTY_STATS },
  };
  const idMap = new Map<ID, ID>();

  await db.transaction('rw', [db.projects, db.arcs, db.chapters, db.chapterContents, db.outlineNodes, db.characters, db.relationships, db.worldEntries, db.plotThreads, db.timelineEvents, db.entities, db.rules, db.glossary], async () => {
    await db.projects.put(copy);
    const arcs = await db.arcs.where('projectId').equals(id).toArray();
    for (const a of arcs) {
      const nid = newId('arc');
      idMap.set(a.id, nid);
      await db.arcs.put({ ...a, id: nid, projectId: copy.id, createdAt: now, updatedAt: now });
    }
    const chapters = await db.chapters.where('projectId').equals(id).toArray();
    for (const c of chapters) {
      const nid = newId('chp');
      idMap.set(c.id, nid);
      await db.chapters.put({
        ...c, id: nid, projectId: copy.id,
        arcId: c.arcId ? idMap.get(c.arcId) : undefined,
        characterIds: [], locationIds: [], plantsThreadIds: [], paysThreadIds: [],
        createdAt: now, updatedAt: now,
      });
      const content = await db.chapterContents.get(c.id);
      if (content) await db.chapterContents.put({ ...content, chapterId: nid, projectId: copy.id });
    }
    const chars = await db.characters.where('projectId').equals(id).toArray();
    for (const ch of chars) {
      const nid = newId('chr');
      idMap.set(ch.id, nid);
      await db.characters.put({ ...ch, id: nid, projectId: copy.id, createdAt: now, updatedAt: now });
    }
    const rels = await db.relationships.where('projectId').equals(id).toArray();
    for (const r of rels) {
      const from = idMap.get(r.fromId);
      const to = idMap.get(r.toId);
      if (!from || !to) continue;
      await db.relationships.put({ ...r, id: newId('rel'), projectId: copy.id, fromId: from, toId: to, createdAt: now, updatedAt: now });
    }
    const worlds = await db.worldEntries.where('projectId').equals(id).toArray();
    for (const we of worlds) {
      const nid = newId('wld');
      idMap.set(we.id, nid);
      await db.worldEntries.put({ ...we, id: nid, projectId: copy.id, parentId: we.parentId ? idMap.get(we.parentId) : undefined, createdAt: now, updatedAt: now });
    }
    const threads = await db.plotThreads.where('projectId').equals(id).toArray();
    for (const t of threads) {
      await db.plotThreads.put({
        ...t, id: newId('thr'), projectId: copy.id,
        plantedChapterId: t.plantedChapterId ? idMap.get(t.plantedChapterId) : undefined,
        payoffChapterId: t.payoffChapterId ? idMap.get(t.payoffChapterId) : undefined,
        plannedPayoffChapterId: t.plannedPayoffChapterId ? idMap.get(t.plannedPayoffChapterId) : undefined,
        createdAt: now, updatedAt: now,
      });
    }
    const events = await db.timelineEvents.where('projectId').equals(id).toArray();
    for (const e of events) {
      await db.timelineEvents.put({ ...e, id: newId('evt'), projectId: copy.id, chapterIds: e.chapterIds.map((c) => idMap.get(c) ?? c), createdAt: now, updatedAt: now });
    }
    const nodes = await db.outlineNodes.where('projectId').equals(id).toArray();
    for (const n of nodes) {
      await db.outlineNodes.put({ ...n, id: newId('out'), projectId: copy.id, parentId: n.parentId ? idMap.get(n.parentId) : undefined, createdAt: now, updatedAt: now });
    }
    const rules = await db.rules.where('projectId').equals(id).toArray();
    for (const r of rules) await db.rules.put({ ...r, id: newId('rule'), projectId: copy.id, createdAt: now, updatedAt: now });
    const terms = await db.glossary.where('projectId').equals(id).toArray();
    for (const g of terms) await db.glossary.put({ ...g, id: newId('glo'), projectId: copy.id, createdAt: now, updatedAt: now });
  });

  await recomputeProjectStats(copy.id);
  return copy.id;
}

export async function setLastOpened(projectId: ID, chapterId?: ID): Promise<void> {
  const st = await db.appState.get('singleton');
  if (!st) return;
  await db.appState.put({
    ...st,
    lastProjectId: projectId,
    lastChapterId: chapterId ?? st.lastChapterId,
    recentProjectIds: [projectId, ...st.recentProjectIds.filter((x) => x !== projectId)].slice(0, 12),
    updatedAt: new Date().toISOString(),
  });
}

export async function getAppState() {
  return db.appState.get('singleton');
}

// ---------- 写作目标 ----------

export async function getGoal(projectId: ID): Promise<WritingGoal | undefined> {
  const list = await db.goals.where('projectId').equals(projectId).toArray();
  return list[0];
}

export async function upsertGoal(projectId: ID, patch: Partial<WritingGoal>): Promise<WritingGoal> {
  const now = new Date().toISOString();
  const existing = await getGoal(projectId);
  if (existing) {
    const next = { ...existing, ...patch, updatedAt: now };
    await db.goals.put(next);
    return next;
  }
  const goal: WritingGoal = {
    id: newId('goal'),
    projectId,
    dailyWords: patch.dailyWords ?? 2000,
    weeklyWords: patch.weeklyWords,
    deadline: patch.deadline,
    enabled: patch.enabled ?? true,
    createdAt: now,
    updatedAt: now,
  };
  await db.goals.put(goal);
  return goal;
}
