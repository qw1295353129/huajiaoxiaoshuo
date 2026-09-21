import { Button, Card, Chip, Tooltip } from "@heroui/react";
import { ArrowRight, CheckCircle2, Pencil, Quote, Trash2 } from "lucide-react";
import type { Chapter, PlotThread } from "@/core";
import { Progress } from "@/components/common/ui";
import {
  THREAD_KIND_COLORS,
  THREAD_KIND_LABELS,
  THREAD_PRIORITY_COLORS,
  THREAD_PRIORITY_LABELS,
  THREAD_STATUS_COLORS,
  THREAD_STATUS_LABELS,
  chapterLabel,
  payoffProgress,
} from "./threadMeta";
import { DIVIDER_CLASS } from "./styles";

/** 单条伏笔卡片：基本信息 + 埋设/回收链路 + 原文片段 + 行内操作。 */
export function ThreadCard({
  thread,
  chapters,
  highlighted,
  onEdit,
  onDelete,
  onQuickPayoff,
}: {
  thread: PlotThread;
  chapters: Chapter[];
  highlighted?: boolean;
  onEdit: (thread: PlotThread) => void;
  onDelete: (thread: PlotThread) => void;
  onQuickPayoff: (thread: PlotThread) => void;
}) {
  const progress = payoffProgress(thread, chapters);
  const open = thread.status !== "resolved" && thread.status !== "abandoned";

  return (
    <Card
      className={
        "p-4 transition " +
        (highlighted ? "ring-2 ring-violet-500/60" : "")
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="truncate text-sm font-semibold">{thread.title}</h3>
            <Chip size="sm" color={THREAD_KIND_COLORS[thread.kind]}>
              {THREAD_KIND_LABELS[thread.kind]}
            </Chip>
            <Chip size="sm" color={THREAD_STATUS_COLORS[thread.status]}>
              {THREAD_STATUS_LABELS[thread.status]}
            </Chip>
            <Chip size="sm" color={THREAD_PRIORITY_COLORS[thread.priority]}>
              {THREAD_PRIORITY_LABELS[thread.priority]}
            </Chip>
          </div>
          {thread.description && (
            <p className="mt-2 text-xs leading-relaxed opacity-70">{thread.description}</p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {open && (
            <Tooltip>
              <Tooltip.Trigger>
                <Button size="sm" variant="ghost" isIconOnly aria-label="标记为已回收" onPress={() => onQuickPayoff(thread)}>
                  <CheckCircle2 className="size-4" />
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content>标记为「当前最新章已回收」</Tooltip.Content>
            </Tooltip>
          )}
          <Button size="sm" variant="ghost" isIconOnly aria-label="编辑" onPress={() => onEdit(thread)}>
            <Pencil className="size-4" />
          </Button>
          <Button size="sm" variant="ghost" isIconOnly aria-label="删除" onPress={() => onDelete(thread)}>
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      {/* 埋设 → 计划回收 → 实际回收 */}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-md bg-violet-500/10 px-2 py-1 text-violet-600 dark:text-violet-300">
          埋设　{chapterLabel(chapters, thread.plantedChapterId)}
        </span>
        <ArrowRight className="size-3.5 opacity-35" />
        <span className="rounded-md bg-amber-500/10 px-2 py-1 text-amber-600 dark:text-amber-300">
          计划回收　{chapterLabel(chapters, thread.plannedPayoffChapterId)}
        </span>
        <ArrowRight className="size-3.5 opacity-35" />
        <span
          className={
            "rounded-md px-2 py-1 " +
            (thread.payoffChapterId
              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
              : "bg-black/5 opacity-60 dark:bg-white/10")
          }
        >
          实际回收　{chapterLabel(chapters, thread.payoffChapterId)}
        </span>
      </div>

      <div className="mt-3">
        <Progress value={progress * 100} max={100} />
      </div>

      {(thread.plantQuote || thread.payoffQuote) && (
        <div className={"mt-3 space-y-2 border-t pt-3 " + DIVIDER_CLASS}>
          {thread.plantQuote && <QuoteBlock label="埋设原文" text={thread.plantQuote} />}
          {thread.payoffQuote && <QuoteBlock label="回收原文" text={thread.payoffQuote} />}
        </div>
      )}

      {thread.notes && (
        <p className={"mt-3 border-t pt-2.5 text-[11px] leading-relaxed opacity-50 " + DIVIDER_CLASS}>
          备注：{thread.notes}
        </p>
      )}
    </Card>
  );
}

function QuoteBlock({ label, text }: { label: string; text: string }) {
  return (
    <div className="flex gap-2">
      <Quote className="mt-0.5 size-3.5 shrink-0 opacity-30" />
      <div className="min-w-0">
        <p className="text-[11px] opacity-45">{label}</p>
        <p className="mt-0.5 whitespace-pre-wrap text-xs leading-relaxed opacity-75">{text}</p>
      </div>
    </div>
  );
}
