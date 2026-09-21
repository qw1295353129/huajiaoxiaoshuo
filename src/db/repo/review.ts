import type { ChapterComment, ID, ReviewAnchor, ReviewSuggestion, ReviewStats } from "@/core";
import { db } from "../database";
import { newId } from "@/utils/id";
import { applySuggestions, locateAnchor } from "@/utils/anchor";

/** 当前署名：从全局设置里的笔名读，没有就用占位名 */
function currentAuthor(): string {
  try {
    const raw = localStorage.getItem("huajiao:settings") ?? localStorage.getItem("novelforge:settings");
    if (raw) {
      const s = JSON.parse(raw) as { penName?: string };
      if (s.penName) return s.penName;
    }
  } catch {
    /* 读不到就用默认名 */
  }
  return "我";
}

// ==================== 评论 ====================

export async function listComments(chapterId: ID): Promise<ChapterComment[]> {
  const rows = await db.comments.where("chapterId").equals(chapterId).toArray();
  return rows.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

export async function listProjectComments(projectId: ID): Promise<ChapterComment[]> {
  const rows = await db.comments.where("projectId").equals(projectId).toArray();
  return rows.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

export async function addComment(input: {
  projectId: ID;
  chapterId: ID;
  anchor?: ReviewAnchor;
  body: string;
  kind?: ChapterComment["kind"];
  issueId?: ID;
  checklistLabel?: string;
  author?: string;
}): Promise<ChapterComment> {
  const now = new Date().toISOString();
  const row: ChapterComment = {
    id: newId("cmt"),
    projectId: input.projectId,
    chapterId: input.chapterId,
    anchor: input.anchor,
    author: input.author ?? currentAuthor(),
    body: input.body.trim(),
    replies: [],
    resolved: false,
    kind: input.kind ?? "note",
    issueId: input.issueId,
    checklistLabel: input.checklistLabel,
    createdAt: now,
    updatedAt: now,
  };
  await db.comments.put(row);
  return row;
}

export async function updateComment(id: ID, patch: Partial<ChapterComment>): Promise<void> {
  await db.comments.where("id").equals(id).modify((c) => {
    Object.assign(c, patch, { updatedAt: new Date().toISOString() });
  });
}

export async function toggleCommentResolved(id: ID, resolved?: boolean): Promise<void> {
  const row = await db.comments.get(id);
  if (!row) return;
  await updateComment(id, { resolved: resolved ?? !row.resolved });
}

export async function addReply(commentId: ID, body: string, author?: string): Promise<void> {
  await db.comments.where("id").equals(commentId).modify((c) => {
    c.replies = [
      ...c.replies,
      { id: newId("rep"), author: author ?? currentAuthor(), body: body.trim(), createdAt: new Date().toISOString() },
    ];
    c.updatedAt = new Date().toISOString();
  });
}

export async function deleteComment(id: ID): Promise<void> {
  await db.comments.delete(id);
}

export async function deleteResolvedComments(chapterId: ID): Promise<number> {
  const rows = await listComments(chapterId);
  const done = rows.filter((c) => c.resolved);
  for (const c of done) await db.comments.delete(c.id);
  return done.length;
}

// ==================== 修订建议 ====================

export async function listReviewSuggestions(chapterId: ID): Promise<ReviewSuggestion[]> {
  const rows = await db.reviewSuggestions.where("chapterId").equals(chapterId).toArray();
  return rows.sort((a, b) => a.anchor.from - b.anchor.from || (a.createdAt < b.createdAt ? -1 : 1));
}

export async function listProjectReviewSuggestions(projectId: ID): Promise<ReviewSuggestion[]> {
  const rows = await db.reviewSuggestions.where("projectId").equals(projectId).toArray();
  return rows.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

export async function addReviewSuggestion(input: {
  projectId: ID;
  chapterId: ID;
  kind: ReviewSuggestion["kind"];
  anchor: ReviewAnchor;
  proposed: string;
  reason?: string;
  author?: string;
  source?: ReviewSuggestion["source"];
  taskKind?: string;
  generationId?: ID;
}): Promise<ReviewSuggestion> {
  const now = new Date().toISOString();
  const row: ReviewSuggestion = {
    id: newId("sug"),
    projectId: input.projectId,
    chapterId: input.chapterId,
    kind: input.kind,
    anchor: input.anchor,
    proposed: input.proposed,
    reason: input.reason,
    author: input.author ?? currentAuthor(),
    status: "pending",
    source: input.source ?? "human",
    taskKind: input.taskKind,
    generationId: input.generationId,
    createdAt: now,
    updatedAt: now,
  };
  await db.reviewSuggestions.put(row);
  return row;
}

export async function updateReviewSuggestion(id: ID, patch: Partial<ReviewSuggestion>): Promise<void> {
  await db.reviewSuggestions.where("id").equals(id).modify((s) => {
    Object.assign(s, patch, { updatedAt: new Date().toISOString() });
  });
}

export async function deleteReviewSuggestion(id: ID): Promise<void> {
  await db.reviewSuggestions.delete(id);
}

export async function markReviewSuggestion(id: ID, status: ReviewSuggestion["status"]): Promise<void> {
  await updateReviewSuggestion(id, { status, resolvedAt: status === "pending" ? undefined : new Date().toISOString() });
}

/** 统计一章的审稿进度 */
export async function reviewStats(chapterId: ID): Promise<ReviewStats> {
  const [comments, suggestions] = await Promise.all([listComments(chapterId), listReviewSuggestions(chapterId)]);
  return {
    comments: comments.length,
    openComments: comments.filter((c) => !c.resolved).length,
    pendingSuggestions: suggestions.filter((s) => s.status === "pending").length,
    accepted: suggestions.filter((s) => s.status === "accepted").length,
    rejected: suggestions.filter((s) => s.status === "rejected").length,
  };
}

/** 一条建议在当前正文里的定位结果（可能已失效） */
export interface LocatedSuggestion {
  suggestion: ReviewSuggestion;
  located: { from: number; to: number } | null;
}

export function locateSuggestions(text: string, suggestions: ReviewSuggestion[]): LocatedSuggestion[] {
  return suggestions.map((suggestion) => {
    const hit = locateAnchor(text, suggestion.anchor);
    return { suggestion, located: hit ? { from: hit.from, to: hit.to } : null };
  });
}

/**
 * 接受一批建议并生成新正文。
 * 从后往前应用，避免前面的改动让后面的偏移失效；定位失败的会被跳过并返回给调用方。
 */
export function applyAcceptedToText(
  text: string,
  items: { kind: ReviewSuggestion["kind"]; from: number; to: number; proposed: string }[],
): string {
  return applySuggestions(text, items);
}