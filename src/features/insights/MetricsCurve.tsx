import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Card } from "@heroui/react";
import { Calculator, LineChart as LineChartIcon } from "lucide-react";
import type { Chapter, ID } from "@/core";
import { useMetrics } from "@/app/hooks";
import { ROUTES } from "@/app/routes";
import { recomputeMetrics } from "@/ai/analysis";
import { EmptyHint, Progress, SectionTitle, StatCard } from "@/components/common/ui";
import { useAppStore } from "@/app/store";
import { fmtInt, fmt1, fmtPct } from "./helpers";
import { MultiLineChart, SERIES_COLORS, type LineSeries } from "./charts";

interface SeriesDef {
  key: string;
  label: string;
  color: string;
  format: (v: number) => string;
  pick: (m: { wordCount: number; dialogueRatio: number; avgSentenceLength: number; tension: number }) => number;
}

const SERIES_DEFS: SeriesDef[] = [
  { key: "wordCount", label: "字数/章", color: SERIES_COLORS.violet, format: (v) => fmtInt(v) + " 字", pick: (m) => m.wordCount },
  // 注意：series 里的值已经是百分数（0~100），格式化时不要再乘 100
  { key: "dialogueRatio", label: "对话占比", color: SERIES_COLORS.emerald, format: (v) => fmt1(v) + "%", pick: (m) => m.dialogueRatio * 100 },
  { key: "avgSentenceLength", label: "平均句长", color: SERIES_COLORS.amber, format: (v) => fmt1(v) + " 字", pick: (m) => m.avgSentenceLength },
  { key: "tension", label: "张力", color: SERIES_COLORS.rose, format: (v) => fmt1(v), pick: (m) => m.tension },
];

/** 章节指标曲线：字数 / 对话占比 / 平均句长 / 张力，可切换显示，点击跳章 */
export function MetricsCurve({ projectId, chapters }: { projectId: ID; chapters: Chapter[] }) {
  const navigate = useNavigate();
  const notify = useAppStore((s) => s.notify);
  const metrics = useMetrics(projectId);
  const [enabled, setEnabled] = useState<string[]>(["wordCount", "tension"]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  const rows = useMemo(() => {
    const byId = new Map(chapters.map((c) => [c.id, c]));
    return metrics
      .map((m) => ({ metric: m, chapter: byId.get(m.chapterId) }))
      .sort((a, b) => a.metric.order - b.metric.order);
  }, [metrics, chapters]);

  const labels = useMemo(
    () => rows.map((r, i) => r.chapter?.title ?? "第" + ((r.metric.order ?? i) + 1) + "章"),
    [rows],
  );

  const series: LineSeries[] = useMemo(
    () =>
      SERIES_DEFS.filter((d) => enabled.includes(d.key)).map((d) => ({
        key: d.key,
        label: d.label,
        color: d.color,
        format: d.format,
        values: rows.map((r) => d.pick(r.metric)),
      })),
    [rows, enabled],
  );

  const runRecompute = useCallback(async () => {
    setBusy(true);
    setProgress({ done: 0, total: chapters.length });
    try {
      const done = await recomputeMetrics(projectId, (d, t) => setProgress({ done: d, total: t }));
      notify("success", "章节指标已重算", "共处理 " + done + " 章");
    } catch (e) {
      notify("danger", "指标计算失败", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [projectId, chapters.length, notify]);

  const toggle = (key: string) => {
    setEnabled((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  const summary = useMemo(() => {
    const list = rows.map((r) => r.metric);
    if (!list.length) return undefined;
    const total = list.reduce((a, m) => a + m.wordCount, 0);
    return {
      count: list.length,
      total,
      avg: Math.round(total / list.length),
      avgDialogue: list.reduce((a, m) => a + m.dialogueRatio, 0) / list.length,
      avgTension: list.reduce((a, m) => a + m.tension, 0) / list.length,
    };
  }, [rows]);

  const ranges = useMemo(
    () =>
      SERIES_DEFS.map((d) => {
        const values = rows.map((r) => d.pick(r.metric)).filter((v) => Number.isFinite(v));
        return { def: d, min: values.length ? Math.min(...values) : 0, max: values.length ? Math.max(...values) : 0 };
      }),
    [rows],
  );

  return (
    <div className="space-y-5">
      {summary && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="已算指标章节" value={fmtInt(summary.count) + " 章"} hint={"共 " + fmtInt(summary.total) + " 字"} icon={<LineChartIcon className="size-4" />} tone="accent" />
          <StatCard label="章均字数" value={fmtInt(summary.avg) + " 字"} hint="与项目目标章长对比可发现长短失衡" />
          <StatCard label="平均对话占比" value={fmtPct(summary.avgDialogue, 1)} hint="长篇常见区间 25%~45%" tone="success" />
          <StatCard label="平均张力" value={fmt1(summary.avgTension)} hint="冲突词密度 + 短句 + 对话的综合估计" tone="warning" />
        </div>
      )}

      <Card className="p-4">
        <SectionTitle
          hint="纵轴为各指标各自的相对区间（量纲不同，只在同一指标内比较）；点击图中任意位置可跳到该章"
          action={
            <Button variant="outline" size="sm" isDisabled={busy} isPending={busy} onPress={() => void runRecompute()}>
              <Calculator className="size-4" />
              重新计算指标
            </Button>
          }
        >
          章节指标曲线
        </SectionTitle>

        {busy && (
          <div className="mb-4 space-y-1.5">
            <p className="text-xs opacity-60">
              正在逐章分析文风与张力… {progress.done}/{progress.total || chapters.length}
            </p>
            <Progress value={progress.done} max={progress.total || chapters.length} />
          </div>
        )}

        {/* 指标开关 */}
        <div className="mb-3 flex flex-wrap gap-2">
          {SERIES_DEFS.map((d) => {
            const on = enabled.includes(d.key);
            const range = ranges.find((r) => r.def.key === d.key);
            return (
              <button
                key={d.key}
                type="button"
                onClick={() => toggle(d.key)}
                className={
                  "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition " +
                  (on
                    ? "border-transparent bg-black/[0.06] dark:bg-white/10"
                    : "border-black/10 opacity-50 hover:opacity-80 dark:border-white/10")
                }
              >
                <span className="inline-block size-2 rounded-full" style={{ background: d.color, opacity: on ? 1 : 0.35 }} />
                {d.label}
                {range && (
                  <span className="tabular opacity-50">
                    {d.format(range.min)}~{d.format(range.max)}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {rows.length === 0 ? (
          <EmptyHint
            icon={<LineChartIcon className="size-7" />}
            title="还没有章节指标"
            description="指标是离线计算的（不消耗 token）：统计每章字数、对话占比、平均句长与张力，用于查看全书的节奏曲线。"
            action={
              <Button variant="primary" size="sm" isDisabled={busy} isPending={busy} onPress={() => void runRecompute()}>
                计算章节指标
              </Button>
            }
          />
        ) : enabled.length === 0 ? (
          <EmptyHint title="至少选择一条指标" description="点击上方的指标标签可以显示或隐藏对应的曲线。" />
        ) : (
          <MultiLineChart
            series={series}
            labels={labels}
            height={260}
            onPick={(i) => {
              const row = rows[i];
              if (row?.chapter) navigate(ROUTES.write(projectId, row.chapter.id));
            }}
          />
        )}
      </Card>
    </div>
  );
}
