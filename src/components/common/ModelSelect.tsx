import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Chip } from "@heroui/react";
import { Check, ChevronDown, Search, X } from "lucide-react";

/**
 * 模型选择器：按钮 + 带搜索的弹窗。
 *
 * ## 为什么不用原生 select
 *
 * 原生 `<select>` 的展开宽度**由控件自身宽度决定**，而模型名（如
 * `deepseek-ai/DeepSeek-V3`、`Qwen/Qwen2.5-72B-Instruct`）远长于容器，
 * 于是列表里全被截断 —— 用户反馈"模型显示不全"。
 * 弹窗可以做到正文宽度，且能搜索：模型多了以后滚列表找也很痛苦。
 *
 * ## 过滤与手填
 *
 * `filter` 用于"只显示向量模型"这类场景。**过滤后仍然允许手填** ——
 * 名字里不带 embed 的向量模型是存在的，一律挡掉会让人无法使用；
 * 手填入口放在列表底部，并明确提示"不在列表里也可以直接填"。
 */
export function ModelSelect({
  value,
  options,
  onChange,
  placeholder = "选择模型",
  title = "选择模型",
  filter,
  filterHint,
  allowCustom = true,
  disabled,
  className,
}: {
  value: string;
  options: string[];
  onChange: (name: string) => void;
  placeholder?: string;
  title?: string;
  /** 只显示满足条件的模型（例如只显示向量模型） */
  filter?: (name: string) => boolean;
  /** 被过滤掉时显示的说明，告诉用户"其余模型为什么不见了" */
  filterHint?: string;
  allowCustom?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [custom, setCustom] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const shown = useMemo(() => {
    const base = filter ? options.filter(filter) : options;
    const q = query.trim().toLowerCase();
    return q ? base.filter((m) => m.toLowerCase().includes(q)) : base;
  }, [options, filter, query]);

  const hiddenCount = useMemo(() => {
    if (!filter) return 0;
    return options.filter((m) => !filter(m)).length;
  }, [options, filter]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setCustom("");
    const t = window.setTimeout(() => inputRef.current?.focus(), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (name: string) => {
    onChange(name);
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={
          "flex min-w-0 items-center justify-between gap-2 rounded-lg border border-black/10 px-2 py-1.5 text-left text-xs transition hover:border-black/25 disabled:opacity-50 dark:border-white/15 dark:hover:border-white/30 " +
          (className ?? "w-full")
        }
      >
        {/* 完整显示当前值，不截断成省略号 —— 这正是要解决的问题 */}
        <span className={"min-w-0 break-all " + (value ? "" : "opacity-50")}>{value || placeholder}</span>
        <ChevronDown className="size-3.5 shrink-0 opacity-50" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[300] flex items-start justify-center bg-black/40 p-4 pt-[12vh] backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-neutral-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-black/5 px-5 py-3 dark:border-white/5">
              <h3 className="text-sm font-semibold">{title}</h3>
              <Button isIconOnly size="sm" variant="ghost" aria-label="关闭" onPress={() => setOpen(false)}>
                <X className="size-4" />
              </Button>
            </div>

            <div className="shrink-0 px-5 pt-3">
              <div className="flex items-center gap-2 rounded-lg border border-black/10 px-2.5 py-1.5 dark:border-white/15">
                <Search className="size-3.5 shrink-0 opacity-40" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索模型…"
                  className="w-full bg-transparent text-xs outline-none placeholder:opacity-40"
                />
                {query && (
                  <button type="button" onClick={() => setQuery("")} aria-label="清空搜索">
                    <X className="size-3.5 opacity-40" />
                  </button>
                )}
              </div>
              {filterHint && hiddenCount > 0 && (
                <p className="mt-1.5 text-[10px] opacity-50">
                  {filterHint}（已隐藏 {hiddenCount} 个非向量模型）
                </p>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
              {shown.length === 0 ? (
                <p className="px-2 py-6 text-center text-xs opacity-50">
                  {options.length === 0 ? "该供应商还没有模型列表，可在下方直接填写" : "没有匹配的模型"}
                </p>
              ) : (
                <ul className="space-y-0.5">
                  {shown.map((m) => (
                    <li key={m}>
                      <button
                        type="button"
                        onClick={() => pick(m)}
                        className={
                          "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition hover:bg-black/5 dark:hover:bg-white/10 " +
                          (m === value ? "bg-black/[0.06] font-medium dark:bg-white/10" : "")
                        }
                      >
                        <Check className={"size-3.5 shrink-0 " + (m === value ? "opacity-80" : "opacity-0")} />
                        {/* break-all：长模型名在弹窗里也完整显示，不截断 */}
                        <span className="min-w-0 break-all">{m}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {allowCustom && (
              <div className="shrink-0 border-t border-black/5 px-5 py-3 dark:border-white/5">
                <p className="mb-1.5 text-[10px] opacity-55">
                  不在列表里也可以直接填（有些向量模型的名称不含 embed 字样）
                </p>
                <div className="flex items-center gap-2">
                  <input
                    value={custom}
                    onChange={(e) => setCustom(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && custom.trim()) pick(custom.trim());
                    }}
                    placeholder="手动输入模型名"
                    className="min-w-0 flex-1 rounded-lg border border-black/10 bg-transparent px-2 py-1.5 text-xs outline-none dark:border-white/15"
                  />
                  <Button size="sm" variant="outline" isDisabled={!custom.trim()} onPress={() => pick(custom.trim())}>
                    使用
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/**
 * 判断一个模型名是不是向量（embedding）模型。
 *
 * 各家命名不统一，所以按关键词匹配常见系列：
 * OpenAI 的 text-embedding-*、BGE、GTE、E5、Nomic、Jina、Voyage、
 * 以及 Ollama 上的 mxbai / snowflake-arctic-embed 等。
 *
 * **只用于"列表默认过滤"，不用于阻止手填** —— 关键词一定会有漏网，
 * 挡死了反而让人没法用。
 */
const EMBEDDING_PATTERN =
  /embed|bge[-_/]|\bgte\b|gte[-_/]|\be5\b|e5[-_/]|nomic|jina|voyage|mxbai|arctic-embed|text-similarity|paraphrase/i;

export function looksLikeEmbeddingModel(name: string): boolean {
  return EMBEDDING_PATTERN.test(name);
}
