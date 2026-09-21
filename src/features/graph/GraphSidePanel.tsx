import { useEffect, useMemo, useState } from "react";
import { Button, Card, Chip } from "@heroui/react";
import { ArrowLeft, Link2, Plus, Save, Trash2, UserRound } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { Character, RelationKind, Relationship } from "@/core";
import { deleteRelationship, upsertRelationship } from "@/db/repo/cast";
import { useAppStore } from "@/app/store";
import { ROUTES } from "@/app/routes";
import {
  RELATION_KINDS,
  STATUS_LABELS,
  affinityLabel,
  affinityTone,
  relationLabel,
  relationTone,
  roleColor,
  roleLabel,
} from "./graphMeta";
import { DIVIDER_CLASS, FIELD_CLASS, LABEL_CLASS, SELECT_CLASS } from "./styles";

/** 右侧信息栏：角色详情 / 关系编辑。 */
export function GraphSidePanel({
  projectId,
  node,
  edge,
  characters,
  relationships,
  appearances,
  firstChapterTitles,
  onSelectEdge,
  onClose,
}: {
  projectId: string;
  node?: Character;
  edge?: Relationship;
  characters: Character[];
  relationships: Relationship[];
  appearances: Map<string, number>;
  firstChapterTitles: Map<string, string>;
  onSelectEdge: (id: string) => void;
  onClose: () => void;
}) {
  if (edge) {
    return <EdgeEditor projectId={projectId} edge={edge} characters={characters} onClose={onClose} />;
  }
  if (node) {
    return (
      <NodeDetail
        projectId={projectId}
        node={node}
        characters={characters}
        relationships={relationships}
        appearances={appearances}
        firstChapterTitles={firstChapterTitles}
        onSelectEdge={onSelectEdge}
      />
    );
  }
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <Link2 className="size-4 opacity-40" />
        <p className="text-sm font-medium">图谱操作</p>
      </div>
      <ul className="mt-3 space-y-2 text-xs leading-relaxed opacity-60">
        <li>· 点击节点：查看该角色的信息与全部关系</li>
        <li>· 点击连线：编辑关系类型与情感值</li>
        <li>· 拖拽节点可以手动调整布局，拖动空白处平移画布</li>
        <li>· 滚轮缩放，右上角按钮可以放大 / 缩小 / 复位</li>
      </ul>
    </Card>
  );
}

/** 角色详情 + 关系列表 + 新增关系 */
function NodeDetail({
  projectId,
  node,
  characters,
  relationships,
  appearances,
  firstChapterTitles,
  onSelectEdge,
}: {
  projectId: string;
  node: Character;
  characters: Character[];
  relationships: Relationship[];
  appearances: Map<string, number>;
  firstChapterTitles: Map<string, string>;
  onSelectEdge: (id: string) => void;
}) {
  const navigate = useNavigate();
  const notify = useAppStore((s) => s.notify);
  const [adding, setAdding] = useState(false);
  const [targetId, setTargetId] = useState("");
  const [kind, setKind] = useState<RelationKind>("acquaintance");
  const [affinity, setAffinity] = useState(0);
  const [saving, setSaving] = useState(false);

  const outgoing = useMemo(() => relationships.filter((r) => r.fromId === node.id), [relationships, node.id]);
  const incoming = useMemo(() => relationships.filter((r) => r.toId === node.id), [relationships, node.id]);
  const others = characters.filter((c) => c.id !== node.id);

  const nameOf = (id: string) => characters.find((c) => c.id === id)?.name ?? "已删除角色";
  const color = node.color || roleColor(node.role);
  const appearanceCount = appearances.get(node.id) ?? 0;

  const save = async () => {
    if (!targetId) {
      notify("warning", "请选择关系对象");
      return;
    }
    setSaving(true);
    try {
      await upsertRelationship(projectId, node.id, targetId, { kind, affinity });
      notify("success", "关系已保存", node.name + " → " + nameOf(targetId));
      setAdding(false);
      setTargetId("");
      setAffinity(0);
      setKind("acquaintance");
    } catch (e) {
      notify("danger", "保存失败", e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <span
          className="grid size-11 shrink-0 place-items-center rounded-full text-base font-medium text-white"
          style={{ backgroundColor: color }}
        >
          {node.avatarEmoji || node.name.slice(0, 1)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{node.name}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <Chip size="sm" color="accent">
              {roleLabel(node.role)}
            </Chip>
            <Chip size="sm">{STATUS_LABELS[node.status] ?? node.status}</Chip>
          </div>
        </div>
      </div>

      {node.tagline && <p className="mt-3 text-xs leading-relaxed opacity-65">{node.tagline}</p>}

      <div className={"mt-3 grid grid-cols-2 gap-2 border-t pt-3 text-xs " + DIVIDER_CLASS}>
        <div>
          <p className="opacity-45">出场章节</p>
          <p className="tabular mt-0.5 font-medium">{appearanceCount} 章</p>
        </div>
        <div>
          <p className="opacity-45">首次出场</p>
          <p className="mt-0.5 truncate font-medium">
            {node.firstAppearanceChapterId ? firstChapterTitles.get(node.firstAppearanceChapterId) ?? "—" : "未记录"}
          </p>
        </div>
      </div>

      {node.tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {node.tags.map((tag) => (
            <Chip key={tag} size="sm" color="default">
              {tag}
            </Chip>
          ))}
        </div>
      )}

      <Button className="mt-4" variant="primary" size="sm" fullWidth onPress={() => navigate(ROUTES.character(projectId, node.id))}>
        <UserRound className="size-4" />
        打开人物详情页
      </Button>

      <div className={"mt-4 border-t pt-3 " + DIVIDER_CLASS}>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium">关系（{outgoing.length + incoming.length}）</p>
          <Button size="sm" variant="ghost" onPress={() => setAdding((v) => !v)}>
            <Plus className="size-3.5" />
            新增
          </Button>
        </div>

        {adding && (
          <div className="mt-2 space-y-2 rounded-lg bg-black/[0.03] p-2.5 dark:bg-white/[0.04]">
            <div>
              <label className={LABEL_CLASS}>关系对象</label>
              <select className={SELECT_CLASS} value={targetId} onChange={(e) => setTargetId(e.target.value)}>
                <option value="">请选择角色</option>
                {others.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}（{roleLabel(c.role)}）
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={LABEL_CLASS}>类型</label>
                <select className={SELECT_CLASS} value={kind} onChange={(e) => setKind(e.target.value as RelationKind)}>
                  {RELATION_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {relationLabel(k)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={LABEL_CLASS}>情感值 {affinity}</label>
                <input
                  type="range"
                  min={-100}
                  max={100}
                  value={affinity}
                  className="mt-2 w-full accent-violet-500"
                  onChange={(e) => setAffinity(Number(e.target.value))}
                />
              </div>
            </div>
            <Button size="sm" variant="primary" fullWidth isPending={saving} onPress={save}>
              <Save className="size-3.5" />
              保存关系
            </Button>
          </div>
        )}

        <ul className="mt-2 space-y-1">
          {outgoing.length === 0 && incoming.length === 0 && (
            <li className="py-2 text-xs opacity-50">还没有与其他人建立关系，点「新增」开始建立。</li>
          )}
          {outgoing.map((rel) => (
            <RelationRow
              key={rel.id}
              direction="→"
              label={nameOf(rel.toId)}
              relationship={rel}
              onSelect={() => onSelectEdge(rel.id)}
            />
          ))}
          {incoming.map((rel) => (
            <RelationRow
              key={rel.id}
              direction="←"
              label={nameOf(rel.fromId)}
              relationship={rel}
              onSelect={() => onSelectEdge(rel.id)}
            />
          ))}
        </ul>
      </div>
    </Card>
  );
}

function RelationRow({
  direction,
  label,
  relationship,
  onSelect,
}: {
  direction: string;
  label: string;
  relationship: Relationship;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={"flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-xs transition hover:bg-black/[0.03] dark:hover:bg-white/[0.05] " + DIVIDER_CLASS}
      >
        <span className="opacity-40">{direction}</span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <Chip size="sm" color={relationTone(relationship.kind)}>
          {relationLabel(relationship.kind)}
        </Chip>
        <Chip size="sm" color={affinityTone(relationship.affinity)}>
          {relationship.affinity > 0 ? "+" : ""}
          {relationship.affinity}
        </Chip>
      </button>
    </li>
  );
}

/** 关系编辑：类型 + 情感值 + 公开程度 */
function EdgeEditor({
  projectId,
  edge,
  characters,
  onClose,
}: {
  projectId: string;
  edge: Relationship;
  characters: Character[];
  onClose: () => void;
}) {
  const notify = useAppStore((s) => s.notify);
  const [kind, setKind] = useState<RelationKind>(edge.kind);
  const [affinity, setAffinity] = useState(edge.affinity);
  const [visibility, setVisibility] = useState<Relationship["visibility"]>(edge.visibility);
  const [description, setDescription] = useState(edge.description ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setKind(edge.kind);
    setAffinity(edge.affinity);
    setVisibility(edge.visibility);
    setDescription(edge.description ?? "");
  }, [edge.id, edge.kind, edge.affinity, edge.visibility, edge.description]);

  const from = characters.find((c) => c.id === edge.fromId);
  const to = characters.find((c) => c.id === edge.toId);
  const changed =
    kind !== edge.kind || affinity !== edge.affinity || visibility !== edge.visibility || description !== (edge.description ?? "");

  const save = async () => {
    setSaving(true);
    try {
      await upsertRelationship(projectId, edge.fromId, edge.toId, {
        kind,
        affinity,
        visibility,
        description: description.trim() || undefined,
      });
      notify("success", "关系已更新", (from?.name ?? "?") + " → " + (to?.name ?? "?"));
    } catch (e) {
      notify("danger", "保存失败", e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!window.confirm("删除关系「" + (from?.name ?? "?") + " → " + (to?.name ?? "?") + "」？")) return;
    try {
      await deleteRelationship(edge.id);
      notify("success", "关系已删除");
      onClose();
    } catch (e) {
      notify("danger", "删除失败", e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">编辑关系</p>
        <Button size="sm" variant="ghost" onPress={onClose}>
          <ArrowLeft className="size-3.5" />
          返回
        </Button>
      </div>

      <div className="mt-3 flex items-center gap-2 text-xs">
        <span className="grid size-6 place-items-center rounded-full text-[11px] text-white" style={{ backgroundColor: from?.color || "#8b5cf6" }}>
          {from?.avatarEmoji || (from?.name ?? "?").slice(0, 1)}
        </span>
        <span className="font-medium">{from?.name ?? "已删除角色"}</span>
        <span className="opacity-40">→</span>
        <span className="grid size-6 place-items-center rounded-full text-[11px] text-white" style={{ backgroundColor: to?.color || "#8b5cf6" }}>
          {to?.avatarEmoji || (to?.name ?? "?").slice(0, 1)}
        </span>
        <span className="font-medium">{to?.name ?? "已删除角色"}</span>
      </div>

      <div className="mt-4 space-y-3">
        <div>
          <label className={LABEL_CLASS}>关系类型</label>
          <select className={SELECT_CLASS} value={kind} onChange={(e) => setKind(e.target.value as RelationKind)}>
            {RELATION_KINDS.map((k) => (
              <option key={k} value={k}>
                {relationLabel(k)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={LABEL_CLASS}>
            情感值 {affinity > 0 ? "+" : ""}
            {affinity} · {affinityLabel(affinity)}
          </label>
          <input
            type="range"
            min={-100}
            max={100}
            value={affinity}
            className="w-full accent-violet-500"
            onChange={(e) => setAffinity(Number(e.target.value))}
          />
          <div className="mt-1 flex justify-between text-[10px] opacity-40">
            <span>-100 死敌</span>
            <span>0</span>
            <span>+100 生死之交</span>
          </div>
        </div>

        <div>
          <label className={LABEL_CLASS}>公开程度</label>
          <select
            className={SELECT_CLASS}
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as Relationship["visibility"])}
          >
            <option value="public">公开</option>
            <option value="secret">隐秘</option>
            <option value="one-sided">单向</option>
          </select>
        </div>

        <div>
          <label className={LABEL_CLASS}>说明</label>
          <textarea
            className={FIELD_CLASS}
            rows={3}
            value={description}
            placeholder="这段关系的由来、当前状态、可能的走向"
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <Button variant="primary" size="sm" isPending={saving} isDisabled={!changed} onPress={save}>
          <Save className="size-3.5" />
          保存
        </Button>
        <Button variant="danger-soft" size="sm" onPress={remove}>
          <Trash2 className="size-3.5" />
          删除关系
        </Button>
      </div>
    </Card>
  );
}
