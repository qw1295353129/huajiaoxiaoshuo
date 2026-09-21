import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Chip, Tooltip } from "@heroui/react";
import { ChevronDown, ChevronRight, GripVertical, Plus, Search, Trash2 } from "lucide-react";
import type { Arc, Chapter, ID } from "@/core";
import { CHAPTER_STATUS_LABEL } from "@/app/theme";
import { useAppStore } from "@/app/store";
import { ROUTES } from "@/app/routes";
import { useDebounced } from "@/app/hooks";
import { createChapter, deleteChapter, reorderChapters, updateChapter } from "@/db/repo/outline";
import { formatWords } from "@/utils/format";

interface Props {
  projectId: ID;
  arcs: Arc[];
  chapters: Chapter[];
  activeChapterId?: ID;
  collapsed: boolean;
}

/** 写作台左侧：卷/章导航，支持拖拽排序、内联改名、快速新建。 */
export function ChapterList({ projectId, arcs, chapters, activeChapterId, collapsed }: Props) {
  const navigate = useNavigate();
  const notify = useAppStore((s) => s.notify);
  const [query, setQuery] = useState("");
  const [closedArcs, setClosedArcs] = useState<Record<string, boolean>>({});
  const [dragId, setDragId] = useState<ID | null>(null);
  const [dropTarget, setDropTarget] = useState<ID | null>(null);
  const [renaming, setRenaming] = useState<ID | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const debounced = useDebounced(query, 200);

  const filtered = useMemo(() => {
    if (!debounced.trim()) return chapters;
    const q = debounced.trim().toLowerCase();
    return chapters.filter(
      (c) => c.title.toLowerCase().includes(q) || (c.summary ?? "").toLowerCase().includes(q),
    );
  }, [chapters, debounced]);

  const grouped = useMemo(() => {
    const byArc = new Map<string, Chapter[]>();
    const orphan: Chapter[] = [];
    for (const c of filtered) {
      if (c.arcId && arcs.some((a) => a.id === c.arcId)) {
        const arr = byArc.get(c.arcId) ?? [];
        arr.push(c);
        byArc.set(c.arcId, arr);
      } else {
        orphan.push(c);
      }
    }
    return { byArc, orphan };
  }, [filtered, arcs]);

  const totalWords = useMemo(() => chapters.reduce((n, c) => n + c.wordCount, 0), [chapters]);

  const onDrop = async (targetId: ID) => {
    if (!dragId || dragId === targetId) {
      setDragId(null);
      setDropTarget(null);
      return;
    }
    const ids = chapters.map((c) => c.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    await reorderChapters(projectId, ids);
    setDragId(null);
    setDropTarget(null);
  };

  const commitRename = async () => {
    if (renaming) {
      const title = draftTitle.trim();
      if (title) await updateChapter(renaming, { title });
    }
    setRenaming(null);
  };

  const handleNewChapter = async (arcId?: ID) => {
    const last = chapters.filter((c) => c.arcId === arcId).slice(-1)[0];
    const created = await createChapter(projectId, { arcId, afterOrder: last?.order });
    notify("success", "已新建章节", created.title);
    navigate(ROUTES.write(projectId, created.id));
  };

  if (collapsed) {
    return (
      <div className="flex h-full w-14 flex-col items-center gap-2 border-r border-black/5 py-3 dark:border-white/5">
        <Tooltip>
          <Tooltip.Trigger>
            <Button isIconOnly size="sm" variant="ghost" onPress={() => void handleNewChapter()}>
              <Plus className="size-4" />
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content>新建章节</Tooltip.Content>
        </Tooltip>
        <div className="mt-2 flex flex-col items-center gap-1 overflow-y-auto">
          {chapters.slice(0, 40).map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => navigate(ROUTES.write(projectId, c.id))}
              className={
                "grid size-8 place-items-center rounded-md text-[11px] tabular transition " +
                (c.id === activeChapterId
                  ? "bg-violet-500/15 text-violet-600 dark:text-violet-300"
                  : "opacity-55 hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/5")
              }
              title={c.title}
            >
              {c.order + 1}
            </button>
          ))}
        </div>
      </div>
    );
  }

  const renderChapter = (c: Chapter) => (
    <li key={c.id}>
      <div
        draggable
        onDragStart={() => setDragId(c.id)}
        onDragOver={(e) => {
          e.preventDefault();
          setDropTarget(c.id);
        }}
        onDragLeave={() => setDropTarget((t) => (t === c.id ? null : t))}
        onDrop={() => void onDrop(c.id)}
        className={
          "group flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm transition " +
          (c.id === activeChapterId
            ? "bg-violet-500/10 font-medium text-violet-700 dark:text-violet-200"
            : "hover:bg-black/5 dark:hover:bg-white/5") +
          (dropTarget === c.id && dragId !== c.id ? " ring-1 ring-violet-500/50" : "")
        }
      >
        <GripVertical className="size-3 shrink-0 cursor-grab opacity-0 transition group-hover:opacity-40" />
        <button
          type="button"
          className="min-w-0 flex-1 truncate text-left"
          onClick={() => navigate(ROUTES.write(projectId, c.id))}
          onDoubleClick={() => {
            setRenaming(c.id);
            setDraftTitle(c.title);
          }}
        >
          {renaming === c.id ? (
            <input
              autoFocus
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              onBlur={() => void commitRename()}
              onKeyDown={(e) => {
                if (e.key === "Enter") void commitRename();
                if (e.key === "Escape") setRenaming(null);
              }}
              className="w-full rounded bg-white px-1 text-sm outline-none ring-1 ring-violet-500/40 dark:bg-neutral-900"
            />
          ) : (
            <span>
              <span className="tabular mr-1.5 opacity-45">{c.order + 1}</span>
              {c.title}
            </span>
          )}
        </button>
        <span className="tabular shrink-0 text-[10px] opacity-40">{c.wordCount > 0 ? formatWords(c.wordCount) : ""}</span>
        <button
          type="button"
          aria-label="删除章节"
          className="shrink-0 opacity-0 transition hover:text-rose-500 group-hover:opacity-50"
          onClick={(e) => {
            e.stopPropagation();
            if (confirm(`删除《${c.title}》？正文与快照都会一起删除。`)) void deleteChapter(c.id);
          }}
        >
          <Trash2 className="size-3" />
        </button>
      </div>
    </li>
  );

  return (
    <div className="flex h-full w-72 flex-col border-r border-black/5 dark:border-white/5">
      <div className="shrink-0 space-y-2 px-3 py-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium">目录</p>
            <p className="tabular text-[11px] opacity-45">
              {chapters.length} 章 · {formatWords(totalWords)}
            </p>
          </div>
          <Tooltip>
            <Tooltip.Trigger>
              <Button isIconOnly size="sm" variant="ghost" onPress={() => void handleNewChapter()}>
                <Plus className="size-4" />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content>新建章节</Tooltip.Content>
          </Tooltip>
        </div>
        <div className="flex items-center gap-1.5 rounded-lg bg-black/[0.04] px-2 py-1.5 dark:bg-white/[0.06]">
          <Search className="size-3.5 opacity-40" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索章节"
            className="w-full bg-transparent text-xs outline-none placeholder:opacity-40"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {arcs.map((arc) => {
          const list = grouped.byArc.get(arc.id) ?? [];
          if (!list.length && debounced) return null;
          const closed = closedArcs[arc.id];
          return (
            <div key={arc.id} className="mb-2">
              <button
                type="button"
                onClick={() => setClosedArcs((s) => ({ ...s, [arc.id]: !s[arc.id] }))}
                className="flex w-full items-center gap-1 rounded-md px-2 py-1 text-left text-[11px] font-medium uppercase tracking-wide opacity-55 transition hover:opacity-90"
              >
                {closed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
                <span className="truncate">{arc.title}</span>
                <span className="tabular ml-auto opacity-60">{list.length}</span>
              </button>
              {!closed && <ul className="mt-0.5 space-y-0.5">{list.map(renderChapter)}</ul>}
              {!closed && (
                <button
                  type="button"
                  onClick={() => void handleNewChapter(arc.id)}
                  className="mt-0.5 flex w-full items-center gap-1 rounded-md px-2 py-1 text-[11px] opacity-40 transition hover:opacity-80"
                >
                  <Plus className="size-3" /> 在本卷新增章节
                </button>
              )}
            </div>
          );
        })}

        {grouped.orphan.length > 0 && (
          <div className="mb-2">
            {arcs.length > 0 && (
              <p className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide opacity-55">未分卷</p>
            )}
            <ul className="space-y-0.5">{grouped.orphan.map(renderChapter)}</ul>
          </div>
        )}

        {chapters.length === 0 && (
          <div className="px-3 py-8 text-center">
            <p className="text-xs opacity-55">还没有章节</p>
            <Button className="mt-3" size="sm" variant="outline" onPress={() => void handleNewChapter()}>
              <Plus className="size-3.5" />
              新建第一章
            </Button>
          </div>
        )}
        {chapters.length > 0 && filtered.length === 0 && (
          <div className="px-3 py-6 text-center text-xs opacity-50">没有匹配的章节</div>
        )}
      </div>

      {chapters.length > 0 && (
        <div className="shrink-0 border-t border-black/5 px-3 py-2 dark:border-white/5">
          <Chip size="sm" color="default">
            双击章节名可重命名
          </Chip>
        </div>
      )}
    </div>
  );
}
