import { Button, Card, Chip } from "@heroui/react";
import { Eye, RotateCcw } from "lucide-react";
import type { GenesisRun } from "@/core";
import { EmptyHint, SectionTitle } from "@/components/common/ui";
import { formatRelative } from "@/utils/format";
import { RUN_STATUS_META } from "./helpers";

/** 历史生成记录：可回看、可再次落库 */
export function GenesisHistory({
  runs,
  currentId,
  busy,
  onView,
  onApply,
}: {
  runs: GenesisRun[];
  currentId?: string;
  busy?: boolean;
  onView: (run: GenesisRun) => void;
  onApply: (run: GenesisRun) => void;
}) {
  return (
    <Card className="p-4">
      <SectionTitle hint="保存在本机的每一次生成，可回看或再次写入项目">历史记录</SectionTitle>
      {runs.length === 0 ? (
        <EmptyHint title="还没有生成记录" description="在上面写下灵感并开始生成，这里会留下每一次的完整产物。" />
      ) : (
        <ul className="space-y-1.5">
          {runs.map((run) => {
            const meta = RUN_STATUS_META[run.status];
            const done = run.stages.filter((s) => s.status === "done").length;
            return (
              <li
                key={run.id}
                className={
                  "flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 transition " +
                  (run.id === currentId
                    ? "border-black/25 bg-black/[0.03]"
                    : "border-black/5 dark:border-white/5")
                }
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs">{run.seed || "（无灵感文本）"}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] opacity-50">
                    <span>{formatRelative(run.createdAt)}</span>
                    <span className="tabular">{done} / 5 阶段</span>
                    {run.appliedAt && <span className="text-emerald-500">已落库 {formatRelative(run.appliedAt)}</span>}
                  </div>
                </div>
                <Chip size="sm" color={meta.color}>
                  {meta.label}
                </Chip>
                <div className="flex items-center gap-1.5">
                  <Button size="sm" variant="ghost" isDisabled={busy} onPress={() => onView(run)}>
                    <Eye className="size-3.5" />
                    查看
                  </Button>
                  <Button size="sm" variant="outline" isDisabled={busy || done === 0} onPress={() => onApply(run)}>
                    <RotateCcw className="size-3.5" />
                    再次应用
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
