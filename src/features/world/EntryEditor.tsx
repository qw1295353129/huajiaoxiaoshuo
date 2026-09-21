import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, Chip, Tooltip } from "@heroui/react";
import { Eye, Info, Link2, Pencil, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import type { ID, WorldCategory, WorldEntry, WorldRule } from "@/core";
import { WORLD_CATEGORY_LABELS } from "@/db/defaults";
import { createWorldEntry, deleteWorldEntry, updateWorldEntry } from "@/db/repo/world";
import { useAppStore } from "@/app/store";
import { SectionTitle } from "@/components/common/ui";
import { formatDateTime, formatRelative } from "@/utils/format";
import { newId } from "@/utils/id";
import { ImportanceStars, WikiBody } from "./bits";
import { INPUT_CLASS, categoryLabel } from "./world-labels";
import { collectDescendantIds, parseLines, parseTags, resolveRefs, type TitleIndex } from "./world-links";

interface Props {
  projectId: ID;
  entry?: WorldEntry;
  /** true 时 entry 为空，表示正在新建 */
  isNew: boolean;
  entries: WorldEntry[];
  titleIndex: TitleIndex;
  incoming: Map<ID, ID[]>;
  outgoing: Map<ID, ID[]>;
  onSelect: (id: ID) => void;
  onSaved: (id: ID) => void;
  onDeleted: () => void;
  /** 点击死链时的「创建该条目」入口 */
  onQuickCreate: (title: string) => Promise<void>;
}

interface Draft {
  title: string;
  aliases: string;
  category: WorldCategory;
  importance: number;
  body: string;
  tags: string;
  parentId: string;
  rules: WorldRule[];
}

function toDraft(entry?: WorldEntry): Draft {
  return {
    title: entry?.title ?? "",
    aliases: (entry?.aliases ?? []).join("\n"),
    category: entry?.category ?? "geography",
    importance: entry?.importance ?? 3,
    body: entry?.body ?? "",
    tags: (entry?.tags ?? []).join("、"),
    parentId: entry?.parentId ?? "",
    rules: (entry?.rules ?? []).map((r) => ({ ...r })),
  };
}

function sameDraft(a: Draft, b: Draft): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** 右侧详情面板：条目字段编辑 + 硬规则增删改 + [[链接]] 预览 */
export function EntryEditor({
  projectId,
  entry,
  isNew,
  entries,
  titleIndex,
  incoming,
  outgoing,
  onSelect,
  onSaved,
  onDeleted,
  onQuickCreate,
}: Props) {
  const notify = useAppStore((s) => s.notify);
  const baseline = useMemo(() => toDraft(entry), [entry]);
  const [draft, setDraft] = useState<Draft>(baseline);
  const [saving, setSaving] = useState(false);
  const [bodyMode, setBodyMode] = useState<"edit" | "preview">("edit");
  const lastIdRef = useRef<ID | undefined>(entry?.id);
  const dirty = !sameDraft(draft, baseline);
  const dirtyRef = useRef(false);

  useEffect(() => {
    dirtyRef.current = dirty;
  });

  // 切换条目时重置草稿；同一条目被外部改动（AI 建档 / 其他标签页）时同步，但正在编辑就不覆盖
  useEffect(() => {
    const switched = lastIdRef.current !== entry?.id;
    lastIdRef.current = entry?.id;
    if (switched) {
      setDraft(baseline);
      setBodyMode("edit");
      return;
    }
    if (!dirtyRef.current) setDraft(baseline);
  }, [entry?.id, baseline]);

  const byId = useMemo(() => new Map(entries.map((e) => [e.id, e] as const)), [entries]);

  /** 可选父条目：排除自己与自己的后代，避免成环 */
  const parentOptions = useMemo(() => {
    if (!entry) return entries;
    const blocked = collectDescendantIds(entries, entry.id);
    blocked.add(entry.id);
    return entries.filter((e) => !blocked.has(e.id));
  }, [entries, entry]);

  const draftRefs = useMemo(() => resolveRefs(draft.body, titleIndex, entry?.id), [draft.body, titleIndex, entry?.id]);
  const incomingIds = (entry ? incoming.get(entry.id) : undefined) ?? [];
  const outgoingIds = (entry ? outgoing.get(entry.id) : undefined) ?? [];

  const parent = draft.parentId ? byId.get(draft.parentId) : undefined;
  const childCount = entry ? entries.filter((e) => e.parentId === entry.id).length : 0;
  const enabledRules = draft.rules.filter((r) => r.enabled && r.statement.trim()).length;

  function patch(next: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...next }));
  }

  function updateRule(index: number, next: Partial<WorldRule>) {
    setDraft((current) => ({
      ...current,
      rules: current.rules.map((rule, i) => (i === index ? { ...rule, ...next } : rule)),
    }));
  }

  function addRule() {
    setDraft((current) => ({
      ...current,
      rules: [...current.rules, { id: newId("wrule"), statement: "", severity: "warn", enabled: true }],
    }));
  }

  async function handleSave() {
    const title = draft.title.trim();
    if (!title) {
      notify("warning", "请先填写条目标题");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        title: title,
        aliases: parseLines(draft.aliases),
        category: draft.category,
        importance: draft.importance,
        body: draft.body,
        tags: parseTags(draft.tags),
        parentId: draft.parentId || undefined,
        rules: draft.rules
          .map((r) => ({ ...r, statement: r.statement.trim() }))
          .filter((r) => r.statement.length > 0),
        refs: resolveRefs(draft.body, titleIndex, entry?.id),
      };
      if (isNew || !entry) {
        const created = await createWorldEntry(projectId, payload);
        notify("success", "已创建条目", created.title);
        onSaved(created.id);
      } else {
        await updateWorldEntry(entry.id, payload);
        notify("success", "已保存", title);
        onSaved(entry.id);
      }
    } catch (e) {
      notify("danger", "保存失败", e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!entry) return;
    const tip =
      "删除《" + entry.title + "》？" +
      (childCount > 0 ? "它的 " + childCount + " 个子条目会被解除挂载（子条目本身保留）。" : "") +
      "正文中指向它的 [[链接]] 会失效。";
    if (!window.confirm(tip)) return;
    await deleteWorldEntry(entry.id);
    notify("success", "已删除条目", entry.title);
    onDeleted();
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs opacity-55">{isNew ? "新建条目" : "编辑条目"}</p>
            <h2 className="mt-0.5 truncate text-base font-semibold tracking-tight">
              {draft.title.trim() || (isNew ? "未命名条目" : entry?.title)}
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {dirty && (
              <Chip size="sm" color="warning">
                未保存
              </Chip>
            )}
            {entry && (
              <Tooltip>
                <Tooltip.Trigger>
                  <span className="text-[11px] opacity-50">{formatRelative(entry.updatedAt)}更新</span>
                </Tooltip.Trigger>
                <Tooltip.Content>创建于 {formatDateTime(entry.createdAt)}</Tooltip.Content>
              </Tooltip>
            )}
          </div>
        </div>

        <div className="mt-3 space-y-3">
          <div>
            <label className="mb-1 block text-xs opacity-55" htmlFor="world-title">
              标题
            </label>
            <input
              id="world-title"
              value={draft.title}
              onChange={(e) => patch({ title: e.target.value })}
              placeholder="例如：青云山、内力体系、玄门规矩"
              className={INPUT_CLASS + " text-base font-medium"}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs opacity-55" htmlFor="world-category">
                分类
              </label>
              <select
                id="world-category"
                value={draft.category}
                onChange={(e) => patch({ category: e.target.value as WorldCategory })}
                className={INPUT_CLASS}
              >
                {(Object.keys(WORLD_CATEGORY_LABELS) as WorldCategory[]).map((c) => (
                  <option key={c} value={c}>
                    {categoryLabel(c)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs opacity-55" htmlFor="world-parent">
                父条目
              </label>
              <select
                id="world-parent"
                value={draft.parentId}
                onChange={(e) => patch({ parentId: e.target.value })}
                className={INPUT_CLASS}
              >
                <option value="">（无，作为顶层条目）</option>
                {parentOptions.map((e) => (
                  <option key={e.id} value={e.id}>
                    {categoryLabel(e.category)} · {e.title}
                  </option>
                ))}
              </select>
              {parent && <p className="mt-1 truncate text-[11px] opacity-50">属于 {parent.title}</p>}
            </div>

            <div>
              <span className="mb-1 block text-xs opacity-55">重要度（越高越容易进入 AI 上下文）</span>
              <div className="flex items-center gap-2">
                <ImportanceStars value={draft.importance} onChange={(n) => patch({ importance: n })} size={16} />
                <span className="tabular text-xs opacity-55">{draft.importance} / 5</span>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs opacity-55" htmlFor="world-tags">
                标签（逗号或空格分隔）
              </label>
              <input
                id="world-tags"
                value={draft.tags}
                onChange={(e) => patch({ tags: e.target.value })}
                placeholder="例如：主线、第二卷、禁忌"
                className={INPUT_CLASS}
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs opacity-55" htmlFor="world-aliases">
              别名（一行一个，搜索与 [[链接]] 都能命中）
            </label>
            <textarea
              id="world-aliases"
              rows={2}
              value={draft.aliases}
              onChange={(e) => patch({ aliases: e.target.value })}
              placeholder={"青云门\n青峰"}
              className={INPUT_CLASS + " leading-relaxed"}
            />
          </div>
        </div>
      </Card>

      <Card className="p-4">
        <SectionTitle
          hint="用 [[条目标题]] 引用其他条目，预览里可直接跳转，死链可以一键建条目"
          action={
            <div className="flex items-center gap-1">
              <Button size="sm" variant={bodyMode === "edit" ? "secondary" : "ghost"} onPress={() => setBodyMode("edit")}>
                <Pencil className="size-3.5" />
                编辑
              </Button>
              <Button size="sm" variant={bodyMode === "preview" ? "secondary" : "ghost"} onPress={() => setBodyMode("preview")}>
                <Eye className="size-3.5" />
                预览
              </Button>
            </div>
          }
        >
          正文
        </SectionTitle>

        {bodyMode === "edit" ? (
          <textarea
            rows={14}
            value={draft.body}
            onChange={(e) => patch({ body: e.target.value })}
            placeholder={"这座山终年积雪，山门只对[[玄门]]弟子开放。\n\n山腹的[[寒潭]]是历代掌门的闭关之地。"}
            className={INPUT_CLASS + " font-serif leading-relaxed"}
            style={{ minHeight: 260 }}
          />
        ) : (
          <div className="rounded-xl border border-black/5 bg-white/50 p-3 dark:border-white/5 dark:bg-white/[0.03]">
            <WikiBody
              body={draft.body}
              index={titleIndex}
              onOpen={onSelect}
              onCreate={(target) => void onQuickCreate(target)}
            />
          </div>
        )}

        {draftRefs.length > 0 && (
          <p className="mt-2 text-[11px] opacity-50">
            本文引用了 {draftRefs.length} 个条目：
            {draftRefs.map((id) => byId.get(id)?.title ?? id).join("、")}
          </p>
        )}
      </Card>

      <Card className="p-4">
        <SectionTitle
          hint="这些规则会写进 AI 上下文，生成与检查时必须遵守"
          action={
            <Button size="sm" variant="ghost" onPress={addRule}>
              <Plus className="size-3.5" />
              添加规则
            </Button>
          }
        >
          硬规则 · {enabledRules} 条生效
        </SectionTitle>

        <div className="mb-3 flex items-start gap-2 rounded-xl bg-black/[0.05] px-3 py-2 text-[11px] leading-relaxed opacity-80">
          <Info className="mt-0.5 size-3.5 shrink-0 text-neutral-700" />
          <span>
            启用的规则会随该条目一起进入 AI 的【世界观设定】上下文（硬性规则标为「硬规则」），续写与一致性检查都会以此为准；
            停用的规则只保留在本地，不发给模型。
          </span>
        </div>

        {draft.rules.length === 0 ? (
          <p className="py-2 text-xs opacity-55">还没有规则。像「内力每十年涨一阶」这种不可违反的设定，写在这里最有用。</p>
        ) : (
          <div className="space-y-2">
            {draft.rules.map((rule, index) => (
              <div key={rule.id} className="rounded-xl border border-black/5 p-2.5 dark:border-white/5">
                <div className="flex items-center gap-2">
                  <select
                    value={rule.severity}
                    onChange={(e) => updateRule(index, { severity: e.target.value as WorldRule["severity"] })}
                    aria-label="规则强度"
                    className="rounded-lg border border-black/10 bg-white/70 px-2 py-1 text-xs outline-none dark:border-white/10 dark:bg-white/5"
                  >
                    <option value="error">硬性</option>
                    <option value="warn">建议</option>
                    <option value="info">参考</option>
                  </select>
                  <label className="flex items-center gap-1.5 text-xs opacity-70">
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      onChange={(e) => updateRule(index, { enabled: e.target.checked })}
                    />
                    启用
                  </label>
                  <span className="flex-1" />
                  <Button size="sm" variant="ghost" isIconOnly aria-label="删除该规则" onPress={() => setDraft((c) => ({ ...c, rules: c.rules.filter((_, i) => i !== index) }))}>
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
                <textarea
                  rows={2}
                  value={rule.statement}
                  onChange={(e) => updateRule(index, { statement: e.target.value })}
                  placeholder="规则陈述，例如：越级战斗必须付出寿元代价"
                  className={INPUT_CLASS + " mt-2 leading-relaxed"}
                />
              </div>
            ))}
          </div>
        )}
      </Card>

      {!isNew && entry && (
        <Card className="p-4">
          <SectionTitle hint="引用关系由正文里的 [[标题]] 实时解析">引用关系</SectionTitle>
          <div className="space-y-2 text-xs">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="opacity-55">被引用（{incomingIds.length}）</span>
              {incomingIds.length === 0 ? (
                <span className="opacity-40">还没有其他条目引用它</span>
              ) : (
                incomingIds.map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => onSelect(id)}
                    className="rounded bg-black/5 px-1.5 py-0.5 transition hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/15"
                  >
                    {byId.get(id)?.title ?? "已删除的条目"}
                  </button>
                ))
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="opacity-55">引用他人（{outgoingIds.length}）</span>
              {outgoingIds.length === 0 ? (
                <span className="inline-flex items-center gap-1 opacity-40">
                  <Link2 className="size-3" />
                  正文里还没有 [[链接]]
                </span>
              ) : (
                outgoingIds.map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => onSelect(id)}
                    className="rounded bg-black/5 px-1.5 py-0.5 transition hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/15"
                  >
                    {byId.get(id)?.title ?? "已删除的条目"}
                  </button>
                ))
              )}
            </div>
            {childCount > 0 && <p className="opacity-55">子条目 {childCount} 个 · 删除本条目会解除它们的挂载</p>}
          </div>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2 pb-2">
        <Button variant="primary" onPress={() => void handleSave()} isPending={saving} isDisabled={!isNew && !dirty}>
          <Save className="size-4" />
          {isNew ? "创建条目" : "保存"}
        </Button>
        <Button variant="ghost" isDisabled={!dirty} onPress={() => setDraft(baseline)}>
          <RotateCcw className="size-4" />
          撤销修改
        </Button>
        <span className="flex-1" />
        {!isNew && entry && (
          <Button variant="danger-soft" onPress={() => void handleDelete()}>
            <Trash2 className="size-4" />
            删除条目
          </Button>
        )}
      </div>
    </div>
  );
}
