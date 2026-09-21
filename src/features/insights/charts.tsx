import { useMemo, useState } from "react";
import { Tooltip } from "@heroui/react";

/**
 * 纯 SVG / div 的轻量图表原语。
 * 不引入任何图表库：曲线、柱子用 SVG，热力图用 div 网格。
 */

/** 指标配色（与全局视觉规范一致） */
export const SERIES_COLORS = {
  violet: "#8b5cf6",
  emerald: "#10b981",
  amber: "#f59e0b",
  rose: "#f43f5e",
  sky: "#0ea5e9",
};

export interface LineSeries {
  key: string;
  label: string;
  color: string;
  values: number[];
  /** 悬浮/图例里的数值格式 */
  format?: (v: number) => string;
}

const VIEW_W = 860;
const PAD_L = 46;
const PAD_R = 14;
const PAD_T = 14;
const PAD_B = 26;

function clampLabel(text: string, max = 9): string {
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

/**
 * 多折线图：每条线按各自的区间归一化（指标量纲不同），
 * 悬浮显示该章所有指标的真实数值，点击跳转。
 */
export function MultiLineChart({
  series,
  labels,
  height = 250,
  onPick,
}: {
  series: LineSeries[];
  labels: string[];
  height?: number;
  onPick?: (index: number) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const n = labels.length;
  const innerW = VIEW_W - PAD_L - PAD_R;
  const innerH = height - PAD_T - PAD_B;

  // 逐系列求区间并归一化
  const prepared = useMemo(
    () =>
      series.map((s) => {
        let min = Infinity;
        let max = -Infinity;
        for (let i = 0; i < n; i++) {
          const v = s.values[i];
          if (!Number.isFinite(v)) continue;
          if (v < min) min = v;
          if (v > max) max = v;
        }
        if (!Number.isFinite(min)) {
          min = 0;
          max = 1;
        }
        if (max - min < 1e-9) {
          min -= 1;
          max += 1;
        }
        return { ...s, min, max };
      }),
    [series, n],
  );

  if (n === 0 || prepared.length === 0) {
    return <p className="py-10 text-center text-xs opacity-50">没有可绘制的数据</p>;
  }

  const x = (i: number) => (n === 1 ? PAD_L + innerW / 2 : PAD_L + (i * innerW) / (n - 1));
  const yOf = (v: number, min: number, max: number) => PAD_T + (1 - (v - min) / (max - min)) * innerH;

  const only = prepared.length === 1 ? prepared[0] : undefined;
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const labelStep = Math.max(1, Math.ceil(n / 9));
  const hovered = hover !== null && hover >= 0 && hover < n ? hover : null;

  /** 把鼠标位置换算成数据点下标 */
  const pickFromEvent = (clientX: number, rect: DOMRect): number | null => {
    if (!rect.width) return null;
    const viewX = ((clientX - rect.left) / rect.width) * VIEW_W;
    const ratio = (viewX - PAD_L) / innerW;
    const idx = Math.round(ratio * (n - 1));
    return Math.max(0, Math.min(n - 1, idx));
  };

  return (
    <div className="relative">
      <svg
        viewBox={"0 0 " + VIEW_W + " " + height}
        className={"w-full " + (onPick ? "cursor-pointer" : "")}
        style={{ height }}
        preserveAspectRatio="none"
        onMouseLeave={() => setHover(null)}
        onClick={(e) => {
          if (!onPick) return;
          const idx = pickFromEvent(e.clientX, e.currentTarget.getBoundingClientRect());
          if (idx !== null) onPick(idx);
        }}
      >
        {/* 横向网格 */}
        {ticks.map((t) => {
          const gy = PAD_T + innerH * t;
          return (
            <g key={t}>
              <line
                x1={PAD_L}
                x2={VIEW_W - PAD_R}
                y1={gy}
                y2={gy}
                stroke="currentColor"
                strokeOpacity={t === 1 ? 0.16 : 0.08}
                strokeDasharray={t === 1 ? undefined : "3 4"}
              />
              {only && (
                <text x={PAD_L - 6} y={gy + 3.5} textAnchor="end" fontSize={10} fill="currentColor" fillOpacity={0.45}>
                  {only.format
                    ? only.format(only.max - (only.max - only.min) * t)
                    : Math.round(only.max - (only.max - only.min) * t)}
                </text>
              )}
            </g>
          );
        })}

        {/* 折线 + 数据点 */}
        {prepared.map((s) => {
          const pts = s.values
            .slice(0, n)
            .map((v, i) => (Number.isFinite(v) ? x(i) + "," + yOf(v, s.min, s.max) : null))
            .filter((p): p is string => p !== null)
            .join(" ");
          return (
            <g key={s.key}>
              <polyline points={pts} fill="none" stroke={s.color} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
              {n <= 120 &&
                s.values.slice(0, n).map((v, i) =>
                  Number.isFinite(v) ? (
                    <circle
                      key={i}
                      cx={x(i)}
                      cy={yOf(v, s.min, s.max)}
                      r={hovered === i ? 4 : 2.4}
                      fill={s.color}
                      stroke="white"
                      strokeWidth={hovered === i ? 1.4 : 0}
                      className="dark:stroke-neutral-900"
                    />
                  ) : null,
                )}
            </g>
          );
        })}

        {/* 悬浮十字线 */}
        {hovered !== null && (
          <line x1={x(hovered)} x2={x(hovered)} y1={PAD_T} y2={PAD_T + innerH} stroke="currentColor" strokeOpacity={0.25} strokeDasharray="3 3" />
        )}

        {/* X 轴标签 */}
        {labels.map((l, i) =>
          i % labelStep === 0 || i === n - 1 ? (
            <text
              key={i}
              x={x(i)}
              y={height - 8}
              textAnchor="middle"
              fontSize={10}
              fill="currentColor"
              fillOpacity={hovered === i ? 0.85 : 0.45}
            >
              {clampLabel(l, 7)}
            </text>
          ) : null,
        )}

        {/* 悬浮感应层 */}
        <rect
          x={PAD_L}
          y={PAD_T}
          width={innerW}
          height={innerH}
          fill="transparent"
          onMouseMove={(e) => setHover(pickFromEvent(e.clientX, e.currentTarget.getBoundingClientRect()))}
        />
      </svg>

      {/* 悬浮数值卡片 */}
      {hovered !== null && (
        <div
          className="pointer-events-none absolute top-1 z-10 min-w-32 -translate-x-1/2 rounded-lg border border-black/10 bg-white/95 px-2.5 py-2 text-[11px] shadow-lg backdrop-blur dark:border-white/10 dark:bg-neutral-900/95"
          style={{ left: Math.min(88, Math.max(12, (x(hovered) / VIEW_W) * 100)) + "%" }}
        >
          <p className="mb-1 font-medium">{labels[hovered]}</p>
          {prepared.map((s) => (
            <p key={s.key} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 opacity-70">
                <span className="inline-block size-2 rounded-full" style={{ background: s.color }} />
                {s.label}
              </span>
              <span className="tabular">
                {Number.isFinite(s.values[hovered]) ? (s.format ? s.format(s.values[hovered]) : String(s.values[hovered])) : "—"}
              </span>
            </p>
          ))}
          {onPick && <p className="mt-1 opacity-45">点击跳转到该章</p>}
        </div>
      )}
    </div>
  );
}

export interface BarDatum {
  label: string;
  value: number;
  /** 悬浮时显示的完整说明 */
  tip?: string;
}

/** 柱状图：X 轴自动抽稀标签，可选均值参考线，可点击。 */
export function BarChart({
  data,
  height = 170,
  color = SERIES_COLORS.violet,
  avgLine,
  onPick,
  caption,
}: {
  data: BarDatum[];
  height?: number;
  color?: string;
  /** 均值参考线（0 表示不画） */
  avgLine?: number;
  onPick?: (index: number) => void;
  /** 顶部说明文字（没有 hover 时显示） */
  caption?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const n = data.length;
  const innerW = VIEW_W - PAD_L - PAD_R;
  const innerH = height - PAD_T - PAD_B;
  const max = Math.max(1, ...data.map((d) => d.value));
  const barW = n ? Math.max(1, (innerW / n) * 0.68) : 1;
  const step = Math.max(1, Math.ceil(n / 8));
  const hovered = hover !== null && hover >= 0 && hover < n ? hover : null;

  if (!n) return <p className="py-10 text-center text-xs opacity-50">没有可绘制的数据</p>;

  const cx = (i: number) => PAD_L + (i + 0.5) * (innerW / n);
  const hOf = (v: number) => (v <= 0 ? 0 : Math.max(2, (v / max) * innerH));

  return (
    <div className="relative">
      <p className="mb-1 h-4 truncate text-[11px] opacity-55">
        {hovered !== null ? data[hovered].tip ?? data[hovered].label + " · " + data[hovered].value : caption ?? ""}
      </p>
      <svg
        viewBox={"0 0 " + VIEW_W + " " + height}
        className={"w-full " + (onPick ? "cursor-pointer" : "")}
        style={{ height }}
        preserveAspectRatio="none"
        onMouseLeave={() => setHover(null)}
        onClick={(e) => {
          if (!onPick) return;
          const rect = e.currentTarget.getBoundingClientRect();
          if (!rect.width) return;
          const viewX = ((e.clientX - rect.left) / rect.width) * VIEW_W;
          const idx = Math.floor(((viewX - PAD_L) / innerW) * n);
          if (idx >= 0 && idx < n) onPick(idx);
        }}
      >
        {/* 基线 */}
        <line x1={PAD_L} x2={VIEW_W - PAD_R} y1={PAD_T + innerH} y2={PAD_T + innerH} stroke="currentColor" strokeOpacity={0.16} />
        {/* 均值线 */}
        {avgLine !== undefined && avgLine > 0 && (
          <line
            x1={PAD_L}
            x2={VIEW_W - PAD_R}
            y1={PAD_T + innerH - hOf(avgLine)}
            y2={PAD_T + innerH - hOf(avgLine)}
            stroke="currentColor"
            strokeOpacity={0.35}
            strokeDasharray="4 4"
          />
        )}
        {data.map((d, i) => {
          const h = hOf(d.value);
          return (
            <rect
              key={i}
              x={cx(i) - barW / 2}
              y={PAD_T + innerH - h}
              width={barW}
              height={h}
              rx={Math.min(2, barW / 2)}
              fill={color}
              fillOpacity={hovered === null ? 0.85 : hovered === i ? 1 : 0.35}
            />
          );
        })}
        {data.map((d, i) =>
          i % step === 0 || i === n - 1 ? (
            <text
              key={i}
              x={cx(i)}
              y={height - 8}
              textAnchor="middle"
              fontSize={10}
              fill="currentColor"
              fillOpacity={hovered === i ? 0.85 : 0.45}
            >
              {clampLabel(d.label, 6)}
            </text>
          ) : null,
        )}
        <rect
          x={PAD_L}
          y={PAD_T}
          width={innerW}
          height={innerH}
          fill="transparent"
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            if (!rect.width) return;
            const viewX = ((e.clientX - rect.left) / rect.width) * VIEW_W;
            const idx = Math.floor(((viewX - PAD_L) / innerW) * n);
            setHover(idx >= 0 && idx < n ? idx : null);
          }}
        />
      </svg>
    </div>
  );
}

export interface HeatCell {
  date: string;
  words: number;
}

const LEVEL_CLASS = [
  "bg-black/[0.05] dark:bg-white/[0.06]",
  "bg-violet-200 dark:bg-violet-500/25",
  "bg-violet-300 dark:bg-violet-500/45",
  "bg-violet-400 dark:bg-violet-500/70",
  "bg-violet-600 dark:bg-violet-500",
];

const WEEKDAY_LABEL = ["日", "一", "二", "三", "四", "五", "六"];

/** GitHub 风格的写作热力图（纯 div 网格 + Tooltip）。 */
export function WritingHeatmap({ data }: { data: HeatCell[] }) {
  const { weeks, max } = useMemo(() => {
    const cells = data.map((d) => ({ ...d, dow: new Date(d.date + "T00:00:00").getDay() }));
    const list: ((HeatCell & { dow: number }) | null)[][] = [];
    let cur: ((HeatCell & { dow: number }) | null)[] = new Array(cells[0]?.dow ?? 0).fill(null);
    for (const c of cells) {
      cur.push(c);
      if (cur.length === 7) {
        list.push(cur);
        cur = [];
      }
    }
    if (cur.length) {
      while (cur.length < 7) cur.push(null);
      list.push(cur);
    }
    return { weeks: list, max: Math.max(1, ...cells.map((c) => c.words)) };
  }, [data]);

  if (!data.length) return <p className="py-10 text-center text-xs opacity-50">还没有写作记录</p>;

  const level = (words: number) => {
    if (words <= 0) return 0;
    const r = words / max;
    if (r <= 0.25) return 1;
    if (r <= 0.5) return 2;
    if (r <= 0.75) return 3;
    return 4;
  };

  return (
    <div className="overflow-x-auto pb-1">
      <div className="inline-flex flex-col gap-1">
        {/* 月份标签 */}
        <div className="flex gap-[3px] pl-6">
          {weeks.map((w, wi) => {
            const first = w.find((c) => c) ?? null;
            const prev = wi > 0 ? weeks[wi - 1].find((c) => c) ?? null : null;
            const month = first ? first.date.slice(5, 7) : "";
            const prevMonth = prev ? prev.date.slice(5, 7) : "";
            return (
              <div key={wi} className="w-[11px] shrink-0 text-[10px] leading-none opacity-45">
                {first && month !== prevMonth ? Number(month) + "月" : ""}
              </div>
            );
          })}
        </div>

        <div className="flex gap-[3px]">
          {/* 星期标签 */}
          <div className="flex w-6 shrink-0 flex-col gap-[3px] pr-1">
            {WEEKDAY_LABEL.map((d, i) => (
              <div key={d} className="h-[11px] text-[9px] leading-[11px] opacity-35">
                {i % 2 === 1 ? d : ""}
              </div>
            ))}
          </div>

          {/* 周列 */}
          {weeks.map((w, wi) => (
            <div key={wi} className="flex flex-col gap-[3px]">
              {w.map((c, di) =>
                c ? (
                  <Tooltip key={di} delay={60} closeDelay={0}>
                    <Tooltip.Trigger>
                      <div
                        className={"size-[11px] rounded-[2px] " + LEVEL_CLASS[level(c.words)]}
                        aria-label={c.date + " " + c.words + " 字"}
                      />
                    </Tooltip.Trigger>
                    <Tooltip.Content>
                      {c.date} · {c.words > 0 ? c.words.toLocaleString("zh-CN") + " 字" : "未写作"}
                    </Tooltip.Content>
                  </Tooltip>
                ) : (
                  <div key={di} className="size-[11px]" />
                ),
              )}
            </div>
          ))}
        </div>

        {/* 图例 */}
        <div className="mt-1 flex items-center justify-end gap-1.5 text-[10px] opacity-55">
          <span>少</span>
          {LEVEL_CLASS.map((c) => (
            <span key={c} className={"size-[11px] rounded-[2px] " + c} />
          ))}
          <span>多</span>
        </div>
      </div>
    </div>
  );
}

/** 迷你柱状分布图（句长直方图等） */
export function MiniHistogram({ values, labels }: { values: number[]; labels: string[] }) {
  const max = Math.max(1, ...values);
  return (
    <div className="flex items-end gap-1.5">
      {values.map((v, i) => (
        <div key={i} className="flex min-w-0 flex-1 flex-col items-center gap-1">
          <div className="flex h-16 w-full items-end rounded-sm bg-black/[0.04] dark:bg-white/[0.06]">
            <div className="w-full rounded-sm bg-violet-400/80 dark:bg-violet-500/70" style={{ height: Math.max(2, (v / max) * 100) + "%" }} />
          </div>
          <span className="tabular text-[10px] opacity-45">{labels[i]}</span>
        </div>
      ))}
    </div>
  );
}
