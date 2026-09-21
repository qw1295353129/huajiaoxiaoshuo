import { useState } from "react";
import { Button, Card, Chip, Tooltip } from "@heroui/react";
import type { AiGeneration } from "@/core";
import { EmptyHint, SectionTitle } from "@/components/common/ui";
import { TASK_LABELS } from "@/db/defaults";
import { formatDateTime, formatDuration, formatNumber } from "@/utils/format";

const PAGE = 30;

/** 最近生成记录表（Tailwind + div，避免重型表格组件） */
export function GenerationsTable({ rows }: { rows: AiGeneration[] }) {
  const [limit, setLimit] = useState(PAGE);
  const visible = rows.slice(0, limit);
  const failed = rows.filter((r) => !r.ok).length;

  return (
    <Card className="p-4">
      <SectionTitle
        hint={rows.length + " 条记录" + (failed > 0 ? " · " + failed + " 次失败" : "")}
        action={
          rows.length > limit ? (
            <Button size="sm" variant="ghost" onPress={() => setLimit((v) => v + PAGE)}>
              加载更多（还有 {rows.length - limit} 条）
            </Button>
          ) : undefined
        }
      >
        最近生成记录
      </SectionTitle>

      {rows.length === 0 ? (
        <EmptyHint title="还没有生成记录" description="每一次模型调用都会记录下来：任务、模型、token 与耗时。" />
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[760px]">
            <div className="grid grid-cols-[110px_minmax(96px,1fr)_minmax(120px,1.2fr)_80px_80px_72px_120px] gap-3 border-b border-black/5 pb-2 text-[11px] font-medium opacity-50 dark:border-white/5">
              <span>时间</span>
              <span>任务</span>
              <span>模型</span>
              <span className="text-right">prompt</span>
              <span className="text-right">completion</span>
              <span className="text-right">耗时</span>
              <span>状态</span>
            </div>
            <ul>
              {visible.map((row) => (
                <li
                  key={row.id}
                  className="grid grid-cols-[110px_minmax(96px,1fr)_minmax(120px,1.2fr)_80px_80px_72px_120px] items-center gap-3 border-b border-black/5 py-2 text-xs last:border-0 dark:border-white/5"
                >
                  <span className="tabular opacity-60">{formatDateTime(row.createdAt)}</span>
                  <span className="truncate">
                    {TASK_LABELS[row.taskKind as keyof typeof TASK_LABELS] ?? row.taskKind}
                  </span>
                  <span className="truncate opacity-70" title={row.model}>
                    {row.model}
                  </span>
                  <span className="tabular text-right">{formatNumber(row.promptTokens)}</span>
                  <span className="tabular text-right">{formatNumber(row.completionTokens)}</span>
                  <span className="tabular text-right opacity-60">{formatDuration(row.ms)}</span>
                  <span className="min-w-0">
                    {row.ok ? (
                      <Chip size="sm" color="success">
                        成功
                      </Chip>
                    ) : (
                      <Tooltip>
                        <Tooltip.Trigger>
                          <span className="inline-flex max-w-full items-center">
                            <Chip size="sm" color="danger">
                              失败
                            </Chip>
                          </span>
                        </Tooltip.Trigger>
                        <Tooltip.Content>{row.error ?? "未知错误"}</Tooltip.Content>
                      </Tooltip>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Card>
  );
}
