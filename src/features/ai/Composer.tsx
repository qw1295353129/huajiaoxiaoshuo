import { useEffect, type RefObject } from "react";
import { Button, Tooltip } from "@heroui/react";
import { CornerDownLeft, Send, Square } from "lucide-react";

/** 底部输入框：Enter 发送 / Shift+Enter 换行 */
export function Composer({
  value,
  onChange,
  onSubmit,
  onStop,
  busy,
  disabled,
  inputRef,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  busy: boolean;
  disabled?: boolean;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}) {
  // 自适应高度（最多 10 行）
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(220, el.scrollHeight) + "px";
  }, [value, inputRef]);

  return (
    <div
      className={
        "rounded-2xl border bg-white/70 p-2 transition dark:bg-white/[0.04] " +
        (busy ? "border-violet-500/40" : "border-black/8 dark:border-white/10")
      }
    >
      <textarea
        ref={inputRef}
        value={value}
        rows={2}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || e.shiftKey) return;
          // 中文输入法组词期间的回车不算发送
          if (e.nativeEvent.isComposing) return;
          e.preventDefault();
          if (!busy) onSubmit();
        }}
        placeholder="问点什么，或者让 AI 接着写……（Enter 发送，Shift+Enter 换行）"
        className="max-h-[220px] w-full resize-none bg-transparent px-1.5 py-1 text-sm leading-relaxed outline-none placeholder:opacity-40"
      />
      <div className="flex items-center justify-between gap-2 px-1">
        <span className="truncate text-[11px] opacity-40">
          {value.trim() ? value.trim().length + " 字" : "Ctrl/⌘ + Enter 也可发送"}
        </span>
        <div className="flex items-center gap-2">
          {busy ? (
            <Button size="sm" variant="danger-soft" onPress={onStop}>
              <Square className="size-3.5" />
              停止生成
            </Button>
          ) : (
            <Tooltip>
              <Tooltip.Trigger>
                <Button size="sm" variant="primary" isDisabled={disabled || !value.trim()} onPress={onSubmit}>
                  <Send className="size-3.5" />
                  发送
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content>
                <span className="inline-flex items-center gap-1">
                  <CornerDownLeft className="size-3" /> Enter 发送，Shift+Enter 换行
                </span>
              </Tooltip.Content>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  );
}
