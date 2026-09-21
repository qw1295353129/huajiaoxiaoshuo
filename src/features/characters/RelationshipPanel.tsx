import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Card, Chip } from "@heroui/react";
import { Link2, Plus, Trash2 } from "lucide-react";
import type { ID, RelationKind, Relationship } from "@/core";
import { useCharacters, useRelationships } from "@/app/hooks";
import { deleteRelationship, upsertRelationship } from "@/db/repo/cast";
import { ROUTES } from "@/app/routes";
import { useAppStore } from "@/app/store";
import { CharacterAvatar, ConfirmDialog, Labeled, MiniEmpty, selectClass } from "./parts";
import { RELATION_LABEL, RELATION_ORDER, affinityColor, affinityLabel, otherSide, relationLabel } from "./meta";

/**
 * 关系列表：该角色作为 from 或 to 的所有有向边。
 * 类型与好感度就地编辑，保存走 upsertRelationship(projectId, fromId, toId, patch)。
 */
export function RelationshipPanel({ projectId, characterId }: { projectId: ID; characterId: ID }) {
  const navigate = useNavigate();
  const notify = useAppStore((s) => s.notify);
  const relationships = useRelationships(projectId);
  const characters = useCharacters(projectId);

  const [adding, setAdding] = useState(false);
  const [targetId, setTargetId] = useState("");
  const [newKind, setNewKind] = useState<RelationKind>("acquaintance");
  const [pendingRemove, setPendingRemove] = useState<Relationship | null>(null);
  const [busy, setBusy] = useState(false);
  const [affinityDraft, setAffinityDraft] = useState<Record<string, number>>({});

  const byId = useMemo(() => new Map(characters.map((c) => [c.id, c])), [characters]);

  const mine = useMemo(
    () => relationships.filter((r) => r.fromId === characterId || r.toId === characterId),
    [relationships, characterId],
  );

  const candidates = useMemo(
    () =>
      characters
        .filter((c) => c.id !== characterId)
        .filter((c) => !mine.some((r) => otherSide(r, characterId) === c.id))
        .sort((a, b) => a.name.localeCompare(b.name, "zh")),
    [characters, mine, characterId],
  );

  const affinityOf = (r: Relationship) => affinityDraft[r.id] ?? r.affinity;
  const timerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const savePatch = async (r: Relationship, patch: Partial<Relationship>) => {
    try {
      await upsertRelationship(projectId, r.fromId, r.toId, patch);
    } catch (e) {
      notify("danger", "关系保存失败", e instanceof Error ? e.message : String(e));
    }
  };

  const commitAffinity = async (r: Relationship, value: number) => {
    if (value === undefined || value === r.affinity) return;
    await savePatch(r, { affinity: value });
  };

  /** 拖动过程中先只改本地，避免每一像素都写库 */
  const changeAffinity = (r: Relationship, value: number) => {
    setAffinityDraft((prev) => ({ ...prev, [r.id]: value }));
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => void commitAffinity(r, value), 500);
  };

  /** 松开滑块 / 失焦时立刻落库 */
  const flushAffinity = (r: Relationship) => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    void commitAffinity(r, affinityDraft[r.id] ?? r.affinity);
  };

  const add = async () => {
    if (!targetId) {
      notify("warning", "请先选择关系对象");
      return;
    }
    setBusy(true);
    try {
      await upsertRelationship(projectId, characterId, targetId, { kind: newKind, affinity: 0 });
      notify("success", "已添加关系");
      setTargetId("");
      setNewKind("acquaintance");
      setAdding(false);
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
      await deleteRelationship(pendingRemove.id);
      notify("success", "已删除关系");
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
            <Link2 className="size-4 opacity-60" />
            人物关系
          </div>
          <p className="mt-0.5 text-xs opacity-55">好感度是单向的，箭头指向被评价的一方</p>
        </div>
        <Button size="sm" variant={adding ? "ghost" : "secondary"} onPress={() => setAdding((v) => !v)}>
          <Plus className="size-3.5" />
          添加
        </Button>
      </div>

      {adding && (
        <div className="mb-3 space-y-2 rounded-lg border border-black/5 bg-black/[0.02] p-3 dark:border-white/5 dark:bg-white/[0.03]">
          <Labeled label="关系对象">
            <select className={selectClass} value={targetId} onChange={(e) => setTargetId(e.target.value)}>
              <option value="">选择角色…</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Labeled>
          <Labeled label="关系类型">
            <select
              className={selectClass}
              value={newKind}
              onChange={(e) => setNewKind(e.target.value as RelationKind)}
            >
              {RELATION_ORDER.map((k) => (
                <option key={k} value={k}>
                  {RELATION_LABEL[k]}
                </option>
              ))}
            </select>
          </Labeled>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" isDisabled={busy} onPress={() => setAdding(false)}>
              取消
            </Button>
            <Button size="sm" variant="primary" isPending={busy} onPress={() => void add()}>
              添加
            </Button>
          </div>
        </div>
      )}

      {mine.length === 0 ? (
        <MiniEmpty>还没有关系记录。关系图、一致性检查与 AI 续写都会用到这里的设定。</MiniEmpty>
      ) : (
        <div className="space-y-2.5">
          {mine.map((r) => {
            const other = byId.get(otherSide(r, characterId));
            const outgoing = r.fromId === characterId;
            const value = affinityOf(r);
            return (
              <div key={r.id} className="rounded-lg border border-black/5 p-2.5 dark:border-white/5">
                <div className="flex items-center gap-2">
                  {other ? <CharacterAvatar character={other} size={28} /> : null}
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left text-sm font-medium hover:text-violet-500"
                    onClick={() => other && navigate(ROUTES.character(projectId, other.id))}
                  >
                    {other?.name ?? "（角色已删除）"}
                  </button>
                  <Chip size="sm" color={outgoing ? "accent" : "default"}>
                    {outgoing ? "他 → 对方" : "对方 → 他"}
                  </Chip>
                  <button
                    type="button"
                    aria-label="删除关系"
                    className="shrink-0 rounded p-1 opacity-40 transition hover:text-rose-500 hover:opacity-100"
                    onClick={() => setPendingRemove(r)}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>

                <div className="mt-2 grid items-center gap-2 sm:grid-cols-2">
                  <select
                    className={selectClass}
                    value={r.kind}
                    aria-label="关系类型"
                    onChange={(e) => void savePatch(r, { kind: e.target.value as RelationKind })}
                  >
                    {RELATION_ORDER.map((k) => (
                      <option key={k} value={k}>
                        {RELATION_LABEL[k]}
                      </option>
                    ))}
                  </select>

                  <div>
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="tabular opacity-70">
                        {value > 0 ? "+" : ""}
                        {value} · {affinityLabel(value)}
                      </span>
                      <Chip size="sm" color={affinityColor(value)}>
                        {relationLabel(r.kind)}
                      </Chip>
                    </div>
                    <input
                      type="range"
                      min={-100}
                      max={100}
                      step={1}
                      value={value}
                      aria-label="好感度"
                      className="mt-1 h-1.5 w-full cursor-pointer accent-violet-500"
                      onChange={(e) => changeAffinity(r, Number(e.target.value))}
                      onPointerUp={() => flushAffinity(r)}
                      onKeyUp={() => flushAffinity(r)}
                      onBlur={() => flushAffinity(r)}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(pendingRemove)}
        onOpenChange={(open) => {
          if (!open) setPendingRemove(null);
        }}
        title="删除关系"
        description={<>确定删除与「{pendingRemove ? (byId.get(otherSide(pendingRemove, characterId))?.name ?? "对方") : ""}」的这条关系吗？</>}
        isPending={busy}
        onConfirm={() => void remove()}
      />
    </Card>
  );
}
