import { useMemo } from "react";
import { Button, Card, Tooltip } from "@heroui/react";
import { Link2, ListTree, Plus, Search, X } from "lucide-react";
import type { ID, WorldCategory, WorldEntry } from "@/core";
import { WORLD_CATEGORY_LABELS } from "@/db/defaults";
import { EmptyHint, SectionTitle } from "@/components/common/ui";
import { CategoryChip, ImportanceStars } from "./bits";
import { categoryLabel } from "./world-labels";
import { buildEntryTree, entryBreadcrumb, matchesQuery, summarizeBody, type EntryNode } from "./world-links";

interface Props {
  entries: WorldEntry[];
  selectedId?: ID;
  category: WorldCategory | "all";
  onCategory: (category: WorldCategory | "all") => void;
  /** 输入框里的原始值（立即回显） */
  rawQuery: string;
  /** 防抖后的值（真正用于过滤） */
  filterQuery: string;
  onQuery: (query: string) => void;
  treeMode: boolean;
  onTreeMode: (on: boolean) => void;
  incoming: Map<ID, ID[]>;
  onCreate: () => void;
  onSelect: (id: ID) => void;
}

/** 左侧栏：搜索 + 分类导航 + 条目列表（列表 / 树形两种展示） */
export function EntryList({
  entries,
  selectedId,
  category,
  onCategory,
  rawQuery,
  filterQuery,
  onQuery,
  treeMode,
  onTreeMode,
  incoming,
  onCreate,
  onSelect,
}: Props) {
  const byId = useMemo(() => new Map(entries.map((e) => [e.id, e] as const)), [entries]);

  /** 各分类的条目数（不受搜索影响，方便一眼看出设定分布） */
  const categories = useMemo(() => {
    const counts = new Map<WorldCategory, number>();
    for (const entry of entries) counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1);
    const order = Object.keys(WORLD_CATEGORY_LABELS) as WorldCategory[];
    return order
      .filter((c) => (counts.get(c) ?? 0) > 0)
      .map((c) => ({ key: c, label: categoryLabel(c), count: counts.get(c) ?? 0 }))
      .sort((a, b) => b.count - a.count);
  }, [entries]);

  const filtered = useMemo(
    () => entries.filter((e) => (category === "all" || e.category === category) && matchesQuery(e, filterQuery)),
    [entries, category, filterQuery],
  );

  const flatRows = useMemo(() => flatten(buildEntryTree(filtered)), [filtered]);

  const searching = filterQuery.trim().length > 0;

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 opacity-40" />
        <input
          value={rawQuery}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="搜索标题 / 别名 / 正文…"
          aria-label="搜索世界观条目"
          className="w-full rounded-lg border border-black/10 bg-white/70 py-2 pl-8 pr-8 text-sm outline-none transition placeholder:opacity-40 focus:border-violet-500/60 dark:border-white/10 dark:bg-white/5"
        />
        {searching && (
          <button
            type="button"
            aria-label="清空搜索"
            onClick={() => onQuery("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 opacity-50 transition hover:opacity-100"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      <Card className="p-3">
        <SectionTitle hint={entries.length + " 个条目，分 " + categories.length + " 类"}>分类</SectionTitle>
        {categories.length === 0 ? (
          <p className="py-2 text-xs opacity-55">还没有条目，先新建一个。</p>
        ) : (
          <ul className="space-y-0.5">
            <li>
              <button
                type="button"
                onClick={() => onCategory("all")}
                className={
                  "flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm transition " +
                  (category === "all" ? "bg-violet-500/10 font-medium text-violet-600 dark:text-violet-300" : "opacity-75 hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/5")
                }
              >
                <span className="truncate">全部</span>
                <span className="tabular text-xs opacity-55">{entries.length}</span>
              </button>
            </li>
            {categories.map((c) => (
              <li key={c.key}>
                <button
                  type="button"
                  onClick={() => onCategory(c.key)}
                  className={
                    "flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm transition " +
                    (category === c.key ? "bg-violet-500/10 font-medium text-violet-600 dark:text-violet-300" : "opacity-75 hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/5")
                  }
                >
                  <span className="truncate">{c.label}</span>
                  <span className="tabular text-xs opacity-55">{c.count}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="flex items-center justify-between gap-2">
        <p className="text-xs opacity-55">
          {searching || category !== "all" ? filtered.length + " / " + entries.length + " 条" : entries.length + " 条"}
        </p>
        <div className="flex items-center gap-1">
          <Tooltip>
            <Tooltip.Trigger>
              <Button
                size="sm"
                variant={treeMode ? "secondary" : "ghost"}
                isIconOnly
                aria-label="按层级树展示"
                onPress={() => onTreeMode(!treeMode)}
              >
                <ListTree className="size-4" />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content>{treeMode ? "切换为平铺列表" : "按父子层级树展示"}</Tooltip.Content>
          </Tooltip>
          <Button size="sm" variant="ghost" onPress={onCreate}>
            <Plus className="size-4" />
            新建
          </Button>
        </div>
      </div>

      {entries.length === 0 ? (
        <EmptyHint
          title="还没有世界观条目"
          description="从地理、力量体系、组织开始搭建你的世界。条目之间可以用 [[标题]] 互相引用。"
          action={
            <Button size="sm" variant="primary" onPress={onCreate}>
              <Plus className="size-4" />
              新建第一个条目
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyHint title="没有匹配的条目" description="换个关键词，或把分类切回「全部」。" />
      ) : (
        <ul className="space-y-1.5">
          {flatRows.map((row) => (
            <li key={row.entry.id}>
              <EntryRow
                entry={row.entry}
                depth={treeMode ? row.depth : 0}
                breadcrumb={entryBreadcrumb(row.entry, byId)}
                showParent={!treeMode}
                refCount={(incoming.get(row.entry.id) ?? []).length}
                selected={row.entry.id === selectedId}
                onSelect={onSelect}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EntryRow({
  entry,
  depth,
  breadcrumb,
  showParent,
  refCount,
  selected,
  onSelect,
}: {
  entry: WorldEntry;
  depth: number;
  breadcrumb: WorldEntry[];
  /** 树形模式下靠缩进表达层级，就不再重复「属于 XXX」 */
  showParent: boolean;
  refCount: number;
  selected: boolean;
  onSelect: (id: ID) => void;
}) {
  const excerpt = summarizeBody(entry.body, 78);
  const aliases = entry.aliases.slice(0, 2);

  return (
    <button
      type="button"
      onClick={() => onSelect(entry.id)}
      style={{ marginLeft: depth * 14 }}
      className={
        "w-full rounded-xl border px-3 py-2.5 text-left transition " +
        (selected
          ? "border-violet-500/40 bg-violet-500/10"
          : "border-black/5 bg-white/60 hover:border-black/10 hover:bg-white dark:border-white/5 dark:bg-white/[0.03] dark:hover:bg-white/[0.06]")
      }
    >
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{entry.title}</span>
        <ImportanceStars value={entry.importance} size={11} />
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        <CategoryChip category={entry.category} />
        {aliases.map((a) => (
          <span key={a} className="rounded bg-black/5 px-1 text-[11px] opacity-70 dark:bg-white/10">
            {a}
          </span>
        ))}
        {entry.aliases.length > aliases.length && <span className="text-[11px] opacity-45">+{entry.aliases.length - aliases.length}</span>}
        {refCount > 0 && (
          <span className="inline-flex items-center gap-0.5 text-[11px] opacity-60">
            <Link2 className="size-3" />
            {refCount}
          </span>
        )}
      </div>

      {showParent && breadcrumb.length > 0 && (
        <p className="mt-1 truncate text-[11px] opacity-50">属于 {breadcrumb.map((e) => e.title).join(" / ")}</p>
      )}

      {excerpt ? <p className="mt-1 line-clamp-2 text-xs leading-relaxed opacity-60">{excerpt}</p> : <p className="mt-1 text-xs opacity-40">（正文为空）</p>}
    </button>
  );
}

/** 树 → 线性序列（带层级），父节点在前，渲染时只做缩进 */
function flatten(nodes: EntryNode[]): EntryNode[] {
  const out: EntryNode[] = [];
  const walk = (list: EntryNode[]) => {
    for (const node of list) {
      out.push(node);
      walk(node.children);
    }
  };
  walk(nodes);
  return out;
}
