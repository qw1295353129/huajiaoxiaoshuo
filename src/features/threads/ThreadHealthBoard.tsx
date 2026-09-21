import { useMemo } from "react";
import { Button, Card, Chip } from "@heroui/react";
import { CheckCircle2, CircleAlert, Clock, EyeOff, GitBranch, TriangleAlert } from "lucide-react";
import type { PlotThread } from "@/core";
import { StatCard } from "@/components/common/ui";
import {
  THREAD_PROBLEM_DESCRIPTIONS,
  THREAD_PROBLEM_LABELS,
  THREAD_PROBLEM_TONES,
  THREAD_PRIORITY_LABELS,
  type ThreadProblem,
  type ThreadProblemKind,
} from "./threadMeta";
import { DIVIDER_CLASS } from "./styles";

const PROBLEM_ORDER: ThreadProblemKind[] = ["overdue", "stale", "unplanted", "orphan"];

const PROBLEM_ICONS: Record<ThreadProblemKind, typeof Clock> = {
  overdue: TriangleAlert,
  stale: Clock,
  unplanted: GitBranch,
  orphan: EyeOff,
};

/**
 * 伏笔健康度看板：把 auditThreads 的结果按问题类型聚合展示。
 * 完全本地计算，不消耗 AI 额度。
 */
export function ThreadHealthBoard({
  problems,
  onOpenThread,
}: {
  problems: ThreadProblem[];
  onOpenThread: (thread: PlotThread) => void;
}) {
  /** 每类问题的数量 */
  const counts = useMemo(() => {
    const map: Record<ThreadProblemKind, number> = { overdue: 0, stale: 0, unplanted: 0, orphan: 0 };
    for (const p of problems) map[p.problem] += 1;
    return map;
  }, [problems]);

  /** 风险清单按严重程度排序展示 */
  const sorted = useMemo(() => {
    const weight: Record<ThreadProblemKind, number> = { overdue: 0, stale: 1, unplanted: 2, orphan: 3 };
    return [...problems].sort((a, b) => weight[a.problem] - weight[b.problem]);
  }, [problems]);

  if (problems.length === 0) {
    return (
      <Card className="flex items-center gap-3 p-4">
        <CheckCircle2 className="size-5 shrink-0 text-emerald-500" />
        <div>
          <p className="text-sm font-medium">伏笔健康：暂无风险</p>
          <p className="mt-0.5 text-xs opacity-55">
            没有超期未回收、久未提及或尚未埋设的伏笔。继续写下去即可，系统会在出现风险时提醒你。
          </p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {PROBLEM_ORDER.map((kind) => {
          const Icon = PROBLEM_ICONS[kind];
          const active = counts[kind] > 0;
          return (
            <StatCard
              key={kind}
              label={THREAD_PROBLEM_LABELS[kind]}
              value={counts[kind]}
              tone={active ? THREAD_PROBLEM_TONES[kind] : "default"}
              icon={<Icon className="size-4" />}
              hint={THREAD_PROBLEM_DESCRIPTIONS[kind]}
            />
          );
        })}
      </div>

      <Card className="overflow-hidden">
        <div className={"flex items-center justify-between gap-3 border-b px-4 py-3 " + DIVIDER_CLASS}>
          <div className="flex items-center gap-2">
            <CircleAlert className="size-4 text-amber-500" />
            <p className="text-sm font-medium">风险清单</p>
          </div>
          <p className="text-xs opacity-55">共 {problems.length} 条需要处理</p>
        </div>
        <ul>
          {sorted.slice(0, 40).map((p) => (
            <li
              key={p.problem + "-" + p.thread.id}
              className={"flex items-start gap-3 border-b px-4 py-2.5 last:border-b-0 " + DIVIDER_CLASS}
            >
              <Chip size="sm" color={THREAD_PROBLEM_TONES[p.problem]}>
                {THREAD_PROBLEM_LABELS[p.problem]}
              </Chip>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{p.thread.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed opacity-60">{p.detail}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-[11px] opacity-45">{THREAD_PRIORITY_LABELS[p.thread.priority]}</span>
                <Button size="sm" variant="ghost" onPress={() => onOpenThread(p.thread)}>
                  处理
                </Button>
              </div>
            </li>
          ))}
        </ul>
        {sorted.length > 40 && (
          <p className="px-4 py-2.5 text-xs opacity-55">还有 {sorted.length - 40} 条未列出，建议先处理最前面的几条。</p>
        )}
      </Card>
    </div>
  );
}
