import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Button, Card, Chip, Tabs } from "@heroui/react";
import { Filter, GitBranch, Plus, Search, Sparkles, X } from "lucide-react";
import type { PlotThread } from "@/core";
import { PageScaffold } from "@/components/common/PageScaffold";
import { EmptyHint, Loading, SectionTitle, StatCard } from "@/components/common/ui";
import { useAsync, useChapters, useCharacters, useDebounced, useThreads } from "@/app/hooks";
import { auditThreads, deleteThread, listThreads, updateThread } from "@/db/repo/story";
import { useAppStore } from "@/app/store";
import { ThreadAuditModal } from "./ThreadAuditModal";
import { ThreadCard } from "./ThreadCard";
import { ThreadFormModal } from "./ThreadFormModal";
import { ThreadHealthBoard } from "./ThreadHealthBoard";
import { ThreadHeatmap } from "./ThreadHeatmap";
import {
  OPEN_STATUSES,
  THREAD_KIND_LABELS,
  THREAD_KINDS,
  THREAD_PRIORITIES,
  THREAD_PRIORITY_LABELS,
  THREAD_STATUSES,
  THREAD_STATUS_LABELS,
  latestOrder,
  type ThreadProblem,
} from "./threadMeta";
import { DIVIDER_CLASS, FIELD_CLASS, LABEL_CLASS, SELECT_CLASS } from "./styles";

type View = "list" | "heatmap";
type GroupBy = "kind" | "status" | "none";

/** 伏笔支线页：列表 + 健康度看板 + 热力图 + AI 审计。 */
export function ThreadsPage() {
  const { projectId = "" } = useParams<{ projectId: string }>();
  const notify = useAppStore((s) => s.notify);

  const threads = useThreads(projectId);
  const chapters = useChapters(projectId);
  const characters = useCharacters(projectId);

  // 首次读库完成前显示加载态（liveQuery 首帧只返回空数组，无法区分「空」与「未加载」）
  const bootedRes = useAsync(async () => {
    /* eslint-disable @typescript-eslint/no-unused-vars */
    await listThreads(projectId);
    return true;
  }, [projectId], false);
  const booted = bootedRes.value;
  const problemsRes = useAsync(() => auditThreads(projectId), [projectId], [] as ThreadProblem[]);
  const problems = problemsRes.value;
  const reloadProblems = problemsRes.reload;

  const [view, setView] = useState<View>("list");
  const [groupBy, setGroupBy] = useState<GroupBy>("kind");
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounced(query, 250);
  const [kindFilter, setKindFilter] = useState<"all" | PlotThread["kind"]>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | PlotThread["status"]>("all");
  const [priorityFilter, setPriorityFilter] = useState<"all" | PlotThread["priority"]>("all");

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PlotThread | null>(null);
  const [auditOpen, setAuditOpen] = useState(false);
  const [highlightId, setHighlightId] = useState<string | undefined>(undefined);

  const filtersActive =
    debouncedQuery.trim() !== "" || kindFilter !== "all" || statusFilter !== "all" || priorityFilter !== "all";

  /** 过滤后的伏笔 */
  const filtered = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    return threads.filter((t) => {
      if (kindFilter !== "all" && t.kind !== kindFilter) return false;
      if (statusFilter !== "all" && t.status !== statusFilter) return false;
      if (priorityFilter !== "all" && t.priority !== priorityFilter) return false;
      if (!q) return true;
      const haystack = [t.title, t.description, t.notes, t.plantQuote, t.payoffQuote]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [threads, kindFilter, statusFilter, priorityFilter, debouncedQuery]);

  /** 分组结果 */
  const groups = useMemo(() => {
    if (groupBy === "none") return [{ key: "all", label: "全部伏笔", items: filtered }];
    if (groupBy === "kind") {
      return THREAD_KINDS.map((kind) => ({
        key: kind,
        label: THREAD_KIND_LABELS[kind],
        items: filtered.filter((t) => t.kind === kind),
      })).filter((g) => g.items.length > 0);
    }
    return THREAD_STATUSES.map((status) => ({
      key: status,
      label: THREAD_STATUS_LABELS[status],
      items: filtered.filter((t) => t.status === status),
    })).filter((g) => g.items.length > 0);
  }, [filtered, groupBy]);

  const stats = useMemo(() => {
    const open = threads.filter((t) => OPEN_STATUSES.includes(t.status));
    const resolved = threads.filter((t) => t.status === "resolved");
    const planted = threads.filter((t) => t.plantedChapterId);
    return { open: open.length, resolved: resolved.length, planted: planted.length };
  }, [threads]);

  const flash = (id: string) => {
    setHighlightId(id);
    window.setTimeout(() => setHighlightId((cur) => (cur === id ? undefined : cur)), 2600);
  };

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (thread: PlotThread) => {
    setEditing(thread);
    setFormOpen(true);
  };

  /** 快速回收：把实际回收章设为当前最新章 */
  const quickPayoff = async (thread: PlotThread) => {
    const latest = [...chapters].sort((a, b) => b.order - a.order)[0];
    if (!latest) {
      notify("warning", "还没有章节", "先在大纲里建立章节，再标记回收");
      return;
    }
    try {
      await updateThread(thread.id, { payoffChapterId: latest.id, status: "resolved" });
      flash(thread.id);
      reloadProblems();
      notify("success", "已标记回收", "「" + thread.title + "」回收于第" + (latest.order + 1) + "章");
    } catch (e) {
      notify("danger", "标记失败", e instanceof Error ? e.message : String(e));
    }
  };

  const remove = async (thread: PlotThread) => {
    if (!window.confirm("删除伏笔「" + thread.title + "」？此操作不可撤销。")) return;
    try {
      await deleteThread(thread.id);
      reloadProblems();
      notify("success", "伏笔已删除", thread.title);
    } catch (e) {
      notify("danger", "删除失败", e instanceof Error ? e.message : String(e));
    }
  };

  const resetFilters = () => {
    setQuery("");
    setKindFilter("all");
    setStatusFilter("all");
    setPriorityFilter("all");
  };

  const body = () => {
    if (!booted) return <Loading label="正在读取伏笔…" />;

    if (threads.length === 0) {
      return (
        <EmptyHint
          icon={<GitBranch className="size-8" />}
          title="还没有伏笔或支线"
          description="伏笔是长篇小说的记忆点：先埋下，再回收。建立第一条伏笔，系统会自动帮你盯着它有没有超期、有没有被读者忘掉。"
          action={
            <Button variant="primary" onPress={openCreate}>
              <Plus className="size-4" />
              新建伏笔
            </Button>
          }
        />
      );
    }

    return (
      <div className="space-y-5">
        <ThreadHealthBoard problems={problems} onOpenThread={openEdit} />

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="伏笔总数"
            value={threads.length}
            hint="含支线、谜题、主题等全部线索"
            tone="accent"
            icon={<GitBranch className="size-4" />}
          />
          <StatCard label="待回收" value={stats.open} tone={stats.open > 0 ? "warning" : "success"} hint="尚未标记实际回收章" />
          <StatCard label="已回收" value={stats.resolved} tone="success" hint="已经兑现的伏笔" />
          <StatCard
            label="已埋设"
            value={stats.planted}
            hint={"当前写到第 " + (latestOrder(chapters) + 1) + " 章"}
            tone={problems.length > 0 ? "danger" : "default"}
          />
        </div>

        <Tabs selectedKey={view} onSelectionChange={(key) => setView(key === "heatmap" ? "heatmap" : "list")}>
          <Tabs.List>
            <Tabs.Tab id="list">列表</Tabs.Tab>
            <Tabs.Tab id="heatmap">伏笔热力图</Tabs.Tab>
            <Tabs.Indicator />
          </Tabs.List>

          <Tabs.Panel id="list">
            <div className="space-y-4 pt-3">
              <Card className="p-3">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="min-w-[200px] flex-1">
                    <label className={LABEL_CLASS}>搜索</label>
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 opacity-40" />
                      <input
                        className={FIELD_CLASS + " pl-8"}
                        value={query}
                        placeholder="标题、描述、原文片段、备注"
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
                    <label className={LABEL_CLASS}>类型</label>
                    <select
                      className={SELECT_CLASS}
                      value={kindFilter}
                      onChange={(e) => setKindFilter(e.target.value as "all" | PlotThread["kind"])}
                    >
                      <option value="all">全部类型</option>
                      {THREAD_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {THREAD_KIND_LABELS[k]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="w-[130px]">
                    <label className={LABEL_CLASS}>状态</label>
                    <select
                      className={SELECT_CLASS}
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value as "all" | PlotThread["status"])}
                    >
                      <option value="all">全部状态</option>
                      {THREAD_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {THREAD_STATUS_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="w-[120px]">
                    <label className={LABEL_CLASS}>优先级</label>
                    <select
                      className={SELECT_CLASS}
                      value={priorityFilter}
                      onChange={(e) => setPriorityFilter(e.target.value as "all" | PlotThread["priority"])}
                    >
                      <option value="all">全部</option>
                      {THREAD_PRIORITIES.map((p) => (
                        <option key={p} value={p}>
                          {THREAD_PRIORITY_LABELS[p]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="w-[130px]">
                    <label className={LABEL_CLASS}>分组</label>
                    <select className={SELECT_CLASS} value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
                      <option value="kind">按类型</option>
                      <option value="status">按状态</option>
                      <option value="none">不分组</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-2 pb-1">
                    <span className="tabular text-xs opacity-55">
                      {filtered.length} / {threads.length}
                    </span>
                    {filtersActive && (
                      <Button size="sm" variant="ghost" onPress={resetFilters}>
                        <Filter className="size-3.5" />
                        清空筛选
                      </Button>
                    )}
                  </div>
                </div>
              </Card>

              {filtered.length === 0 ? (
                <EmptyHint
                  title="没有符合条件的伏笔"
                  description="换一个关键词，或者清空筛选条件。"
                  action={
                    <Button variant="outline" onPress={resetFilters}>
                      清空筛选
                    </Button>
                  }
                />
              ) : (
                <div className="space-y-6">
                  {groups.map((group) => (
                    <section key={group.key}>
                      <SectionTitle hint={group.items.length + " 条"}>{group.label}</SectionTitle>
                      <div className="grid gap-3 xl:grid-cols-2">
                        {group.items.map((thread) => (
                          <ThreadCard
                            key={thread.id}
                            thread={thread}
                            chapters={chapters}
                            highlighted={highlightId === thread.id}
                            onEdit={openEdit}
                            onDelete={remove}
                            onQuickPayoff={quickPayoff}
                          />
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </div>
          </Tabs.Panel>

          <Tabs.Panel id="heatmap">
            <div className="pt-3">
              <ThreadHeatmap threads={filtered} chapters={chapters} onEditThread={openEdit} />
            </div>
          </Tabs.Panel>
        </Tabs>

        <UnresolvedHint threads={threads} problems={problems} />
      </div>
    );
  };

  return (
    <PageScaffold
      title="伏笔支线"
      description={
        booted ? threads.length + " 条伏笔 · " + stats.open + " 条待回收 · " + problems.length + " 条风险" : "正在读取…"
      }
      actions={
        <>
          <Button variant="outline" isDisabled={threads.length === 0} onPress={() => setAuditOpen(true)}>
            <Sparkles className="size-4" />
            AI 伏笔审计
          </Button>
          <Button variant="primary" onPress={openCreate}>
            <Plus className="size-4" />
            新建伏笔
          </Button>
        </>
      }
    >
      {body()}

      <ThreadFormModal
        projectId={projectId}
        open={formOpen}
        onOpenChange={setFormOpen}
        thread={editing}
        chapters={chapters}
        characters={characters}
        onSaved={() => {
          reloadProblems();
          if (editing) flash(editing.id);
        }}
      />

      <ThreadAuditModal projectId={projectId} open={auditOpen} onOpenChange={setAuditOpen} />
    </PageScaffold>
  );
}

/** 底部小结：已埋设但未回收的伏笔数量 */
function UnresolvedHint({ threads, problems }: { threads: PlotThread[]; problems: ThreadProblem[] }) {
  const planted = threads.filter((t) => t.plantedChapterId && t.status !== "resolved" && t.status !== "abandoned");
  if (planted.length === 0) return null;
  const overdue = problems.filter((p) => p.problem === "overdue").length;
  return (
    <Card className="flex flex-wrap items-center gap-2 p-3 text-xs">
      <Chip size="sm" color={overdue > 0 ? "danger" : "accent"}>
        {planted.length} 条已埋设未回收
      </Chip>
      <span className="opacity-60">
        {overdue > 0
          ? "其中 " + overdue + " 条已经写过了计划回收章，建议尽快回收或调整计划。"
          : "回收节奏正常，继续按计划推进即可。"}
      </span>
    </Card>
  );
}
