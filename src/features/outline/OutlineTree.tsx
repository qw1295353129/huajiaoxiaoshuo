import { useMemo, useState } from "react";
import type { Arc, Chapter, ID } from "@/core";
import { Button, Card, Chip, Tooltip } from "@heroui/react";
import {
  ChevronDown, ChevronRight, ChevronUp, ChevronsDownUp, GripVertical,
  Layers, Pencil, PenLine, Plus, Trash2,
} from "lucide-react";
import { useAppStore } from "@/app/store";
import {
  createArc, createChapter, deleteArc, deleteChapter, reorderChapters, updateArc, updateChapter,
} from "@/db/repo/outline";
import { formatWords } from "@/utils/format";
import {
  arcColor, chapterStatusColor, chapterStatusLabel, errorText, groupChapters, groupKeyOf, sumWords, tensionText,
} from "./outlineMeta";

/** 拖拽落点：落在某章的前/后，或直接落进某个卷（arcId = null 表示"未分卷"） */
interface DropTarget {
  chapterId?: ID;
  arcId?: ID | null;
  position: "before" | "after" | "into";
}

interface Props {
  projectId: ID;
  arcs: Arc[];
  chapters: Chapter[];
  selectedId?: ID;
  onSelect: (chapterId: ID) => void;
  /** 双击章节 / 点"写作"图标时打开写作页 */
  onOpenChapter: (chapterId: ID) => void;
}

const LOOSE_KEY = "__loose__";

/** 左侧卷 / 章树：折叠、拖拽排序、卷与章的增删改 */
export function OutlineTree({ projectId, arcs, chapters, selectedId, onSelect, onOpenChapter }: Props) {
  const notify = useAppStore((s) => s.notify);
  const groups = useMemo(() => groupChapters(arcs, chapters), [arcs, chapters]);
  const ordered = useMemo(() => groups.flatMap((g) => g.chapters), [groups]);
  const indexById = useMemo(() => {
    const map = new Map<ID, number>();
    ordered.forEach((c, i) => map.set(c.id, i));
    return map;
  }, [ordered]);

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [dragId, setDragId] = useState<ID>();
  const [dropTarget, setDropTarget] = useState<DropTarget>();
  const [renamingId, setRenamingId] = useState<ID>();
  const [renameText, setRenameText] = useState("");
  const [creatingArc, setCreatingArc] = useState(false);
  const [newArcTitle, setNewArcTitle] = useState("");

  const allCollapsed = arcs.length > 0 && arcs.every((a) => collapsed[a.id]);
  const looseChapters = groups.find((g) => !g.arc)?.chapters ?? [];

  const toggleArc = (key: string) => setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  const toggleAll = () => {
    if (allCollapsed) setCollapsed({});
    else setCollapsed(Object.fromEntries([...arcs.map((a) => [a.id, true]), [LOOSE_KEY, true]]));
  };

  // ---------------- 排序 ----------------

  /** 只写 order 字段，失败时提示而不是静默 */
  const saveOrder = async (ids: ID[]) => {
    try {
      await reorderChapters(projectId, ids);
    } catch (e) {
      notify("danger", "调整章节顺序失败", errorText(e));
    }
  };

  /** 把某章移动到 target 指定的位置与卷 */
  const moveChapter = async (chapterId: ID, target: DropTarget) => {
    const dragged = chapters.find((c) => c.id === chapterId);
    if (!dragged) return;
    const ids = ordered.map((c) => c.id).filter((id) => id !== chapterId);
    let insertAt = ids.length;
    let nextArcId: ID | undefined = dragged.arcId;

    if (target.chapterId) {
      const targetChapter = chapters.find((c) => c.id === target.chapterId);
      if (!targetChapter) return;
      nextArcId = targetChapter.arcId;
      const at = ids.indexOf(target.chapterId);
      insertAt = at < 0 ? ids.length : target.position === "before" ? at : at + 1;
    } else if (target.arcId !== undefined) {
      nextArcId = target.arcId ?? undefined;
      const siblings = ordered.filter((c) => groupKeyOf(c, arcs) === target.arcId && c.id !== chapterId).map((c) => c.id);
      const last = siblings[siblings.length - 1];
      insertAt = last ? ids.indexOf(last) + 1 : ids.length;
    }

    ids.splice(insertAt, 0, chapterId);
    await saveOrder(ids);
    if (nextArcId !== dragged.arcId) await updateChapter(chapterId, { arcId: nextArcId });
  };

  /** 键盘/按钮辅助：同卷内上移或下移一位 */
  const shiftChapter = async (chapterId: ID, delta: number) => {
    const ids = ordered.map((c) => c.id);
    const at = ids.indexOf(chapterId);
    const to = at + delta;
    if (at < 0 || to < 0 || to >= ids.length) return;
    const a = ordered[at];
    const b = ordered[to];
    if (groupKeyOf(a, arcs) !== groupKeyOf(b, arcs)) {
      notify("info", "跨卷移动请用拖拽", "把章节拖到目标卷的标题或章节之间即可");
      return;
    }
    ids[at] = b.id;
    ids[to] = a.id;
    await saveOrder(ids);
  };

  // ---------------- 卷 ----------------

  const addArc = async () => {
    const title = newArcTitle.trim() || "第" + (arcs.length + 1) + "卷";
    try {
      await createArc(projectId, title, { color: arcColor(arcs.length) });
      setNewArcTitle("");
      setCreatingArc(false);
      notify("success", "已新建卷", title);
    } catch (e) {
      notify("danger", "新建卷失败", errorText(e));
    }
  };

  const commitRename = async (arc: Arc) => {
    const title = renameText.trim();
    setRenamingId(undefined);
    if (!title || title === arc.title) return;
    try {
      await updateArc(arc.id, { title });
    } catch (e) {
      notify("danger", "重命名失败", errorText(e));
    }
  };

  const removeArc = async (arc: Arc) => {
    const count = chapters.filter((c) => c.arcId === arc.id).length;
    const hint = count ? "其中 " + count + " 章会变为「未分卷」，不会被删除。" : "这一卷还没有章节。";
    if (!confirm("删除卷《" + arc.title + "》？" + hint)) return;
    try {
      await deleteArc(arc.id);
      notify("info", "卷已删除", arc.title);
    } catch (e) {
      notify("danger", "删除卷失败", errorText(e));
    }
  };

  // ---------------- 章 ----------------

  const addChapter = async (arc?: Arc) => {
    try {
      const created = await createChapter(projectId, { arcId: arc?.id });
      onSelect(created.id);
      notify("success", "已新建章节", arc ? arc.title + " · " + created.title : created.title);
    } catch (e) {
      notify("danger", "新建章节失败", errorText(e));
    }
  };

  const removeChapter = async (chapter: Chapter) => {
    if (!confirm("删除章节《" + chapter.title + "》？该章正文与历史快照会一起删除。")) return;
    try {
      await deleteChapter(chapter.id);
      notify("info", "章节已删除", chapter.title);
    } catch (e) {
      notify("danger", "删除章节失败", errorText(e));
    }
  };

  const renderChapterRow = (chapter: Chapter) => {
    const index = indexById.get(chapter.id) ?? 0;
    const active = chapter.id === selectedId;
    const dragging = dragId === chapter.id;
    const drop = dropTarget?.chapterId === chapter.id ? dropTarget.position : undefined;

    return (
      <li key={chapter.id} className="relative">
        {drop === "before" && <span className="absolute inset-x-1 -top-0.5 h-0.5 rounded bg-violet-500" />}
        {drop === "after" && <span className="absolute inset-x-1 -bottom-0.5 h-0.5 rounded bg-violet-500" />}
        <div
          data-chapter-row={chapter.id}
          role="button"
          tabIndex={0}
          draggable
          onDragStart={(e) => {
            setDragId(chapter.id);
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", chapter.id);
          }}
          onDragEnd={() => {
            setDragId(undefined);
            setDropTarget(undefined);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            const rect = e.currentTarget.getBoundingClientRect();
            setDropTarget({ chapterId: chapter.id, position: e.clientY < rect.top + rect.height / 2 ? "before" : "after" });
          }}
          onDrop={(e) => {
            e.preventDefault();
            const rect = e.currentTarget.getBoundingClientRect();
            const position = e.clientY < rect.top + rect.height / 2 ? "before" : "after";
            const id = dragId ?? e.dataTransfer.getData("text/plain");
            setDragId(undefined);
            setDropTarget(undefined);
            if (id && id !== chapter.id) void moveChapter(id, { chapterId: chapter.id, position });
          }}
          onClick={() => onSelect(chapter.id)}
          onDoubleClick={() => onOpenChapter(chapter.id)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSelect(chapter.id);
          }}
          className={
            "group flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 transition " +
            (active ? "bg-violet-500/[0.12] ring-1 ring-violet-500/30" : "hover:bg-black/[0.04] dark:hover:bg-white/5") +
            (dragging ? " opacity-40" : "")
          }
        >
          <GripVertical className="size-3.5 shrink-0 cursor-grab opacity-20 transition group-hover:opacity-60" />
          <span className="tabular w-7 shrink-0 text-[11px] opacity-45">{index + 1}</span>
          <span className="min-w-0 flex-1 truncate text-[13px]">{chapter.title}</span>
          <Chip size="sm" color={chapterStatusColor(chapter.status)}>
            {chapterStatusLabel(chapter.status)}
          </Chip>
          <span className="tabular w-14 shrink-0 text-right text-[11px] opacity-45">{formatWords(chapter.wordCount)}</span>
          <span
            className={
              "tabular w-6 shrink-0 text-right text-[11px] " +
              (chapter.tension > 0 ? "text-violet-500" : chapter.tension < 0 ? "text-sky-500" : "opacity-40")
            }
          >
            {tensionText(chapter.tension)}
          </span>
          <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
            <button
              type="button"
              title="上移"
              className="rounded p-0.5 opacity-50 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
              onClick={(e) => {
                e.stopPropagation();
                void shiftChapter(chapter.id, -1);
              }}
            >
              <ChevronUp className="size-3" />
            </button>
            <button
              type="button"
              title="下移"
              className="rounded p-0.5 opacity-50 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
              onClick={(e) => {
                e.stopPropagation();
                void shiftChapter(chapter.id, 1);
              }}
            >
              <ChevronDown className="size-3" />
            </button>
            <button
              type="button"
              title="去写作"
              className="rounded p-0.5 opacity-50 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
              onClick={(e) => {
                e.stopPropagation();
                onOpenChapter(chapter.id);
              }}
            >
              <PenLine className="size-3" />
            </button>
            <button
              type="button"
              title="删除章节"
              className="rounded p-0.5 text-rose-500 opacity-60 transition hover:bg-rose-500/10 hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                void removeChapter(chapter);
              }}
            >
              <Trash2 className="size-3" />
            </button>
          </span>
        </div>
      </li>
    );
  };

  return (
    <Card className="p-3">
      <div className="flex items-center justify-between gap-2 px-1 pb-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold tracking-tight">
          <Layers className="size-3.5 opacity-60" />
          卷 / 章结构
        </p>
        <div className="flex items-center gap-1">
          <Tooltip>
            <Tooltip.Trigger>
              <Button variant="ghost" size="sm" isIconOnly aria-label={allCollapsed ? "展开全部" : "折叠全部"} onPress={toggleAll}>
                <ChevronsDownUp className="size-3.5" />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content>{allCollapsed ? "展开全部" : "折叠全部"}</Tooltip.Content>
          </Tooltip>
          <Button variant="ghost" size="sm" isIconOnly aria-label="新建卷" onPress={() => setCreatingArc(true)}>
            <Plus className="size-4" />
          </Button>
        </div>
      </div>

      {arcs.length === 0 && chapters.length === 0 ? (
        <p className="px-2 py-6 text-center text-xs opacity-55">还没有卷，点右上角 ＋ 新建第一卷。</p>
      ) : (
        <ul className="space-y-2">
          {groups.map((group) => {
            const arc = group.arc;
            const key = arc?.id ?? LOOSE_KEY;
            const isCollapsed = collapsed[key] ?? false;
            const dropping =
              dropTarget !== undefined && dropTarget.chapterId === undefined && (dropTarget.arcId ?? null) === (arc?.id ?? null);

            return (
              <li key={key} className="rounded-xl border border-black/5 dark:border-white/5">
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDropTarget({ arcId: arc?.id ?? null, position: "into" });
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const id = dragId ?? e.dataTransfer.getData("text/plain");
                    setDragId(undefined);
                    setDropTarget(undefined);
                    if (id) void moveChapter(id, { arcId: arc?.id ?? null, position: "into" });
                  }}
                  className={
                    "flex items-center gap-1.5 rounded-t-xl px-2 py-2 transition " +
                    (dropping ? "bg-violet-500/[0.12] ring-1 ring-violet-500/40" : "bg-black/[0.02] dark:bg-white/[0.03]")
                  }
                >
                  <button
                    type="button"
                    aria-label={isCollapsed ? "展开" : "折叠"}
                    className="rounded p-0.5 opacity-60 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
                    onClick={() => toggleArc(key)}
                  >
                    {isCollapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                  </button>
                  <span className="inline-block size-2 shrink-0 rounded-full" style={{ background: arc ? (arc.color ?? "#7c5cff") : "currentColor", opacity: arc ? 1 : 0.25 }} />

                  {arc && renamingId === arc.id ? (
                    <input
                      autoFocus
                      value={renameText}
                      onChange={(e) => setRenameText(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onBlur={() => void commitRename(arc)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void commitRename(arc);
                        if (e.key === "Escape") setRenamingId(undefined);
                      }}
                      className="min-w-0 flex-1 rounded border border-violet-500/50 bg-white/80 px-1.5 py-0.5 text-[13px] font-medium outline-none dark:bg-neutral-900/70"
                    />
                  ) : (
                    <span
                      className={"min-w-0 flex-1 truncate text-[13px] " + (arc ? "font-medium" : "opacity-70")}
                      title={arc?.summary ?? undefined}
                    >
                      {arc ? arc.title : "未分卷"}
                    </span>
                  )}

                  <span className="tabular shrink-0 text-[11px] opacity-45">
                    {group.chapters.length} 章 · {formatWords(sumWords(group.chapters))}
                  </span>

                  <span className="flex shrink-0 items-center gap-0.5">
                    <button
                      type="button"
                      title="在本卷新建章节"
                      className="rounded p-0.5 opacity-50 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
                      onClick={() => void addChapter(arc)}
                    >
                      <Plus className="size-3.5" />
                    </button>
                    {arc && (
                      <>
                        <button
                          type="button"
                          title="重命名卷"
                          className="rounded p-0.5 opacity-50 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
                          onClick={() => {
                            setRenameText(arc.title);
                            setRenamingId(arc.id);
                          }}
                        >
                          <Pencil className="size-3" />
                        </button>
                        <button
                          type="button"
                          title="删除卷"
                          className="rounded p-0.5 text-rose-500 opacity-60 transition hover:bg-rose-500/10 hover:opacity-100"
                          onClick={() => void removeArc(arc)}
                        >
                          <Trash2 className="size-3" />
                        </button>
                      </>
                    )}
                  </span>
                </div>

                {!isCollapsed && (
                  <div className="p-2 pt-1">
                    {group.chapters.length === 0 ? (
                      <p className="px-2 py-2 text-[11px] opacity-45">
                        这一卷还没有章节，
                        <button type="button" className="text-violet-500 hover:underline" onClick={() => void addChapter(arc)}>
                          新建一章
                        </button>
                      </p>
                    ) : (
                      <ul className="space-y-0.5">{group.chapters.map(renderChapterRow)}</ul>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {creatingArc ? (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-violet-500/40 p-2">
          <input
            autoFocus
            value={newArcTitle}
            placeholder={"第" + (arcs.length + 1) + "卷 卷名"}
            onChange={(e) => setNewArcTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void addArc();
              if (e.key === "Escape") {
                setCreatingArc(false);
                setNewArcTitle("");
              }
            }}
            className="min-w-0 flex-1 rounded border border-black/10 bg-white/70 px-2 py-1 text-[13px] outline-none focus:border-violet-500 dark:border-white/10 dark:bg-neutral-900/70"
          />
          <Button size="sm" variant="primary" onPress={() => void addArc()}>
            新建
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onPress={() => {
              setCreatingArc(false);
              setNewArcTitle("");
            }}
          >
            取消
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setCreatingArc(true)}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-black/10 py-2 text-[12px] opacity-60 transition hover:border-violet-500/40 hover:opacity-100 dark:border-white/10"
        >
          <Plus className="size-3.5" />
          新建卷
        </button>
      )}

      {looseChapters.length > 0 && arcs.length > 0 && (
        <p className="mt-2 px-1 text-[11px] opacity-40">提示：把章节拖到卷标题上即可归入该卷。</p>
      )}
    </Card>
  );
}
