import { useMemo, useState } from "react";
import { Button, Tooltip } from "@heroui/react";
import { Archive, ArchiveRestore, Check, MessageSquare, Pencil, Plus, Trash2, X } from "lucide-react";
import type { AiSession, ID } from "@/core";
import { useDebounced } from "@/app/hooks";
import { formatRelative } from "@/utils/format";

interface Props {
  sessions: AiSession[];
  activeId?: ID;
  /** 本次会话中被归档、可以就地恢复的对话 */
  archived: AiSession[];
  onSelect: (id: ID) => void;
  onCreate: () => void;
  onRename: (id: ID, title: string) => void;
  onArchive: (id: ID) => void;
  onRestore: (id: ID) => void;
  onDelete: (id: ID) => void;
}

/** 左侧会话列表：新建 / 重命名 / 归档 / 删除 */
export function SessionSidebar({
  sessions,
  activeId,
  archived,
  onSelect,
  onCreate,
  onRename,
  onArchive,
  onRestore,
  onDelete,
}: Props) {
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<ID>();
  const [draft, setDraft] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const debounced = useDebounced(query, 200);

  const filtered = useMemo(() => {
    const q = debounced.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => {
      if (s.title.toLowerCase().includes(q)) return true;
      return s.messages.some((m) => m.content.toLowerCase().includes(q));
    });
  }, [sessions, debounced]);

  const commit = (id: ID) => {
    onRename(id, draft);
    setEditingId(undefined);
  };

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-black/5 md:flex dark:border-white/5">
      <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
        <p className="text-sm font-semibold tracking-tight">对话</p>
        <Button size="sm" variant="secondary" onPress={onCreate}>
          <Plus className="size-3.5" />
          新建
        </Button>
      </div>

      <div className="px-3 pb-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索对话内容…"
          className="w-full rounded-lg border border-black/8 bg-white/60 px-2.5 py-1.5 text-xs outline-none transition placeholder:opacity-40 focus:border-black/30 dark:border-white/10 dark:bg-white/5"
        />
      </div>

      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
        {filtered.length === 0 && (
          <p className="px-2 py-6 text-center text-xs leading-relaxed opacity-45">
            {sessions.length === 0 ? "还没有对话，点右上角「新建」开始。" : "没有匹配的对话。"}
          </p>
        )}

        {filtered.map((session) => {
          const active = session.id === activeId;
          const editing = editingId === session.id;
          const last = session.messages[session.messages.length - 1];
          return (
            <div
              key={session.id}
              className={
                "group rounded-lg px-2 py-2 transition " +
                (active ? "bg-black/[0.06] dark:bg-white/10" : "hover:bg-black/[0.04] dark:hover:bg-white/5")
              }
            >
              {editing ? (
                <div className="flex items-center gap-1">
                  <input
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commit(session.id);
                      if (e.key === "Escape") setEditingId(undefined);
                    }}
                    className="min-w-0 flex-1 rounded-md border border-black/30 bg-transparent px-1.5 py-1 text-xs outline-none"
                  />
                  <button type="button" aria-label="确认重命名" onClick={() => commit(session.id)}>
                    <Check className="size-3.5 text-emerald-500" />
                  </button>
                  <button type="button" aria-label="取消重命名" onClick={() => setEditingId(undefined)}>
                    <X className="size-3.5 opacity-50" />
                  </button>
                </div>
              ) : (
                <button type="button" onClick={() => onSelect(session.id)} className="block w-full text-left">
                  <span className="flex items-center gap-1.5">
                    <MessageSquare className="size-3.5 shrink-0 opacity-40" />
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">{session.title}</span>
                  </span>
                  <span className="mt-0.5 block truncate pl-5 text-[11px] opacity-45">
                    {last ? last.content.slice(0, 40) : "空对话"}
                  </span>
                  <span className="mt-0.5 block pl-5 text-[10px] opacity-35">
                    {session.messages.length} 条 · {formatRelative(session.updatedAt)}
                  </span>
                </button>
              )}

              {!editing && (
                <div className="mt-1 flex items-center gap-0.5 opacity-0 transition group-hover:opacity-60">
                  <Tooltip>
                    <Tooltip.Trigger>
                      <Button
                        size="sm"
                        variant="ghost"
                        isIconOnly
                        aria-label="重命名"
                        onPress={() => {
                          setEditingId(session.id);
                          setDraft(session.title);
                        }}
                      >
                        <Pencil className="size-3" />
                      </Button>
                    </Tooltip.Trigger>
                    <Tooltip.Content>重命名</Tooltip.Content>
                  </Tooltip>
                  <Tooltip>
                    <Tooltip.Trigger>
                      <Button size="sm" variant="ghost" isIconOnly aria-label="归档" onPress={() => onArchive(session.id)}>
                        <Archive className="size-3" />
                      </Button>
                    </Tooltip.Trigger>
                    <Tooltip.Content>归档（从列表隐藏）</Tooltip.Content>
                  </Tooltip>
                  <Tooltip>
                    <Tooltip.Trigger>
                      <Button size="sm" variant="ghost" isIconOnly aria-label="删除" onPress={() => onDelete(session.id)}>
                        <Trash2 className="size-3" />
                      </Button>
                    </Tooltip.Trigger>
                    <Tooltip.Content>删除对话</Tooltip.Content>
                  </Tooltip>
                </div>
              )}
            </div>
          );
        })}

        {archived.length > 0 && (
          <div className="mt-2 border-t border-black/5 pt-2 dark:border-white/5">
            <button
              type="button"
              onClick={() => setShowArchived((v) => !v)}
              className="w-full px-2 py-1 text-left text-[11px] opacity-50 transition hover:opacity-80"
            >
              {showArchived ? "收起" : "展开"}本次归档（{archived.length}）
            </button>
            {showArchived &&
              archived.map((session) => (
                <div key={session.id} className="flex items-center gap-1 rounded-lg px-2 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-xs opacity-55">{session.title}</span>
                  <Tooltip>
                    <Tooltip.Trigger>
                      <Button size="sm" variant="ghost" isIconOnly aria-label="恢复" onPress={() => onRestore(session.id)}>
                        <ArchiveRestore className="size-3" />
                      </Button>
                    </Tooltip.Trigger>
                    <Tooltip.Content>恢复对话</Tooltip.Content>
                  </Tooltip>
                  <Button size="sm" variant="ghost" isIconOnly aria-label="删除" onPress={() => onDelete(session.id)}>
                    <Trash2 className="size-3" />
                  </Button>
                </div>
              ))}
          </div>
        )}
      </div>
    </aside>
  );
}
