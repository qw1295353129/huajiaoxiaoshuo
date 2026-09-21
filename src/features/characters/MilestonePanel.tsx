import { useEffect, useMemo, useState } from "react";
import { Button, Card } from "@heroui/react";
import { CalendarClock, Plus, Trash2 } from "lucide-react";
import type { Character, CharacterMilestone, ID } from "@/core";
import { useChapters } from "@/app/hooks";
import { addMilestone, removeMilestone } from "@/db/repo/cast";
import { useAppStore } from "@/app/store";
import { ConfirmDialog, Labeled, MiniEmpty, inputClass, selectClass, textareaClass } from "./parts";

/**
 * 里程碑时间线：角色的状态变化节点（黑化、断臂、被逐出师门……）。
 * 增删直接落库（addMilestone / removeMilestone），不像其它区块那样需要"保存"。
 */
export function MilestonePanel({ character, projectId }: { character: Character; projectId: ID }) {
  const chapters = useChapters(projectId);
  const notify = useAppStore((s) => s.notify);
  const [formOpen, setFormOpen] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<CharacterMilestone | null>(null);
  const [busy, setBusy] = useState(false);

  const [chapterId, setChapterId] = useState("");
  const [storyTime, setStoryTime] = useState("");
  const [label, setLabel] = useState("");
  const [detail, setDetail] = useState("");

  useEffect(() => {
    if (!formOpen) return;
    setChapterId("");
    setStoryTime("");
    setLabel("");
    setDetail("");
  }, [formOpen]);

  const sortedChapters = useMemo(() => [...chapters].sort((a, b) => a.order - b.order), [chapters]);

  const list = useMemo(() => {
    const orderOf = new Map(sortedChapters.map((c) => [c.id, c.order]));
    return [...(character.milestones ?? [])].sort((a, b) => {
      const ao = a.chapterId ? (orderOf.get(a.chapterId) ?? 9999) : 9999;
      const bo = b.chapterId ? (orderOf.get(b.chapterId) ?? 9999) : 9999;
      return ao - bo || (a.storyTime ?? "").localeCompare(b.storyTime ?? "", "zh");
    });
  }, [character.milestones, sortedChapters]);

  const add = async () => {
    if (!label.trim()) {
      notify("warning", "请先写一句里程碑说明");
      return;
    }
    setBusy(true);
    try {
      await addMilestone(character.id, {
        chapterId: chapterId || undefined,
        storyTime: storyTime.trim() || undefined,
        label: label.trim(),
        detail: detail.trim() || undefined,
      });
      notify("success", "已添加里程碑", label.trim());
      setFormOpen(false);
    } catch (e) {
      notify("danger", "添加失败", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!pendingRemove) return;
    setBusy(true);
    try {
      await removeMilestone(character.id, pendingRemove.id);
      notify("success", "已删除里程碑");
      setPendingRemove(null);
    } catch (e) {
      notify("danger", "删除失败", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5 text-sm font-semibold tracking-tight">
            <CalendarClock className="size-4 opacity-60" />
            里程碑
          </div>
          <p className="mt-0.5 text-xs opacity-55">角色的关键转折节点，按章节顺序排列</p>
        </div>
        <Button size="sm" variant={formOpen ? "ghost" : "secondary"} onPress={() => setFormOpen((v) => !v)}>
          <Plus className="size-3.5" />
          添加
        </Button>
      </div>

      {formOpen && (
        <div
          role="group"
          aria-label="新增里程碑"
          className="mb-4 space-y-2 rounded-lg border border-black/5 bg-black/[0.02] p-3 dark:border-white/5 dark:bg-white/[0.03]"
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <Labeled label="关联章节">
              <select className={selectClass} value={chapterId} onChange={(e) => setChapterId(e.target.value)}>
                <option value="">不关联章节</option>
                {sortedChapters.map((c) => (
                  <option key={c.id} value={c.id}>
                    第{c.order + 1}章 {c.title}
                  </option>
                ))}
              </select>
            </Labeled>
            <Labeled label="剧情内时间" hint="可以写模糊值，如「第三年·冬」">
              <input
                className={inputClass}
                value={storyTime}
                placeholder="第三年·冬"
                onChange={(e) => setStoryTime(e.target.value)}
              />
            </Labeled>
          </div>
          <Labeled label="说明" hint="一句话即可，如「得知师父是真凶」">
            <input className={inputClass} value={label} onChange={(e) => setLabel(e.target.value)} />
          </Labeled>
          <Labeled label="补充（可选）">
            <textarea className={textareaClass} rows={2} value={detail} onChange={(e) => setDetail(e.target.value)} />
          </Labeled>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" isDisabled={busy} onPress={() => setFormOpen(false)}>
              取消
            </Button>
            <Button size="sm" variant="primary" isPending={busy} onPress={() => void add()}>
              添加
            </Button>
          </div>
        </div>
      )}

      {list.length === 0 ? (
        <MiniEmpty>还没有里程碑。把「他是什么时候变成现在这样的」拆成几个节点记下来。</MiniEmpty>
      ) : (
        <ol className="relative space-y-3 border-l border-black/10 pl-4 dark:border-white/10">
          {list.map((m) => {
            const chapter = m.chapterId ? sortedChapters.find((c) => c.id === m.chapterId) : undefined;
            return (
              <li key={m.id} className="relative">
                <span className="absolute top-1.5 -left-[21px] size-2 rounded-full bg-violet-500" />
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm leading-snug font-medium">{m.label}</p>
                    <p className="mt-0.5 text-[11px] opacity-55">
                      {[chapter ? "第" + (chapter.order + 1) + "章 " + chapter.title : "", m.storyTime ?? ""]
                        .filter(Boolean)
                        .join(" · ") || "未标注位置"}
                    </p>
                    {m.detail ? <p className="mt-1 text-xs leading-relaxed opacity-65">{m.detail}</p> : null}
                  </div>
                  <button
                    type="button"
                    aria-label="删除里程碑"
                    className="shrink-0 rounded p-1 opacity-40 transition hover:text-rose-500 hover:opacity-100"
                    onClick={() => setPendingRemove(m)}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <ConfirmDialog
        open={Boolean(pendingRemove)}
        onOpenChange={(open) => {
          if (!open) setPendingRemove(null);
        }}
        title="删除里程碑"
        description={<>确定删除「{pendingRemove?.label}」吗？</>}
        isPending={busy}
        onConfirm={() => void remove()}
      />
    </Card>
  );
}
