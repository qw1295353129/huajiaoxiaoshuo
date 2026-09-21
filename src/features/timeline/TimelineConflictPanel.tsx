import { useMemo, useState } from "react";
import { Button, Card, Chip } from "@heroui/react";
import { CheckCircle2, ChevronDown, ChevronRight, Crosshair, ShieldAlert } from "lucide-react";
import type { ID } from "@/core";
import {
  CONFLICT_KIND_LABELS,
  CONFLICT_SEVERITY_LABELS,
  type ConflictSeverity,
  type TimelineConflict,
} from "./timelineConflicts";
import { DIVIDER_CLASS } from "./styles";

const SEVERITY_COLORS: Record<ConflictSeverity, "danger" | "warning" | "accent"> = {
  error: "danger",
  warn: "warning",
  info: "accent",
};

const SEVERITY_ORDER: ConflictSeverity[] = ["error", "warn", "info"];

/** 时间线冲突面板：本地检测结果 + 一键定位到对应事件。 */
export function TimelineConflictPanel({
  conflicts,
  onLocate,
}: {
  conflicts: TimelineConflict[];
  onLocate: (eventId: ID, conflict: TimelineConflict) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [severityFilter, setSeverityFilter] = useState<"all" | ConflictSeverity>("all");

  const counts = useMemo(() => {
    const map: Record<ConflictSeverity, number> = { error: 0, warn: 0, info: 0 };
    for (const c of conflicts) map[c.severity] += 1;
    return map;
  }, [conflicts]);

  const visible = useMemo(
    () => (severityFilter === "all" ? conflicts : conflicts.filter((c) => c.severity === severityFilter)),
    [conflicts, severityFilter],
  );

  if (conflicts.length === 0) {
    return (
      <Card className="flex items-center gap-3 p-4">
        <CheckCircle2 className="size-5 shrink-0 text-emerald-500" />
        <div>
          <p className="text-sm font-medium">时间线自检通过</p>
          <p className="mt-0.5 text-xs opacity-55">
            没有发现同章时间颠倒、跨章时间矛盾或未挂章节的事件。切换到剧情内时间轴可以继续核对细节。
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        className={"flex w-full items-center justify-between gap-3 border-b px-4 py-3 text-left transition hover:bg-black/[0.02] dark:hover:bg-white/[0.03] " + DIVIDER_CLASS}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="flex items-center gap-2">
          <ShieldAlert className="size-4 text-amber-500" />
          <span className="text-sm font-medium">时间线冲突检测</span>
          {SEVERITY_ORDER.filter((s) => counts[s] > 0).map((s) => (
            <Chip key={s} size="sm" color={SEVERITY_COLORS[s]}>
              {CONFLICT_SEVERITY_LABELS[s]} {counts[s]}
            </Chip>
          ))}
        </span>
        <span className="flex items-center gap-1 text-xs opacity-55">
          {expanded ? "收起" : "展开"}
          {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        </span>
      </button>

      {expanded && (
        <>
          <div className={"flex flex-wrap items-center gap-2 border-b px-4 py-2 " + DIVIDER_CLASS}>
            <button type="button" className="transition active:scale-95" onClick={() => setSeverityFilter("all")}>
              <Chip size="sm" color={severityFilter === "all" ? "accent" : "default"}>
                全部 {conflicts.length}
              </Chip>
            </button>
            {SEVERITY_ORDER.map((s) => (
              <button key={s} type="button" className="transition active:scale-95" onClick={() => setSeverityFilter(s)}>
                <Chip size="sm" color={severityFilter === s ? SEVERITY_COLORS[s] : "default"}>
                  {CONFLICT_SEVERITY_LABELS[s]} {counts[s]}
                </Chip>
              </button>
            ))}
            <span className="ml-auto text-[11px] opacity-45">检测完全在本地完成，不消耗 AI 额度</span>
          </div>

          <ul className="max-h-[420px] overflow-y-auto">
            {visible.length === 0 && <li className="px-4 py-4 text-xs opacity-55">该级别下没有问题。</li>}
            {visible.map((conflict) => (
              <li
                key={conflict.id}
                className={"flex items-start gap-3 border-b px-4 py-2.5 last:border-b-0 " + DIVIDER_CLASS}
              >
                <Chip size="sm" color={SEVERITY_COLORS[conflict.severity]}>
                  {CONFLICT_KIND_LABELS[conflict.kind]}
                </Chip>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{conflict.title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed opacity-65">{conflict.detail}</p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="shrink-0"
                  onPress={() => onLocate(conflict.eventIds[0], conflict)}
                >
                  <Crosshair className="size-3.5" />
                  定位
                </Button>
              </li>
            ))}
          </ul>
          {conflicts.length >= 80 && (
            <p className="px-4 py-2 text-[11px] opacity-50">问题较多，仅显示前 80 条。</p>
          )}
        </>
      )}
    </Card>
  );
}
