import { useMemo } from "react";
import type { Chapter, ChapterMetric } from "@/core";
import { Card, Switch } from "@heroui/react";
import { SectionTitle } from "@/components/common/ui";

/** 画布逻辑尺寸：外层用 CSS 控制宽度，viewBox 保证窄屏自适应 */
const W = 1000;
const H = 240;
const PAD = { left: 46, right: 22, top: 18, bottom: 30 };

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

interface Props {
  /** 已按展示顺序排好的章节 */
  chapters: Chapter[];
  metrics: ChapterMetric[];
  selectedId?: string;
  onSelect: (chapterId: string) => void;
  /** 是否显示"对话占比"副线 */
  showDialogue: boolean;
  onShowDialogueChange: (on: boolean) => void;
}

/**
 * 情绪 / 张力曲线：纯 SVG 折线，横轴章节序号、纵轴张力（-5..5）。
 * 副线为每章的对话占比（取章节指标），画在下方浅色带里，可切换显示。
 */
export function TensionCurve({ chapters, metrics, selectedId, onSelect, showDialogue, onShowDialogueChange }: Props) {
  const count = chapters.length;
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  /** 对话占比按 chapterId 索引 */
  const dialogueByChapter = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of metrics) map.set(m.chapterId, m.dialogueRatio);
    return map;
  }, [metrics]);

  const xAt = (i: number) => PAD.left + (count <= 1 ? innerW / 2 : (i * innerW) / (count - 1));
  const yTension = (t: number) => PAD.top + ((5 - clamp(t, -5, 5)) / 10) * innerH;
  /** 对话占比画在图表下方 42% 的浅色带里，避免和主线抢视觉 */
  const yDialogue = (ratio: number) => PAD.top + innerH - clamp(ratio, 0, 1) * innerH * 0.42;

  const tensionPoints = chapters.map((c, i) => ({ chapter: c, i, x: xAt(i), y: yTension(c.tension ?? 0) }));
  const dialoguePoints = chapters
    .map((c, i) => {
      const ratio = dialogueByChapter.get(c.id);
      return ratio === undefined ? null : { i, x: xAt(i), y: yDialogue(ratio), ratio };
    })
    .filter((p): p is { i: number; x: number; y: number; ratio: number } => p !== null);

  const polyline = (points: { x: number; y: number }[]) =>
    points.map((p) => p.x.toFixed(1) + "," + p.y.toFixed(1)).join(" ");

  const areaPath = tensionPoints.length
    ? "M " + tensionPoints[0].x.toFixed(1) + "," + (PAD.top + innerH).toFixed(1) +
      " " + tensionPoints.map((p) => "L " + p.x.toFixed(1) + "," + p.y.toFixed(1)).join(" ") +
      " L " + tensionPoints[tensionPoints.length - 1].x.toFixed(1) + "," + (PAD.top + innerH).toFixed(1) + " Z"
    : "";

  /** 章节多时稀疏刻度，避免横轴糊成一团 */
  const labelStep = Math.max(1, Math.ceil(count / 16));

  return (
    <Card className="p-4">
      <SectionTitle
        hint={count ? "点击数据点即可选中该章 · 张力 " + count + " 章" : undefined}
        action={
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-[11px] opacity-60">
              <span className="inline-block size-2 rounded-full bg-violet-500" />
              张力
            </span>
            <Switch isSelected={showDialogue} onChange={onShowDialogueChange} size="sm">
              <Switch.Content>
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
                <span className="text-[11px] opacity-70">对话占比</span>
              </Switch.Content>
            </Switch>
          </div>
        }
      >
        情绪张力曲线
      </SectionTitle>

      {count === 0 ? (
        <div className="grid place-items-center rounded-xl border border-dashed border-black/10 py-12 text-xs opacity-55 dark:border-white/10">
          还没有章节，建立章节后这里会画出张力曲线。
        </div>
      ) : (
        <svg
          viewBox={"0 0 " + W + " " + H}
          preserveAspectRatio="xMidYMid meet"
          className="h-auto w-full overflow-visible"
          role="img"
          aria-label="章节情绪张力曲线"
        >
          {/* 纵向网格：+5 / 0 / -5 */}
          {[5, 0, -5].map((t) => (
            <g key={t}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={yTension(t)}
                y2={yTension(t)}
                strokeWidth={1}
                strokeDasharray={t === 0 ? undefined : "4 6"}
                className={t === 0 ? "stroke-black/15 dark:stroke-white/20" : "stroke-black/[0.07] dark:stroke-white/[0.08]"}
              />
              <text x={PAD.left - 10} y={yTension(t) + 4} textAnchor="end" className="fill-current text-[11px] opacity-45">
                {t > 0 ? "+" + t : t}
              </text>
            </g>
          ))}

          {/* 对话占比副线（下方浅色带） */}
          {showDialogue && dialoguePoints.length > 0 && (
            <>
              <polyline
                points={polyline(dialoguePoints)}
                fill="none"
                strokeWidth={1.5}
                strokeDasharray="5 4"
                className="stroke-sky-400/70"
              />
              {dialoguePoints.map((p) => (
                <circle key={"d" + p.i} cx={p.x} cy={p.y} r={2} className="fill-sky-400/70">
                  <title>{"第" + (p.i + 1) + "章 · 对话占比 " + Math.round(p.ratio * 100) + "%"}</title>
                </circle>
              ))}
            </>
          )}

          {/* 张力主线 */}
          <path d={areaPath} className="fill-violet-500/[0.08]" />
          <polyline
            points={polyline(tensionPoints)}
            fill="none"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="stroke-violet-500"
          />

          {/* 数据点（可点击选中章节） */}
          {tensionPoints.map((p) => {
            const active = p.chapter.id === selectedId;
            return (
              <g key={p.chapter.id} className="cursor-pointer" onClick={() => onSelect(p.chapter.id)}>
                <title>
                  {"第" + (p.i + 1) + "章 " + p.chapter.title + " · 张力 " + (p.chapter.tension > 0 ? "+" : "") + (p.chapter.tension ?? 0)}
                </title>
                <circle cx={p.x} cy={p.y} r={9} className="fill-transparent" />
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={active ? 5.5 : 3.2}
                  strokeWidth={active ? 2 : 0}
                  className={active ? "fill-emerald-500 stroke-white dark:stroke-neutral-950" : "fill-violet-500"}
                />
              </g>
            );
          })}

          {/* 横轴刻度 */}
          {tensionPoints
            .filter((p) => p.i % labelStep === 0 || p.i === count - 1)
            .map((p) => (
              <text key={"x" + p.chapter.id} x={p.x} y={H - 9} textAnchor="middle" className="fill-current text-[10px] opacity-40">
                {p.i + 1}
              </text>
            ))}
        </svg>
      )}
    </Card>
  );
}
