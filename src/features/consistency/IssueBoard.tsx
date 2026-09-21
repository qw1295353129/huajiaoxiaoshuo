import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Card, Chip } from "@heroui/react";
import {
  AlertOctagon, ArrowUpRight, Check, Copy, EyeOff, Search, ShieldAlert, Sparkles, Wand2, X,
} from "lucide-react";
import type { Chapter, ID, Issue, IssueKind, IssueSeverity } from "@/core";
import { updateIssue } from "@/db/repo/story";
import { useDebounced } from "@/app/hooks";
import { EmptyHint, SectionTitle, SeverityChip, StatCard, Tag } from "@/components/common/ui";
import { formatRelative } from "@/utils/format";
import { useAppStore } from "@/app/store";
import {
  KIND_LABELS, SEVERITY_ORDER, SEVERITY_TITLES, SOURCE_LABELS, STATUS_COLORS, STATUS_LABELS,
  copyText, fmtInt, fmtPct, writeUrlWithQuote,
} from "./helpers";

export interface IssueFilters {
  query: string;
  kind: IssueKind | "all";
  severity: IssueSeverity | "all";
  status: Issue["status"] | "all";
  chapterId: ID | "all";
}

export const DEFAULT_FILTERS: IssueFilters = { query: "", kind: "all", severity: "all", status: "open", chapterId: "all" };

const PAGE_SIZE = 8;

/** 问题看板：统计 + 筛选 + 分组列表 + 详情处理 */
export function IssueBoard({
  projectId,
  issues,
  chapters,
  filters,
  onFiltersChange,
}: {
  projectId: ID;
  issues: Issue[];
  chapters: Chapter[];
  filters: IssueFilters;
  onFiltersChange: (next: IssueFilters) => void;
}) {
  const navigate = useNavigate();
  const notify = useAppStore((s) => s.notify);
  const q = useDebounced(filters.query, 250);
  const [selectedId, setSelectedId] = useState<ID | null>(null);
  const [limit, setLimit] = useState<Record<string, number>>({});

  const chapterMap = useMemo(() => new Map(chapters.map((c) => [c.id, c])), [chapters]);

  const stats = useMemo(() => {
    const open = issues.filter((i) => i.status === "open");
    const byKind = new Map<IssueKind, number>();
    for (const i of open) byKind.set(i.kind, (byKind.get(i.kind) ?? 0) + 1);
    const kindRows = Array.from(byKind, ([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count);
    return {
      total: issues.length,
      open: open.length,
      blocker: open.filter((i) => i.severity === "blocker").length,
      error: open.filter((i) => i.severity === "error").length,
      fixed: issues.filter((i) => i.status === "fixed").length,
      dismissed: issues.filter((i) => i.status === "ignored" || i.status === "false-positive").length,
      kindRows,
      kindMax: kindRows.length ? kindRows[0].count : 1,
    };
  }, [issues]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return issues.filter((i) => {
      if (filters.kind !== "all" && i.kind !== filters.kind) return false;
      if (filters.severity !== "all" && i.severity !== filters.severity) return false;
      if (filters.status !== "all" && i.status !== filters.status) return false;
      if (filters.chapterId !== "all" && i.chapterId !== filters.chapterId) return false;
      if (!needle) return true;
      const hay = [
        i.title, i.detail, i.suggestion, i.fixPrompt,
        i.evidence?.quote, i.conflictsWith?.label, i.conflictsWith?.quote, KIND_LABELS[i.kind],
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [issues, filters, q]);

  const groups = useMemo(
    () => SEVERITY_ORDER.map((severity) => ({ severity, items: filtered.filter((i) => i.severity === severity) })).filter((g) => g.items.length > 0),
    [filtered],
  );

  // 选中项：默认第一条，选中项被筛掉后自动换一条
  useEffect(() => {
    if (!filtered.length) {
      if (selectedId) setSelectedId(null);
      return;
    }
    if (!selectedId || !filtered.some((i) => i.id === selectedId)) setSelectedId(filtered[0].id);
  }, [filtered, selectedId]);

  const selected = useMemo(() => issues.find((i) => i.id === selectedId), [issues, selectedId]);

  const setStatus = async (issue: Issue, status: Issue["status"]) => {
    try {
      await updateIssue(issue.id, { status });
      notify("success", "状态已更新", "「" + issue.title + "」→ " + STATUS_LABELS[status]);
    } catch (e) {
      notify("danger", "更新失败", e instanceof Error ? e.message : String(e));
    }
  };

  const openChapter = (chapterId?: ID, from?: number, to?: number, quote?: string) => {
    if (!chapterId) return;
    navigate(writeUrlWithQuote(projectId, chapterId, from, to, quote));
  };

  const rewrite = (issue: Issue) => {
    const prompt = issue.fixPrompt || issue.suggestion || issue.title;
    void copyText(prompt).then((ok) => {
      notify(
        ok ? "success" : "warning",
        ok ? "改写指令已复制" : "复制失败，请手动复制",
        ok ? "已带上 fix 参数跳转写作页；当前写作页仍是占位页，可先手动粘贴指令。" : undefined,
      );
    });
    if (issue.chapterId) {
      const url = writeUrlWithQuote(projectId, issue.chapterId, issue.evidence?.from, issue.evidence?.to, issue.evidence?.quote) + "&fix=" + encodeURIComponent(prompt);
      navigate(url);
    }
  };

  const reset = () => onFiltersChange({ ...DEFAULT_FILTERS });

  return (
    <div className="space-y-5">
      {/* 顶部统计 */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="待处理问题"
          value={fmtInt(stats.open)}
          hint={"共 " + fmtInt(stats.total) + " 条记录"}
          icon={<ShieldAlert className="size-4" />}
          tone={stats.open ? "warning" : "success"}
        />
        <StatCard
          label="阻断级"
          value={fmtInt(stats.blocker)}
          hint={stats.error ? "另有 " + stats.error + " 条严重问题" : "没有其它严重问题"}
          icon={<AlertOctagon className="size-4" />}
          tone={stats.blocker ? "danger" : "success"}
        />
        <StatCard label="已修复" value={fmtInt(stats.fixed)} hint={"忽略/误报 " + fmtInt(stats.dismissed)} icon={<Check className="size-4" />} tone="success" />
        <Card className="p-4">
          <p className="text-xs opacity-55">按类型分布（待处理）</p>
          {stats.kindRows.length === 0 ? (
            <p className="mt-3 text-xs opacity-45">暂无待处理问题</p>
          ) : (
            <div className="mt-2.5 space-y-1.5">
              {stats.kindRows.slice(0, 4).map((r) => (
                <button
                  key={r.kind}
                  type="button"
                  className="flex w-full items-center gap-2 text-left"
                  onClick={() => onFiltersChange({ ...filters, kind: r.kind, status: "open" })}
                >
                  <span className="w-16 shrink-0 truncate text-[11px] opacity-60">{KIND_LABELS[r.kind]}</span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/[0.07] dark:bg-white/10">
                    <span className="block h-full rounded-full bg-violet-500" style={{ width: fmtPct(r.count / stats.kindMax) }} />
                  </span>
                  <span className="tabular w-6 shrink-0 text-right text-[11px] opacity-60">{r.count}</span>
                </button>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* 筛选 */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-52 flex-1">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 opacity-40" />
            <input
              value={filters.query}
              onChange={(e) => onFiltersChange({ ...filters, query: e.target.value })}
              placeholder="搜索标题、详情、原文或建议…"
              className="w-full rounded-lg border border-black/10 bg-white py-1.5 pl-8 pr-2.5 text-xs outline-none transition focus:border-violet-400 dark:border-white/10 dark:bg-neutral-900"
            />
          </div>

          <select
            value={filters.kind}
            onChange={(e) => onFiltersChange({ ...filters, kind: e.target.value as IssueFilters["kind"] })}
            className="rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-xs dark:border-white/10 dark:bg-neutral-900"
          >
            <option value="all">全部类型</option>
            {(Object.keys(KIND_LABELS) as IssueKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>

          <select
            value={filters.severity}
            onChange={(e) => onFiltersChange({ ...filters, severity: e.target.value as IssueFilters["severity"] })}
            className="rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-xs dark:border-white/10 dark:bg-neutral-900"
          >
            <option value="all">全部严重度</option>
            {SEVERITY_ORDER.map((s) => (
              <option key={s} value={s}>
                {SEVERITY_TITLES[s].split("（")[0]}
              </option>
            ))}
          </select>

          <select
            value={filters.status}
            onChange={(e) => onFiltersChange({ ...filters, status: e.target.value as IssueFilters["status"] })}
            className="rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-xs dark:border-white/10 dark:bg-neutral-900"
          >
            <option value="all">全部状态</option>
            <option value="open">待处理</option>
            <option value="fixed">已修复</option>
            <option value="ignored">已忽略</option>
            <option value="false-positive">误报</option>
          </select>

          <select
            value={filters.chapterId}
            onChange={(e) => onFiltersChange({ ...filters, chapterId: e.target.value })}
            className="max-w-44 rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-xs dark:border-white/10 dark:bg-neutral-900"
          >
            <option value="all">全部章节</option>
            {chapters
              .slice()
              .sort((a, b) => a.order - b.order)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  第{c.order + 1}章 {c.title}
                </option>
              ))}
          </select>

          <Button variant="ghost" size="sm" onPress={reset}>
            <X className="size-3.5" />
            重置
          </Button>
          <span className="text-[11px] opacity-45">
            命中 {filtered.length} / {issues.length} 条
          </span>
        </div>
      </Card>

      {issues.length === 0 ? (
        <EmptyHint
          icon={<Sparkles className="size-7" />}
          title="还没有任何检查记录"
          description="切到「运行检查」标签，先对一章运行一致性检查，或做一次整本检查，问题会自动汇总到这里。"
        />
      ) : filtered.length === 0 ? (
        <EmptyHint
          title="当前筛选条件下没有问题"
          description="试试把状态切到「全部状态」，或点上面的重置按钮。"
          action={
            <Button variant="outline" size="sm" onPress={reset}>
              重置筛选
            </Button>
          }
        />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(300px,400px)_1fr]">
          {/* 列表 */}
          <div className="min-w-0 space-y-4">
            {groups.map((g) => {
              const shown = limit[g.severity] ?? PAGE_SIZE;
              return (
                <div key={g.severity}>
                  <div className="mb-2 flex items-center gap-2">
                    <SeverityChip severity={g.severity} />
                    <span className="text-[11px] opacity-50">{g.items.length} 条</span>
                  </div>
                  <ul className="space-y-1.5">
                    {g.items.slice(0, shown).map((i) => (
                      <li key={i.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedId(i.id)}
                          className={
                            "w-full rounded-xl border px-3 py-2 text-left transition " +
                            (selectedId === i.id
                              ? "border-violet-400/60 bg-violet-500/[0.06]"
                              : "border-black/5 hover:bg-black/[0.03] dark:border-white/5 dark:hover:bg-white/[0.04]")
                          }
                        >
                          <p className="line-clamp-2 text-xs font-medium leading-relaxed">{i.title}</p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] opacity-55">
                            <span>{KIND_LABELS[i.kind]}</span>
                            <span>·</span>
                            <span className="truncate">
                              {i.chapterId ? "第" + ((chapterMap.get(i.chapterId)?.order ?? 0) + 1) + "章 " + (chapterMap.get(i.chapterId)?.title ?? "未知章节") : "全书"}
                            </span>
                            <span>·</span>
                            <span>{formatRelative(i.createdAt)}</span>
                          </div>
                          {i.status !== "open" && (
                            <div className="mt-1.5">
                              <Chip size="sm" color={STATUS_COLORS[i.status]}>
                                {STATUS_LABELS[i.status]}
                              </Chip>
                            </div>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                  {g.items.length > shown && (
                    <Button
                      className="mt-2"
                      variant="ghost"
                      size="sm"
                      fullWidth
                      onPress={() => setLimit((prev) => ({ ...prev, [g.severity]: shown + PAGE_SIZE * 2 }))}
                    >
                      显示更多（还有 {g.items.length - shown} 条）
                    </Button>
                  )}
                </div>
              );
            })}
          </div>

          {/* 详情 */}
          <div className="min-w-0">
            {!selected ? (
              <EmptyHint title="选择左侧的一条问题" description="这里会显示完整的证据、冲突对象、修改建议与一键改写入口。" />
            ) : (
              <Card className="p-4 lg:sticky lg:top-0">
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityChip severity={selected.severity} />
                  <Tag color="accent">{KIND_LABELS[selected.kind]}</Tag>
                  <Chip size="sm" color={STATUS_COLORS[selected.status]}>
                    {STATUS_LABELS[selected.status]}
                  </Chip>
                  <span className="text-[11px] opacity-45">
                    {SOURCE_LABELS[selected.source]}
                    {selected.detector ? " · " + selected.detector : ""} · {formatRelative(selected.createdAt)}
                  </span>
                </div>

                <h3 className="mt-3 text-sm font-semibold leading-relaxed">{selected.title}</h3>

                <div className="mt-2 flex items-center gap-2 text-xs opacity-60">
                  {selected.chapterId ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-violet-500 hover:underline"
                      onClick={() => openChapter(selected.chapterId, selected.evidence?.from, selected.evidence?.to, selected.evidence?.quote)}
                    >
                      第{(chapterMap.get(selected.chapterId)?.order ?? 0) + 1}章 {chapterMap.get(selected.chapterId)?.title ?? "未知章节"}
                      <ArrowUpRight className="size-3" />
                    </button>
                  ) : (
                    <span>全书级问题</span>
                  )}
                </div>

                {selected.detail && <p className="mt-3 text-xs leading-relaxed opacity-75">{selected.detail}</p>}

                {selected.evidence?.quote && (
                  <div className="mt-3">
                    <SectionTitle hint="点击引用可跳转到写作页对应位置">原文证据</SectionTitle>
                    <button
                      type="button"
                      onClick={() => openChapter(selected.chapterId, selected.evidence?.from, selected.evidence?.to, selected.evidence?.quote)}
                      className="w-full rounded-xl border-l-2 border-amber-400 bg-amber-500/[0.07] px-3 py-2 text-left text-xs leading-relaxed transition hover:bg-amber-500/[0.12]"
                    >
                      「{selected.evidence.quote}」
                      {selected.evidence.from !== undefined && (
                        <span className="tabular mt-1 block text-[10px] opacity-45">偏移 {selected.evidence.from}~{selected.evidence.to ?? ""}</span>
                      )}
                    </button>
                  </div>
                )}

                {(selected.conflictsWith?.label || selected.conflictsWith?.quote) && (
                  <div className="mt-3">
                    <SectionTitle>冲突对象</SectionTitle>
                    <div className="rounded-xl border border-black/5 px-3 py-2 text-xs dark:border-white/5">
                      {selected.conflictsWith?.label && <p className="font-medium">{selected.conflictsWith.label}</p>}
                      {selected.conflictsWith?.quote && <p className="mt-1 leading-relaxed opacity-60">「{selected.conflictsWith.quote}」</p>}
                      {selected.conflictsWith?.chapterId && (
                        <Button className="mt-2" variant="ghost" size="sm" onPress={() => openChapter(selected.conflictsWith?.chapterId)}>
                          打开冲突章节
                        </Button>
                      )}
                    </div>
                  </div>
                )}

                {selected.suggestion && (
                  <div className="mt-3">
                    <SectionTitle>修改建议</SectionTitle>
                    <p className="rounded-xl bg-emerald-500/[0.07] px-3 py-2 text-xs leading-relaxed">{selected.suggestion}</p>
                  </div>
                )}

                {selected.fixPrompt && (
                  <div className="mt-3">
                    <SectionTitle
                      hint="可直接粘贴到写作台或 AI 面板"
                      action={
                        <Button
                          variant="ghost"
                          size="sm"
                          onPress={() => {
                            void copyText(selected.fixPrompt ?? "").then((ok) => notify(ok ? "success" : "danger", ok ? "已复制改写指令" : "复制失败"));
                          }}
                        >
                          <Copy className="size-3.5" />
                          复制
                        </Button>
                      }
                    >
                      改写指令
                    </SectionTitle>
                    <p className="rounded-xl bg-black/[0.03] px-3 py-2 text-xs leading-relaxed dark:bg-white/[0.04]">{selected.fixPrompt}</p>
                  </div>
                )}

                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-black/5 pt-3 dark:border-white/5">
                  <Button variant="primary" size="sm" onPress={() => void setStatus(selected, "fixed")} isDisabled={selected.status === "fixed"}>
                    <Check className="size-4" />
                    已修复
                  </Button>
                  <Button variant="outline" size="sm" onPress={() => void setStatus(selected, "ignored")} isDisabled={selected.status === "ignored"}>
                    <EyeOff className="size-4" />
                    忽略
                  </Button>
                  <Button variant="ghost" size="sm" onPress={() => void setStatus(selected, "false-positive")} isDisabled={selected.status === "false-positive"}>
                    误报
                  </Button>
                  {selected.status !== "open" && (
                    <Button variant="ghost" size="sm" onPress={() => void setStatus(selected, "open")}>
                      重新打开
                    </Button>
                  )}
                  <Button className="ml-auto" variant="outline" size="sm" onPress={() => rewrite(selected)}>
                    <Wand2 className="size-4" />
                    用 AI 改写此段
                  </Button>
                </div>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
