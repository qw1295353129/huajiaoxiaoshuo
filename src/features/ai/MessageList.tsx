import { useState, type ReactNode } from "react";
import { Chip } from "@heroui/react";
import { Check, ChevronDown, ChevronRight, Copy, Sparkles } from "lucide-react";
import type { ChatMessage, ContextSource, ID } from "@/core";
import { useAppStore } from "@/app/store";
import { formatDuration } from "@/utils/format";
import { formatTokens } from "@/utils/tokens";
import { Markdown } from "./Markdown";
import { SOURCE_KIND_LABELS, fallbackSources, type RunMeta } from "./meta";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 transition hover:opacity-100"
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      }}
    >
      {copied ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
      {copied ? "已复制" : "复制"}
    </button>
  );
}

/** 助手消息下方的用量 / 引用来源（折叠展示） */
function AssistantFooter({
  message,
  meta,
  onInspect,
}: {
  message: ChatMessage;
  meta?: RunMeta;
  onInspect?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const sources: ContextSource[] = meta?.sources ?? fallbackSources(message.citations);
  const usage = message.usage;
  return (
    <div className="mt-1.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] opacity-55">
        <button
          type="button"
          className="inline-flex items-center gap-1 transition hover:opacity-100"
          onClick={() => {
            setOpen((v) => !v);
            onInspect?.();
          }}
        >
          {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          引用来源 {sources.length}
        </button>
        {usage && usage.total > 0 && (
          <span className="tabular">
            token {formatTokens(usage.prompt)} 入 / {formatTokens(usage.completion)} 出
          </span>
        )}
        {meta?.model && <span className="truncate">{meta.model}</span>}
        {meta && <span className="tabular">{formatDuration(meta.ms)}</span>}
        <CopyButton text={message.content} />
      </div>

      {open && (
        <div className="mt-1.5 space-y-1 rounded-lg border border-black/5 bg-black/[0.02] p-2 dark:border-white/5 dark:bg-white/[0.03]">
          {sources.length === 0 ? (
            <p className="text-[11px] opacity-45">这一轮没有引用任何素材。</p>
          ) : (
            sources.map((source, i) => (
              <div key={i} className="flex items-center justify-between gap-2 text-[11px]">
                <span className="min-w-0 flex-1 truncate">
                  <span className="opacity-45">{SOURCE_KIND_LABELS[source.kind] ?? source.kind} · </span>
                  {source.label}
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  {source.trimmed && (
                    <Chip size="sm" color="warning">
                      截断
                    </Chip>
                  )}
                  <span className="tabular opacity-45">{source.tokens > 0 ? formatTokens(source.tokens) : "—"}</span>
                </span>
              </div>
            ))
          )}
          {meta?.error && <p className="pt-1 text-[11px] leading-relaxed text-rose-500">{meta.error}</p>}
        </div>
      )}
    </div>
  );
}

/** 消息列表 + 流式打字气泡 */
export function MessageList({
  messages,
  streamText,
  reasoning,
  meta,
  empty,
  onInspect,
}: {
  messages: ChatMessage[];
  streamText?: string | null;
  reasoning?: string;
  meta: Record<ID, RunMeta>;
  empty: ReactNode;
  onInspect?: (id: ID) => void;
}) {
  const notify = useAppStore((s) => s.notify);

  if (messages.length === 0 && !streamText) return <>{empty}</>;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      {messages.map((message) => {
        if (message.role === "system") return null;
        const isUser = message.role === "user";
        return (
          <div key={message.id} className={isUser ? "flex justify-end" : "flex justify-start"}>
            <div className={"min-w-0 " + (isUser ? "max-w-[85%]" : "w-full")}>
              {isUser ? (
                <div className="rounded-2xl rounded-br-md bg-violet-500/10 px-3.5 py-2.5 text-sm whitespace-pre-wrap text-violet-900 dark:text-violet-100">
                  {message.content}
                </div>
              ) : (
                <div className="w-full">
                  <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium opacity-50">
                    <Sparkles className="size-3" />
                    创作助手
                  </div>
                  <div
                    className={
                      "rounded-2xl rounded-bl-md border px-3.5 py-2.5 text-sm " +
                      (message.error
                        ? "border-rose-500/30 bg-rose-500/[0.06]"
                        : "border-black/5 bg-white/70 dark:border-white/5 dark:bg-white/[0.04]")
                    }
                  >
                    <Markdown text={message.content} />
                  </div>
                  <AssistantFooter message={message} meta={meta[message.id]} onInspect={() => onInspect?.(message.id)} />
                </div>
              )}
            </div>
          </div>
        );
      })}

      {streamText !== null && streamText !== undefined && (
        <div className="flex justify-start">
          <div className="w-full">
            <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium opacity-50">
              <Sparkles className="size-3 animate-pulse" />
              创作助手 · 正在生成
            </div>
            <div className="rounded-2xl rounded-bl-md border border-violet-500/20 bg-white/70 px-3.5 py-2.5 text-sm dark:bg-white/[0.04]">
              {reasoning ? (
                <details className="mb-2">
                  <summary className="cursor-pointer text-[11px] opacity-50">思考过程</summary>
                  <p className="mt-1 text-xs leading-relaxed whitespace-pre-wrap opacity-60">{reasoning}</p>
                </details>
              ) : null}
              {streamText ? (
                <Markdown text={streamText} />
              ) : (
                <span className="text-xs opacity-50">正在等待模型响应…</span>
              )}
              <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse rounded-sm bg-violet-500 align-text-bottom" />
            </div>
            <div className="mt-1.5 flex items-center gap-3 text-[11px] opacity-45">
              <button
                type="button"
                className="transition hover:opacity-100"
                onClick={() => void navigator.clipboard?.writeText(streamText)}
              >
                复制当前内容
              </button>
              <button
                type="button"
                className="transition hover:opacity-100"
                onClick={() => notify("info", "生成结束后会自动保存", "中途取消不会丢失已经写出的内容")}
              >
                说明
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
