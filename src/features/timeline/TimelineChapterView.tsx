import { useMemo, useState } from "react";
import { Button, Card, Chip } from "@heroui/react";
import { ChevronLeft, ChevronRight, Pencil, Trash2 } from "lucide-react";
import type { Chapter, Character, TimelineEvent, WorldEntry } from "@/core";
import { EmptyHint } from "@/components/common/ui";
import { ConflictBadge, EventChapterChips, LocationLine, ParticipantAvatars } from "./TimelineEventBits";
import { importanceHex, importanceLabel, sortedChapters } from "./timelineMeta";
import { DIVIDER_CLASS } from "./styles";
import type { TimelineConflict } from "./timelineConflicts";

/** 每页显示的章节列数 */
const COLUMNS_PER_PAGE = 8;

/**
 * 章节轴视图：横轴为章节序号，每个章节一列，事件挂在所属章节上。
 * 顶部另有一条「章节密度」刻度尺，用来一眼看出事件集中在哪几章。
 */
export function TimelineChapterView({
  events,
  chapters,
  characters,
  worldEntries,
  conflictMap,
  highlightedId,
  onEdit,
  onDelete,
  onAddToChapter,
}: {
  events: TimelineEvent[];
  chapters: Chapter[];
  characters: Character[];
  worldEntries: WorldEntry[];
  conflictMap: Map<string, TimelineConflict[]>;
  highlightedId?: string;
  onEdit: (event: TimelineEvent) => void;
  onDelete: (event: TimelineEvent) => void;
  onAddToChapter: (chapterId: string) => void;
}) {
  const [page, setPage] = useState(0);
  const ordered = useMemo(() => sortedChapters(chapters), [chapters]);

  /** 每个章节挂了多少事件 */
  const countByChapter = useMemo(() => {
    const map = new Map<string, number>();
    for (const event of events) {
      for (const id of event.chapterIds) map.set(id, (map.get(id) ?? 0) + 1);
    }
    return map;
  }, [events]);

  /** 没有挂到任何章节的事件 */
  const unlinked = useMemo(() => events.filter((e) => e.chapterIds.length === 0), [events]);

  /** 有事件的章节列（按章节顺序） */
  const columns = useMemo(
    () =>
      ordered
        .map((chapter) => ({
          chapter,
          items: events.filter((e) => e.chapterIds.includes(chapter.id)),
        }))
        .filter((col) => col.items.length > 0),
    [ordered, events],
  );

  const pageCount = Math.max(1, Math.ceil(columns.length / COLUMNS_PER_PAGE));
  const safePage = Math.min(page, pageCount - 1);
  const visibleColumns = columns.slice(safePage * COLUMNS_PER_PAGE, safePage * COLUMNS_PER_PAGE + COLUMNS_PER_PAGE);

  /** 跳到某个章节所在的页 */
  const jumpTo = (chapterId: string) => {
    const index = columns.findIndex((c) => c.chapter.id === chapterId);
    if (index >= 0) setPage(Math.floor(index / COLUMNS_PER_PAGE));
  };

  if (events.length === 0) {
    return <EmptyHint title="当前筛选下没有事件" description="换一个关键词，或清空筛选条件。" />;
  }

  return (
    <div className="space-y-4">
      {/* 章节密度刻度尺 */}
      <Card className="p-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="text-xs opacity-60">
            章节密度：共 {ordered.length} 章，其中 {columns.length} 章挂有事件
            {unlinked.length > 0 ? "，" + unlinked.length + " 条事件未挂章节" : ""}
          </p>
          <p className="text-[11px] opacity-40">点击刻度可跳到对应章节</p>
        </div>
        <div className="flex flex-wrap gap-[3px]">
          {ordered.map((chapter) => {
            const count = countByChapter.get(chapter.id) ?? 0;
            const tone = count === 0 ? "bg-black/[0.07] dark:bg-white/10" : count < 3 ? "bg-black/40" : "bg-neutral-800";
            return (
              <button
                key={chapter.id}
                type="button"
                title={"第" + (chapter.order + 1) + "章 " + chapter.title + " · " + count + " 个事件"}
                onClick={() => jumpTo(chapter.id)}
                className={"h-4 w-2.5 rounded-sm transition hover:opacity-70 " + tone}
              />
            );
          })}
        </div>
      </Card>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs opacity-55">
          第 {safePage * COLUMNS_PER_PAGE + 1}–{Math.min(columns.length, (safePage + 1) * COLUMNS_PER_PAGE)} 列 / 共{" "}
          {columns.length} 列
        </p>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" isIconOnly aria-label="上一页" isDisabled={safePage <= 0} onPress={() => setPage(Math.max(0, safePage - 1))}>
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            isIconOnly
            aria-label="下一页"
            isDisabled={safePage >= pageCount - 1}
            onPress={() => setPage(Math.min(pageCount - 1, safePage + 1))}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto pb-2">
        <div className="flex min-w-max items-start gap-3">
          {visibleColumns.map((col) => (
            <div key={col.chapter.id} className="w-72 shrink-0">
              <div className={"mb-2 flex items-center justify-between gap-2 rounded-lg border px-3 py-2 " + DIVIDER_CLASS}>
                <div className="min-w-0">
                  <p className="tabular text-[11px] opacity-45">第 {col.chapter.order + 1} 章</p>
                  <p className="truncate text-xs font-medium">{col.chapter.title}</p>
                </div>
                <Chip size="sm">{col.items.length}</Chip>
              </div>
              <div className="space-y-2">
                {col.items.map((event) => (
                  <EventMiniCard
                    key={event.id}
                    event={event}
                    chapters={chapters}
                    characters={characters}
                    worldEntries={worldEntries}
                    conflicts={conflictMap.get(event.id) ?? []}
                    highlighted={highlightedId === event.id}
                    onEdit={onEdit}
                    onDelete={onDelete}
                  />
                ))}
                <Button size="sm" variant="ghost" fullWidth onPress={() => onAddToChapter(col.chapter.id)}>
                  + 在这一章添加事件
                </Button>
              </div>
            </div>
          ))}

          {unlinked.length > 0 && (
            <div className="w-72 shrink-0">
              <div className={"mb-2 flex items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-amber-500/[0.06] px-3 py-2 "}>
                <div className="min-w-0">
                  <p className="text-[11px] text-amber-600 dark:text-amber-300">未挂章节</p>
                  <p className="truncate text-xs font-medium">需要补上所属章节</p>
                </div>
                <Chip size="sm" color="warning">
                  {unlinked.length}
                </Chip>
              </div>
              <div className="space-y-2">
                {unlinked.map((event) => (
                  <EventMiniCard
                    key={event.id}
                    event={event}
                    chapters={chapters}
                    characters={characters}
                    worldEntries={worldEntries}
                    conflicts={conflictMap.get(event.id) ?? []}
                    highlighted={highlightedId === event.id}
                    onEdit={onEdit}
                    onDelete={onDelete}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EventMiniCard({
  event,
  chapters,
  characters,
  worldEntries,
  conflicts,
  highlighted,
  onEdit,
  onDelete,
}: {
  event: TimelineEvent;
  chapters: Chapter[];
  characters: Character[];
  worldEntries: WorldEntry[];
  conflicts: TimelineConflict[];
  highlighted: boolean;
  onEdit: (event: TimelineEvent) => void;
  onDelete: (event: TimelineEvent) => void;
}) {
  return (
    <Card
      className={"group p-3 transition " + (highlighted ? "ring-2 ring-neutral-900/60" : "")}
      id={"tl-evt-" + event.id}
    >
      <div className="flex items-start gap-2">
        <span className="mt-1 size-2 shrink-0 rounded-full" style={{ backgroundColor: importanceHex(event.importance) }} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium">{event.title}</p>
          <p className="mt-0.5 text-[11px] opacity-55">
            {event.inWorldTime || "时间未标注"} · {importanceLabel(event.importance)}
            {event.durationDays ? " · " + event.durationDays + " 天" : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
          <Button size="sm" variant="ghost" isIconOnly aria-label="编辑" onPress={() => onEdit(event)}>
            <Pencil className="size-3.5" />
          </Button>
          <Button size="sm" variant="ghost" isIconOnly aria-label="删除" onPress={() => onDelete(event)}>
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>

      {event.description && <p className="mt-2 line-clamp-3 text-[11px] leading-relaxed opacity-60">{event.description}</p>}

      <div className="mt-2 space-y-1.5">
        <ParticipantAvatars ids={event.participantIds} characters={characters} max={4} />
        {event.chapterIds.length > 1 && <EventChapterChips event={event} chapters={chapters} />}
        <div className="flex items-center gap-2">
          <LocationLine event={event} worldEntries={worldEntries} />
          <ConflictBadge conflicts={conflicts} />
        </div>
      </div>
    </Card>
  );
}
