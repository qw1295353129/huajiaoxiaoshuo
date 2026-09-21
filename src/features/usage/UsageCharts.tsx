import { Card, Chip } from "@heroui/react";
import { EmptyHint, SectionTitle } from "@/components/common/ui";
import { TASK_LABELS } from "@/db/defaults";
import { formatNumber } from "@/utils/format";
import { formatTokens } from "@/utils/tokens";

/** 按任务类型的用量条形图（纯 CSS，无依赖） */
export function TaskBars({
  items,
}: {
  items: { taskKind: string; calls: number; tokens: number }[];
}) {
  const max = items.reduce((m, x) => Math.max(m, x.tokens), 0);
  return (
    <Card className="p-4">
      <SectionTitle hint={"共 " + items.length + " 类任务"}>按任务类型的用量</SectionTitle>
      {items.length === 0 ? (
        <EmptyHint title="还没有调用记录" description="用过任意一个 AI 功能之后，这里会按任务类型统计 token 消耗。" />
      ) : (
        <ul className="space-y-2.5">
          {items.map((item) => (
            <li key={item.taskKind}>
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="truncate">{TASK_LABELS[item.taskKind as keyof typeof TASK_LABELS] ?? item.taskKind}</span>
                <span className="tabular shrink-0 opacity-55">
                  {item.calls} 次 · {formatNumber(item.tokens)} tokens
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/10">
                <div
                  className="h-full rounded-full bg-neutral-900 transition-all"
                  style={{ width: (max > 0 ? (item.tokens / max) * 100 : 0) + "%" }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const W = 640;
const H = 180;
const PAD_X = 36;
const PAD_Y = 22;

function shortDate(date: string): string {
  return date.slice(5);
}

/** 按天的 token 折线图（纯 SVG） */
export function DailyLine({ points }: { points: { date: string; tokens: number }[] }) {
  const max = points.reduce((m, p) => Math.max(m, p.tokens), 0);
  const innerW = W - PAD_X * 2;
  const innerH = H - PAD_Y * 2;
  const step = points.length > 1 ? innerW / (points.length - 1) : 0;
  const coords = points.map((p, i) => ({
    x: points.length > 1 ? PAD_X + i * step : PAD_X + innerW / 2,
    y: PAD_Y + innerH - (max > 0 ? (p.tokens / max) * innerH : 0),
    ...p,
  }));
  const line = coords.map((c) => c.x.toFixed(1) + "," + c.y.toFixed(1)).join(" ");
  const area =
    coords.length > 0
      ? PAD_X +
        "," +
        (PAD_Y + innerH) +
        " " +
        line +
        " " +
        (coords[coords.length - 1].x.toFixed(1)) +
        "," +
        (PAD_Y + innerH)
      : "";
  const labelIndexes = Array.from(new Set([0, Math.floor(coords.length / 2), coords.length - 1])).filter(
    (i) => i >= 0 && i < coords.length,
  );

  return (
    <Card className="p-4">
      <SectionTitle
        hint={points.length > 0 ? points[0].date + " 起，共 " + points.length + " 天有产出" : undefined}
        action={max > 0 ? <Chip size="sm">峰值 {formatTokens(max)}</Chip> : undefined}
      >
        按天的 token 消耗
      </SectionTitle>
      {points.length === 0 ? (
        <EmptyHint title="还没有每日数据" description="生成记录会按天汇总，方便你观察自己的使用节奏。" />
      ) : (
        <div className="w-full overflow-x-auto">
          <svg viewBox={"0 0 " + W + " " + H} className="h-44 w-full min-w-[420px]" role="img" aria-label="每日 token 消耗折线图">
            {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
              <line
                key={ratio}
                x1={PAD_X}
                x2={W - PAD_X}
                y1={PAD_Y + innerH * ratio}
                y2={PAD_Y + innerH * ratio}
                className="stroke-black/8 dark:stroke-white/10"
                strokeWidth={1}
              />
            ))}
            {area && <polygon points={area} className="fill-neutral-800/10" />}
            {coords.length > 1 && (
              <polyline
                points={line}
                fill="none"
                className="stroke-neutral-800"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            )}
            {coords.map((c) => (
              <g key={c.date}>
                <circle cx={c.x} cy={c.y} r={3} className="fill-neutral-800">
                  <title>{c.date + "：" + formatNumber(c.tokens) + " tokens"}</title>
                </circle>
              </g>
            ))}
            {labelIndexes.map((i) => (
              <text
                key={"label-" + i}
                x={coords[i].x}
                y={H - 6}
                textAnchor={i === 0 ? "start" : i === coords.length - 1 ? "end" : "middle"}
                className="fill-current text-[10px] opacity-45"
              >
                {shortDate(coords[i].date)}
              </text>
            ))}
            {max > 0 && (
              <text x={4} y={PAD_Y + 4} className="fill-current text-[10px] opacity-45">
                {formatTokens(max)}
              </text>
            )}
          </svg>
        </div>
      )}
    </Card>
  );
}
