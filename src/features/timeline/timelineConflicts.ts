import type { Chapter, ID, TimelineEvent } from "@/core";
import { firstChapterOrder, parseStoryTime } from "./timelineMeta";

export type ConflictSeverity = "error" | "warn" | "info";

export type ConflictKind =
  | "in-chapter-order"
  | "cross-chapter-order"
  | "unlinked"
  | "unparsed"
  | "duplicate-time";

export interface TimelineConflict {
  id: string;
  severity: ConflictSeverity;
  kind: ConflictKind;
  title: string;
  detail: string;
  eventIds: ID[];
  chapterId?: ID;
}

export const CONFLICT_KIND_LABELS: Record<ConflictKind, string> = {
  "in-chapter-order": "同章时间颠倒",
  "cross-chapter-order": "跨章时间矛盾",
  unlinked: "未关联章节",
  unparsed: "时间无法解析",
  "duplicate-time": "时间重复",
};

export const CONFLICT_SEVERITY_LABELS: Record<ConflictSeverity, string> = {
  error: "矛盾",
  warn: "可疑",
  info: "提示",
};

const EPS = 1e-6;
const MAX_CONFLICTS = 80;

interface Row {
  event: TimelineEvent;
  time?: number;
  timeLabel?: string;
  order?: number;
}

/**
 * 本地时间线冲突检测（纯离线、免费）：
 *  1. 同一章节内，按事件先后顺序排列时剧情内时间倒退；
 *  2. 挂在前面章节的事件，剧情内时间却晚于后面章节的事件；
 *  3. 事件没有关联任何章节，无法定位；
 *  4. 同一章节里既有可解析时间、又有解析不出来的事件（提示作者补齐）。
 */
export function detectTimelineConflicts(events: TimelineEvent[], chapters: Chapter[]): TimelineConflict[] {
  if (events.length === 0) return [];

  const rows: Row[] = events.map((event) => {
    const parsed = parseStoryTime(event.inWorldTime);
    return {
      event,
      time: parsed?.value,
      timeLabel: parsed?.label,
      order: firstChapterOrder(event, chapters),
    };
  });
  const out: TimelineConflict[] = [];
  const push = (c: TimelineConflict) => {
    if (out.length < MAX_CONFLICTS) out.push(c);
  };

  // ---------- 1. 未关联章节 ----------
  for (const row of rows) {
    if (row.event.chapterIds.length === 0) {
      push({
        id: "unlinked-" + row.event.id,
        severity: "warn",
        kind: "unlinked",
        title: "「" + row.event.title + "」没有挂在任何章节上",
        detail: "事件没有关联章节，就没有章节轴可对照，也无法和其它事件比对先后顺序。建议至少挂到一个章节。",
        eventIds: [row.event.id],
      });
    }
  }

  // ---------- 2. 同一章节内时间颠倒 ----------
  for (const chapter of chapters) {
    const inChapter = rows
      .filter((r) => r.event.chapterIds.includes(chapter.id))
      .sort((a, b) => a.event.orderKey - b.event.orderKey);
    for (let i = 0; i + 1 < inChapter.length; i += 1) {
      const a = inChapter[i];
      const b = inChapter[i + 1];
      if (a.time === undefined || b.time === undefined) continue;
      if (a.time > b.time + EPS) {
        push({
          id: "in-chapter-" + chapter.id + "-" + a.event.id + "-" + b.event.id,
          severity: "error",
          kind: "in-chapter-order",
          title: "第" + (chapter.order + 1) + "章内时间倒退",
          detail:
            "「" + a.event.title + "」（" + (a.timeLabel ?? a.event.inWorldTime) + "）排在「" +
            b.event.title + "」（" + (b.timeLabel ?? b.event.inWorldTime) + "）之前，但剧情内时间更晚。",
          eventIds: [a.event.id, b.event.id],
          chapterId: chapter.id,
        });
      } else if (Math.abs(a.time - b.time) < EPS && a.event.orderKey !== b.event.orderKey) {
        push({
          id: "dup-" + chapter.id + "-" + a.event.id + "-" + b.event.id,
          severity: "info",
          kind: "duplicate-time",
          title: "第" + (chapter.order + 1) + "章内两个事件时间相同",
          detail:
            "「" + a.event.title + "」与「" + b.event.title + "」的剧情内时间都是 " +
            (a.timeLabel ?? a.event.inWorldTime) + "，若两者确有先后，建议把时间写得更精确。",
          eventIds: [a.event.id, b.event.id],
          chapterId: chapter.id,
        });
      }
    }
  }

  // ---------- 3. 跨章时间矛盾 ----------
  const ordered = rows
    .filter((r) => r.order !== undefined && r.time !== undefined)
    .sort((a, b) => (a.order as number) - (b.order as number) || a.event.orderKey - b.event.orderKey);

  for (let i = 0; i < ordered.length; i += 1) {
    const a = ordered[i];
    for (let j = i + 1; j < Math.min(ordered.length, i + 5); j += 1) {
      const b = ordered[j];
      const orderA = a.order as number;
      const orderB = b.order as number;
      if (orderA >= orderB) continue;
      if ((a.time as number) > (b.time as number) + EPS) {
        push({
          id: "cross-" + a.event.id + "-" + b.event.id,
          severity: "error",
          kind: "cross-chapter-order",
          title: "跨章时间矛盾：早的章节写了更晚的事",
          detail:
            "「" + a.event.title + "」挂在第" + (orderA + 1) + "章，剧情内时间是 " +
            (a.timeLabel ?? a.event.inWorldTime) + "；但第" + (orderB + 1) + "章的「" + b.event.title +
            "」时间是 " + (b.timeLabel ?? b.event.inWorldTime) + "，比它更早。",
          eventIds: [a.event.id, b.event.id],
        });
      }
    }
  }

  // ---------- 4. 时间解析不出来 ----------
  for (const row of rows) {
    if (row.time !== undefined) continue;
    if (!row.event.inWorldTime.trim()) continue;
    const siblings = rows.filter(
      (r) => r.event.id !== row.event.id && r.event.chapterIds.some((id) => row.event.chapterIds.includes(id)),
    );
    if (siblings.length === 0) continue;
    push({
      id: "unparsed-" + row.event.id,
      severity: "info",
      kind: "unparsed",
      title: "「" + row.event.title + "」的时间无法解析",
      detail:
        "「" + row.event.inWorldTime + "」里没有找到「年 / 月 / 日 / 季节」这类时间词，无法与同章事件比对先后。" +
        "建议写成「第三年·春」「景和十二年三月」这类可解析的形式。",
      eventIds: [row.event.id],
    });
  }

  const weight: Record<ConflictSeverity, number> = { error: 0, warn: 1, info: 2 };
  return out.sort((a, b) => weight[a.severity] - weight[b.severity]);
}

/** 便捷索引：事件 id → 相关冲突 */
export function conflictIndex(conflicts: TimelineConflict[]): Map<ID, TimelineConflict[]> {
  const map = new Map<ID, TimelineConflict[]>();
  for (const c of conflicts) {
    for (const id of c.eventIds) {
      const list = map.get(id);
      if (list) list.push(c);
      else map.set(id, [c]);
    }
  }
  return map;
}
