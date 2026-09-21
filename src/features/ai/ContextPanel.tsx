import { useMemo } from "react";
import { Card, Chip, Tooltip } from "@heroui/react";
import { X } from "lucide-react";
import type { ContextSource } from "@/core";
import { EmptyHint } from "@/components/common/ui";
import { formatDuration, formatNumber } from "@/utils/format";
import { formatTokens } from "@/utils/tokens";
import { SOURCE_KIND_LABELS, type RunMeta } from "./meta";

/**
 * 引用面板：让作者看清这一轮 AI 到底读到了哪些素材、花了多少上下文预算。
 */
export function ContextPanel({
  meta,
  budget,
  onClose,
}: {
  meta?: RunMeta;
  budget: number;
  onClose: () => void;
}) {
  const groups = useMemo(() => {
    const map = new Map<ContextSource["kind"], ContextSource[]>();
    for (const source of meta?.sources ?? []) {
      const list = map.get(source.kind) ?? [];
      list.push(source);
      map.set(source.kind, list);
    }
    return Array.from(map, ([kind, list]) => ({ kind, list }));
  }, [meta]);

  const used = meta?.contextTokens ?? 0;
  const trimmed = (meta?.sources ?? []).filter((s) => s.trimmed).length;
  const percent = budget > 0 ? Math.min(100, (used / budget) * 100) : 0;

  return (
    <aside className="hidden w-72 shrink-0 flex-col overflow-y-auto border-l border-black/5 px-4 py-3 lg:flex dark:border-white/5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold tracking-tight">AI 看到了什么</p>
          <p className="mt-0.5 text-[11px] opacity-55">本轮的上下文来源清单</p>
        </div>
        <button
          type="button"
          aria-label="收起引用面板"
          onClick={onClose}
          className="rounded-md p-1 opacity-50 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
        >
          <X className="size-4" />
        </button>
      </div>

      {!meta ? (
        <EmptyHint
          title="还没有生成记录"
          description="发送一条消息后，这里会列出 AI 实际读到的章节、人物、世界观与规则。"
        />
      ) : (
        <div className="space-y-3">
          <Card className="space-y-2 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] opacity-55">使用模型</span>
              <span className="truncate text-[11px] font-medium" title={meta.model}>
                {meta.model || "未知"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] opacity-55">上下文</span>
              <span className="tabular text-[11px]">
                {formatNumber(used)} / {formatNumber(budget)} tokens
              </span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-black/[0.07] dark:bg-white/10">
              <div className="h-full rounded-full bg-neutral-900 transition-all" style={{ width: percent + "%" }} />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] opacity-55">耗时</span>
              <span className="tabular text-[11px]">{formatDuration(meta.ms)}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] opacity-55">状态</span>
              <Chip size="sm" color={meta.ok ? "success" : "danger"}>
                {meta.ok ? "成功" : "失败"}
              </Chip>
            </div>
            {!meta.ok && meta.error && (
              <p className="rounded-lg bg-rose-500/[0.08] p-2 text-[11px] leading-relaxed text-rose-600 dark:text-rose-300">
                {meta.error}
              </p>
            )}
          </Card>

          {trimmed > 0 && (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/[0.06] p-2 text-[11px] leading-relaxed opacity-80">
              有 {trimmed} 条素材因为超出预算被截断。想让它读得更全，可以在设置里调大上下文预算。
            </p>
          )}

          {groups.map((group) => {
            const tokens = group.list.reduce((sum, s) => sum + s.tokens, 0);
            return (
              <div key={group.kind}>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <p className="text-[11px] font-medium tracking-wide opacity-60">
                    {SOURCE_KIND_LABELS[group.kind] ?? group.kind}
                  </p>
                  <span className="tabular text-[11px] opacity-45">{formatTokens(tokens)}</span>
                </div>
                <ul className="space-y-1">
                  {group.list.map((source, i) => (
                    <li
                      key={group.kind + "-" + i}
                      className="flex items-start justify-between gap-2 rounded-lg border border-black/5 px-2 py-1.5 text-[11px] dark:border-white/5"
                    >
                      <span className="min-w-0 flex-1 leading-relaxed break-words">{source.label}</span>
                      <span className="flex shrink-0 items-center gap-1">
                        {source.trimmed && (
                          <Tooltip>
                            <Tooltip.Trigger>
                              <Chip size="sm" color="warning">
                                截断
                              </Chip>
                            </Tooltip.Trigger>
                            <Tooltip.Content>因为超出上下文预算被截断</Tooltip.Content>
                          </Tooltip>
                        )}
                        <span className="tabular opacity-45">{source.tokens > 0 ? formatTokens(source.tokens) : "—"}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}

          <p className="pt-1 text-[11px] leading-relaxed opacity-45">
            预算与板块来自「设置 → 上下文」。生成记录会保存在本地，可在「AI 用量」页查看。
          </p>
        </div>
      )}
    </aside>
  );
}
