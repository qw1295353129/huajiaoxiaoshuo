import type { Arc, Chapter, ChapterContent, ID, OutlineNode, Snapshot } from '@/core';
import { db } from '../database';
import { newId } from '@/utils/id';
import { countWords, stripHtml, textToHtml } from '@/utils/text';

// ---------------- 卷 / 幕 ----------------

export async function listArcs(projectId: ID): Promise<Arc[]> {
  const list = await db.arcs.where('projectId').equals(projectId).toArray();
  return list.sort((a, b) => a.order - b.order);
}

export async function createArc(projectId: ID, title: string, patch: Partial<Arc> = {}): Promise<Arc> {
  const now = new Date().toISOString();
  const existing = await listArcs(projectId);
  const arc: Arc = {
    id: newId('arc'),
    projectId,
    title: title || `第${existing.length + 1}卷`,
    kind: patch.kind ?? 'volume',
    summary: patch.summary,
    goal: patch.goal,
    conflict: patch.conflict,
    outcome: patch.outcome,
    status: patch.status ?? 'planned',
    targetWords: patch.targetWords,
    color: patch.color,
    order: existing.length,
    createdAt: now,
    updatedAt: now,
  };
  await db.arcs.put(arc);
  return arc;
}

export async function updateArc(id: ID, patch: Partial<Arc>): Promise<void> {
  await db.arcs.where('id').equals(id).modify((x) => { Object.assign(x, patch, { updatedAt: new Date().toISOString() }); });
}

export async function deleteArc(id: ID): Promise<void> {
  await db.transaction('rw', [db.arcs, db.chapters], async () => {
    await db.chapters.where('arcId').equals(id).modify((c) => { c.arcId = undefined; });
    await db.arcs.delete(id);
  });
}

export async function reorderArcs(ids: ID[]): Promise<void> {
  await db.transaction('rw', [db.arcs], async () => {
    for (let i = 0; i < ids.length; i++) {
      await db.arcs.where('id').equals(ids[i]).modify((a) => { a.order = i; });
    }
  });
}

// ---------------- 章节 ----------------

export async function listChapters(projectId: ID): Promise<Chapter[]> {
  const list = await db.chapters.where('projectId').equals(projectId).toArray();
  return list.sort((a, b) => a.order - b.order);
}

export async function getChapter(id: ID): Promise<Chapter | undefined> {
  return db.chapters.get(id);
}

export async function getChapterContent(chapterId: ID): Promise<ChapterContent | undefined> {
  return db.chapterContents.get(chapterId);
}

export async function getChapterWithContent(id: ID): Promise<{ chapter?: Chapter; content?: ChapterContent }> {
  const [chapter, content] = await Promise.all([db.chapters.get(id), db.chapterContents.get(id)]);
  return { chapter, content };
}

export interface CreateChapterInput {
  title?: string;
  arcId?: ID;
  summary?: string;
  afterOrder?: number;
}

export async function createChapter(projectId: ID, input: CreateChapterInput = {}): Promise<Chapter> {
  const now = new Date().toISOString();
  const chapters = await listChapters(projectId);
  const insertAt = input.afterOrder === undefined ? chapters.length : input.afterOrder + 1;
  const chapter: Chapter = {
    id: newId('chp'),
    projectId,
    arcId: input.arcId,
    title: input.title?.trim() || `第${insertAt + 1}章`,
    summary: input.summary,
    goals: [],
    characterIds: [],
    locationIds: [],
    order: insertAt,
    status: 'idea',
    wordCount: 0,
    tension: 0,
    plantsThreadIds: [],
    paysThreadIds: [],
    beats: [],
    tags: [],
    createdAt: now,
    updatedAt: now,
  };

  await db.transaction('rw', [db.chapters, db.chapterContents], async () => {
    // 给后续章节腾位置
    const later = chapters.filter((c) => c.order >= insertAt);
    for (const c of later) {
      await db.chapters.where('id').equals(c.id).modify((x) => { x.order += 1; });
    }
    await db.chapters.put(chapter);
    await db.chapterContents.put({ chapterId: chapter.id, projectId, html: '<p></p>', text: '', updatedAt: now, rev: 1 });
  });
  return chapter;
}

export async function updateChapter(id: ID, patch: Partial<Chapter>): Promise<void> {
  await db.chapters.where('id').equals(id).modify((x) => { Object.assign(x, patch, { updatedAt: new Date().toISOString() }); });
}

export async function deleteChapter(id: ID): Promise<void> {
  // 同事务内级联清掉所有带 chapterId 索引的附属表。
  // timelineEvents.chapterIds / plotThreads 的章引用没有单章索引，
  // 清理需要全表扫改写、改动面大，暂不处理（删章后残留引用由 UI 层容错）。
  await db.transaction(
    'rw',
    [
      db.chapters, db.chapterContents, db.snapshots, db.metrics, db.characterAppearances,
      db.comments, db.reviewSuggestions, db.entityMentions,
    ],
    async () => {
      await db.chapters.delete(id);
      await db.chapterContents.delete(id);
      await db.snapshots.where('chapterId').equals(id).delete();
      await db.metrics.where('chapterId').equals(id).delete();
      await db.characterAppearances.where('chapterId').equals(id).delete();
      await db.comments.where('chapterId').equals(id).delete();
      await db.reviewSuggestions.where('chapterId').equals(id).delete();
      await db.entityMentions.where('chapterId').equals(id).delete();
    },
  );
}

export async function reorderChapters(projectId: ID, orderedIds: ID[]): Promise<void> {
  await db.transaction('rw', [db.chapters], async () => {
    for (let i = 0; i < orderedIds.length; i++) {
      await db.chapters.where('id').equals(orderedIds[i]).modify((c) => {
        c.order = i;
        c.projectId = projectId;
      });
    }
  });
}

/**
 * 保存正文：写 chapterContents + 更新章节字数/状态。
 * 用 rev 做乐观并发，冲突时返回 false，UI 提示"本地有更新"。
 */
export async function saveChapterContent(
  chapterId: ID,
  html: string,
  opts: { expectedRev?: number; touchStatus?: boolean } = {},
): Promise<{ ok: boolean; rev: number; words: number }> {
  const text = stripHtml(html);
  const words = countWords(text);
  const now = new Date().toISOString();
  let ok = true;
  let rev = 1;

  await db.transaction('rw', [db.chapterContents, db.chapters], async () => {
    const existing = await db.chapterContents.get(chapterId);
    if (opts.expectedRev !== undefined && existing && existing.rev !== opts.expectedRev) {
      ok = false;
      rev = existing.rev;
      return;
    }
    rev = (existing?.rev ?? 0) + 1;
    // 无已有行或 projectId 为空时从 chapters 补齐——首存（rev===1）同样要回填，不能写 ''
    let projectId = existing?.projectId ?? '';
    if (!projectId) {
      const chapter = await db.chapters.get(chapterId);
      projectId = chapter?.projectId ?? '';
    }
    await db.chapterContents.put({ chapterId, projectId, html, text, updatedAt: now, rev });
    await db.chapters.where('id').equals(chapterId).modify((c) => {
      c.wordCount = words;
      c.updatedAt = now;
      if (opts.touchStatus !== false && words > 0 && (c.status === 'idea' || c.status === 'outlined')) c.status = 'drafting';
    });
  });
  return { ok, rev, words };
}

/** 追加文本到章节末尾（AI 续写落盘用） */
export async function appendToChapter(chapterId: ID, appendHtml: string): Promise<void> {
  const existing = await db.chapterContents.get(chapterId);
  const html = (existing?.html ?? '') + appendHtml;
  await saveChapterContent(chapterId, html);
}

// ---------------- 快照 ----------------

export async function createSnapshot(
  chapterId: ID,
  label: string,
  kind: Snapshot['kind'] = 'manual',
  taskId?: ID,
): Promise<Snapshot | undefined> {
  const [chapter, content] = await Promise.all([db.chapters.get(chapterId), db.chapterContents.get(chapterId)]);
  if (!chapter || !content) return undefined;
  const now = new Date().toISOString();
  const snap: Snapshot = {
    id: newId('snap'),
    projectId: chapter.projectId,
    chapterId,
    label,
    kind,
    html: content.html,
    text: content.text,
    wordCount: chapter.wordCount,
    taskId,
    createdAt: now,
    updatedAt: now,
  };
  await db.snapshots.put(snap);
  return snap;
}

export async function listSnapshots(chapterId: ID): Promise<Snapshot[]> {
  const list = await db.snapshots.where('chapterId').equals(chapterId).toArray();
  return list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function restoreSnapshot(snapshotId: ID): Promise<void> {
  const snap = await db.snapshots.get(snapshotId);
  if (!snap) return;
  await createSnapshot(snap.chapterId, '恢复前自动备份', 'auto');
  await saveChapterContent(snap.chapterId, snap.html, { touchStatus: false });
}

export async function deleteSnapshot(id: ID): Promise<void> {
  await db.snapshots.delete(id);
}

/** 只保留最近 n 个自动快照，避免无限增长 */
export async function pruneAutoSnapshots(chapterId: ID, keep = 30): Promise<void> {
  const list = await listSnapshots(chapterId);
  const autos = list.filter((s) => s.kind === 'auto');
  for (const s of autos.slice(keep)) await db.snapshots.delete(s.id);
}

// ---------------- 导入 ----------------

export async function importChapters(
  projectId: ID,
  items: { title: string; content: string }[],
  arcId?: ID,
): Promise<Chapter[]> {
  const created: Chapter[] = [];
  for (const it of items) {
    const chapter = await createChapter(projectId, { title: it.title, arcId });
    const html = textToHtml(it.content);
    await saveChapterContent(chapter.id, html, { touchStatus: false });
    await updateChapter(chapter.id, { status: 'drafted' });
    created.push({ ...chapter, wordCount: countWords(it.content) });
  }
  return created;
}

// ---------------- 画布大纲节点 ----------------

export async function listOutlineNodes(projectId: ID): Promise<OutlineNode[]> {
  const list = await db.outlineNodes.where('projectId').equals(projectId).toArray();
  return list.sort((a, b) => a.order - b.order);
}

export async function upsertOutlineNode(node: Partial<OutlineNode> & { projectId: ID; title: string }): Promise<OutlineNode> {
  const now = new Date().toISOString();
  if (node.id) {
    const existing = await db.outlineNodes.get(node.id);
    if (existing) {
      const next = { ...existing, ...node, updatedAt: now } as OutlineNode;
      await db.outlineNodes.put(next);
      return next;
    }
  }
  const created: OutlineNode = {
    id: node.id ?? newId('out'),
    projectId: node.projectId,
    parentId: node.parentId,
    kind: node.kind ?? 'note',
    title: node.title,
    body: node.body,
    order: node.order ?? Date.now(),
    refId: node.refId,
    createdAt: now,
    updatedAt: now,
  };
  await db.outlineNodes.put(created);
  return created;
}

export async function deleteOutlineNode(id: ID): Promise<void> {
  const children = await db.outlineNodes.where('parentId').equals(id).toArray();
  for (const c of children) await deleteOutlineNode(c.id);
  await db.outlineNodes.delete(id);
}
