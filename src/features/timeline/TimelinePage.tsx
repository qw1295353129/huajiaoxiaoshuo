import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Button, Card, Chip, Tabs } from "@heroui/react";
import { Clock, Filter, Plus, Search, Sparkles, X } from "lucide-react";
import type { ID, TimelineEvent } from "@/core";
import { PageScaffold } from "@/components/common/PageScaffold";
import { EmptyHint, Loading, StatCard } from "@/components/common/ui";
import { useAppStore } from "@/app/store";
import { useArcs, useAsync, useChapters, useCharacters, useDebounced, useTimeline, useWorldEntries } from "@/app/hooks";
import { deleteTimelineEvent, listTimeline } from "@/db/repo/story";
import { TimelineChapterView } from "./TimelineChapterView";
import { TimelineConflictPanel } from "./TimelineConflictPanel";
import { TimelineEventModal } from "./TimelineEventModal";
import { TimelineExtractModal } from "./TimelineExtractModal";
import { TimelineInWorldView } from "./TimelineInWorldView";
import { IMPORTANCE_LABELS, storyTimeSortValue, timeSpanLabel } from "./timelineMeta";
import { conflictIndex, detectTimelineConflicts } from "./timelineConflicts";
import { DIVIDER_CLASS, FIELD_CLASS, LABEL_CLASS, SELECT_CLASS } from "./styles";

type View = "inworld" | "chapter";

/** 时间线页：剧情内时间轴 / 章节轴双视图 + 本地冲突检测 + AI 抽取。 */
export function TimelinePage() {
  const { projectId = "" } = useParams<{ projectId: string }>();
  const notify = useAppStore((s) => s.notify);

  const events = useTimeline(projectId);
  const chapters = useChapters(projectId);
  const characters = useCharacters(projectId);
  const worldEntries = useWorldEntries(projectId);
  const arcs = useArcs(projectId);

  // liveQuery 首帧只返回空数组，用一个真实查询来判断是否加载完成
  const bootRes = useAsync(async () => {
    await listTimeline(projectId);
    return true;
  }, [projectId], false);
  const booted = bootRes.value;

  const [view, setView] = useState<View>("inworld");
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounced(query, 250);
  const [importanceFilter, setImportanceFilter] = useState<"all" | number>("all");
  const [conflictOnly, setConflictOnly] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TimelineEvent | null>(null);
  const [suggestedChapterId, setSuggestedChapterId] = useState<ID | undefined>(undefined);
  const [extractOpen, setExtractOpen] = useState(false);
  const [highlightId, setHighlightId] = useState<string | undefined>(undefined);

  /** 本地冲突检测（纯离线） */
  const conflicts = useMemo(() => detectTimelineConflicts(events, chapters), [events, chapters]);
  const conflictMap = useMemo(() => conflictIndex(conflicts), [conflicts]);

  /** 搜索 + 重要性 + 仅看冲突 */
  const filtered = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    return events.filter((event) => {
      if (importanceFilter !== "all" && event.importance !== importanceFilter) return false;
      if (conflictOnly && !conflictMap.has(event.id)) return false;
      if (!q) return true;
      const people = event.participantIds
        .map((id) => characters.find((c) => c.id === id)?.name ?? "")
        .join(" ");
      const place = event.locationId ? worldEntries.find((w) => w.id === event.locationId)?.title ?? "" : "";
      const chapterText = event.chapterIds
        .map((id) => {
          const chapter = chapters.find((c) => c.id === id);
          return chapter ? "第" + (chapter.order + 1) + "章 " + chapter.title : "";
        })
        .join(" ");
      return [event.title, event.description, event.inWorldTime, people, place, chapterText]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [events, importanceFilter, conflictOnly, debouncedQuery, characters, worldEntries, chapters, conflictMap]);

  /** 剧情内时间轴：先按剧情内时间，再按排序键 */
  const inWorldSorted = useMemo(
    () =>
      [...filtered].sort((a, b) => storyTimeSortValue(a) - storyTimeSortValue(b) || a.orderKey - b.orderKey),
    [filtered],
  );

  const stats = useMemo(() => {
    const covered = new Set<string>();
    for (const event of events) for (const id of event.chapterIds) covered.add(id);
    return {
      covered: covered.size,
      span: timeSpanLabel(inWorldSorted.length ? inWorldSorted : events),
      errorCount: conflicts.filter((c) => c.severity === "error").length,
    };
  }, [events, inWorldSorted, conflicts]);

  const nextOrderKey = useMemo(
    () => (events.length ? Math.max(...events.map((e) => e.orderKey)) + 1 : undefined),
    [events],
  );

  const openCreate = (chapterId?: ID) => {
    setEditing(null);
    setSuggestedChapterId(chapterId);
    setFormOpen(true);
  };

  const openEdit = (event: TimelineEvent) => {
    setEditing(event);
    setSuggestedChapterId(undefined);
    setFormOpen(true);
  };

  const remove = async (event: TimelineEvent) => {
    if (!window.confirm("删除事件「" + event.title + "」？此操作不可撤销。")) return;
    try {
      await deleteTimelineEvent(event.id);
      notify("success", "事件已删除", event.title);
    } catch (e) {
      notify("danger", "删除失败", e instanceof Error ? e.message : String(e));
    }
  };

  /** 从冲突面板定位到具体事件：切到剧情内轴并滚动 + 高亮 */
  const locate = (eventId: ID) => {
    setView("inworld");
    setHighlightId(eventId);
    window.setTimeout(() => {
      document.getElementById("tl-evt-" + eventId)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
  };

  const resetFilters = () => {
    setQuery("");
    setImportanceFilter("all");
    setConflictOnly(false);
  };

  const filtersActive = debouncedQuery.trim() !== "" || importanceFilter !== "all" || conflictOnly;

  const body = () => {
    if (!booted) return <Loading label="正在读取时间线…" />;

    if (events.length === 0) {
      return (
        <EmptyHint
          icon={<Clock className="size-8" />}
          title="时间线还是空的"
          description="把故事里发生的关键事件按剧情内时间排好，冲突检测会自动帮你找出「早的章节写了更晚的事」这类矛盾。也可以让 AI 直接从某一章正文里抽取。"
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button variant="primary" onPress={() => openCreate()}>
                <Plus className="size-4" />
                新建事件
              </Button>
              <Button variant="outline" onPress={() => setExtractOpen(true)} isDisabled={chapters.length === 0}>
                <Sparkles className="size-4" />
                AI 抽取时间线
              </Button>
            </div>
          }
        />
      );
    }

    return (
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="事件总数" value={events.length} hint="含过场与转折" tone="accent" icon={<Clock className="size-4" />} />
          <StatCard label="覆盖章节" value={stats.covered} hint={"项目共 " + chapters.length + " 章"} />
          <StatCard label="时间跨度" value={<span className="text-base">{stats.span}</span>} hint="按剧情内时间排序" />
          <StatCard
            label="时间线矛盾"
            value={conflicts.length}
            tone={stats.errorCount > 0 ? "danger" : conflicts.length > 0 ? "warning" : "success"}
            hint={stats.errorCount > 0 ? stats.errorCount + " 条前后矛盾" : "本地检测，免费"}
          />
        </div>

        <TimelineConflictPanel conflicts={conflicts} onLocate={locate} />

        <Tabs selectedKey={view} onSelectionChange={(key) => setView(key === "chapter" ? "chapter" : "inworld")}>
          <Tabs.List>
            <Tabs.Tab id="inworld">剧情内时间轴</Tabs.Tab>
            <Tabs.Tab id="chapter">章节轴</Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel id="inworld">
            <div className="space-y-4 pt-3">
              <FilterBar
                query={query}
                setQuery={setQuery}
                importanceFilter={importanceFilter}
                setImportanceFilter={setImportanceFilter}
                conflictOnly={conflictOnly}
                setConflictOnly={setConflictOnly}
                filtersActive={filtersActive}
                resetFilters={resetFilters}
                shown={inWorldSorted.length}
                total={events.length}
                conflictCount={conflicts.length}
              />
              {inWorldSorted.length === 0 ? (
                <EmptyHint
                  title="没有符合条件的事件"
                  description="换一个关键词，或清空筛选条件。"
                  action={
                    <Button variant="outline" onPress={resetFilters}>
                      清空筛选
                    </Button>
                  }
                />
              ) : (
                <TimelineInWorldView
                  events={inWorldSorted}
                  chapters={chapters}
                  characters={characters}
                  worldEntries={worldEntries}
                  conflictMap={conflictMap}
                  highlightedId={highlightId}
                  onEdit={openEdit}
                  onDelete={remove}
                />
              )}
            </div>
          </Tabs.Panel>

          <Tabs.Panel id="chapter">
            <div className="space-y-4 pt-3">
              <FilterBar
                query={query}
                setQuery={setQuery}
                importanceFilter={importanceFilter}
                setImportanceFilter={setImportanceFilter}
                conflictOnly={conflictOnly}
                setConflictOnly={setConflictOnly}
                filtersActive={filtersActive}
                resetFilters={resetFilters}
                shown={filtered.length}
                total={events.length}
                conflictCount={conflicts.length}
              />
              <TimelineChapterView
                events={filtered}
                chapters={chapters}
                characters={characters}
                worldEntries={worldEntries}
                conflictMap={conflictMap}
                highlightedId={highlightId}
                onEdit={openEdit}
                onDelete={remove}
                onAddToChapter={(chapterId) => openCreate(chapterId)}
              />
            </div>
          </Tabs.Panel>
        </Tabs>
      </div>
    );
  };

  return (
    <PageScaffold
      title="时间线"
      description={
        booted
          ? events.length + " 个事件 · 覆盖 " + stats.covered + " 章 · " + conflicts.length + " 条待核对"
          : "正在读取…"
      }
      actions={
        <>
          <Button variant="outline" isDisabled={chapters.length === 0} onPress={() => setExtractOpen(true)}>
            <Sparkles className="size-4" />
            AI 抽取时间线
          </Button>
          <Button variant="primary" onPress={() => openCreate()}>
            <Plus className="size-4" />
            新建事件
          </Button>
        </>
      }
    >
      {body()}

      <TimelineEventModal
        projectId={projectId}
        open={formOpen}
        onOpenChange={setFormOpen}
        event={editing}
        chapters={chapters}
        characters={characters}
        worldEntries={worldEntries}
        arcs={arcs}
        suggestedChapterId={suggestedChapterId}
        suggestedOrderKey={nextOrderKey}
        onSaved={() => {
          if (editing) locate(editing.id);
        }}
      />

      <TimelineExtractModal
        projectId={projectId}
        open={extractOpen}
        onOpenChange={setExtractOpen}
        chapters={chapters}
        characters={characters}
        worldEntries={worldEntries}
        existingEvents={events}
        onSaved={() => undefined}
      />
    </PageScaffold>
  );
}

/** 两个视图共用的筛选条 */
function FilterBar({
  query,
  setQuery,
  importanceFilter,
  setImportanceFilter,
  conflictOnly,
  setConflictOnly,
  filtersActive,
  resetFilters,
  shown,
  total,
  conflictCount,
}: {
  query: string;
  setQuery: (v: string) => void;
  importanceFilter: "all" | number;
  setImportanceFilter: (v: "all" | number) => void;
  conflictOnly: boolean;
  setConflictOnly: (v: boolean) => void;
  filtersActive: boolean;
  resetFilters: () => void;
  shown: number;
  total: number;
  conflictCount: number;
}) {
  return (
    <Card className={"flex flex-wrap items-end gap-3 p-3 " + DIVIDER_CLASS}>
      <div className="min-w-[200px] flex-1">
        <label className={LABEL_CLASS}>搜索</label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 opacity-40" />
          <input
            className={FIELD_CLASS + " pl-8"}
            value={query}
            placeholder="事件标题、描述、时间、人物、地点、章节"
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button
              type="button"
              aria-label="清空搜索"
              className="absolute right-2 top-1/2 -translate-y-1/2 opacity-40 transition hover:opacity-80"
              onClick={() => setQuery("")}
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>
      <div className="w-[130px]">
        <label className={LABEL_CLASS}>重要性</label>
        <select
          className={SELECT_CLASS}
          value={String(importanceFilter)}
          onChange={(e) => setImportanceFilter(e.target.value === "all" ? "all" : Number(e.target.value))}
        >
          <option value="all">全部</option>
          {[5, 4, 3, 2, 1].map((n) => (
            <option key={n} value={n}>
              {n} · {IMPORTANCE_LABELS[n]}
            </option>
          ))}
        </select>
      </div>
      <label className="flex cursor-pointer items-center gap-2 pb-2 text-xs">
        <input
          type="checkbox"
          className="size-4 accent-violet-500"
          checked={conflictOnly}
          onChange={(e) => setConflictOnly(e.target.checked)}
        />
        只看有冲突的事件
        {conflictCount > 0 && (
          <Chip size="sm" color="warning">
            {conflictCount}
          </Chip>
        )}
      </label>
      <div className="flex items-center gap-2 pb-1">
        <span className="tabular text-xs opacity-55">
          {shown} / {total}
        </span>
        {filtersActive && (
          <Button size="sm" variant="ghost" onPress={resetFilters}>
            <Filter className="size-3.5" />
            清空筛选
          </Button>
        )}
      </div>
    </Card>
  );
}
