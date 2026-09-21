import { Card, Chip, Spinner } from "@heroui/react";
import { Check, Minus, X } from "lucide-react";
import type { GenesisStage, GenesisStageKind } from "@/core";
import { PIPELINE, STAGE_HINTS, STAGE_LABELS } from "./helpers";

function StatusIcon({ status }: { status: GenesisStage["status"] }) {
  if (status === "running") return <Spinner size="sm" />;
  if (status === "done") return <Check className="size-3.5 text-emerald-500" />;
  if (status === "failed") return <X className="size-3.5 text-rose-500" />;
  return <Minus className="size-3.5 opacity-30" />;
}

/** 五阶段流水线进度 */
export function StageStepper({
  stages,
  durations,
  busy,
  elapsed,
}: {
  stages: GenesisStage[];
  durations: Record<string, number>;
  busy: boolean;
  elapsed: number;
}) {
  const map = new Map<GenesisStageKind, GenesisStage>();
  for (const stage of stages) map.set(stage.kind, stage);
  const list: GenesisStage[] = PIPELINE.map(
    (kind) => map.get(kind) ?? { kind, status: "pending" as const },
  );
  const doneCount = list.filter((s) => s.status === "done").length;

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold tracking-tight">生成流水线</p>
          <p className="mt-0.5 text-xs opacity-55">
            {busy
              ? "正在生成，可以随时取消；已经完成的阶段会保留。"
              : "阶段之间会互相喂结论，保证设定内部一致。"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {busy && <span className="tabular text-xs opacity-55">{elapsed}s</span>}
          <Chip size="sm" color={doneCount === list.length ? "success" : "default"}>
            {doneCount} / {list.length}
          </Chip>
        </div>
      </div>

      <ol className="space-y-1.5">
        {list.map((stage, index) => {
          const duration = durations[stage.kind] ?? stage.ms;
          return (
            <li
              key={stage.kind}
              className={
                "flex items-start gap-3 rounded-xl border px-3 py-2 transition " +
                (stage.status === "running"
                  ? "border-black/25 bg-black/[0.04]"
                  : stage.status === "failed"
                    ? "border-rose-500/30 bg-rose-500/[0.05]"
                    : "border-black/5 dark:border-white/5")
              }
            >
              <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-black/[0.05] text-[11px] dark:bg-white/10">
                {stage.status === "pending" ? index + 1 : <StatusIcon status={stage.status} />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{STAGE_LABELS[stage.kind]}</span>
                  {stage.model && <span className="truncate text-[11px] opacity-45">{stage.model}</span>}
                  {duration !== undefined && (
                    <span className="tabular text-[11px] opacity-45">{(duration / 1000).toFixed(1)}s</span>
                  )}
                  {stage.tokens ? (
                    <span className="tabular text-[11px] opacity-45">{stage.tokens} tokens</span>
                  ) : null}
                </div>
                <p className="mt-0.5 text-[11px] leading-relaxed opacity-50">{STAGE_HINTS[stage.kind]}</p>
                {stage.error && (
                  <p className="mt-1 rounded-lg bg-rose-500/[0.08] px-2 py-1.5 text-[11px] leading-relaxed text-rose-600 dark:text-rose-300">
                    {stage.error}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
