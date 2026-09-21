import { useMemo, useState } from "react";
import { Button, Chip, TextArea } from "@heroui/react";
import {
  Check, CheckCheck, CornerDownRight, MessageSquarePlus,
  Send, Trash2, Undo2, X, Sparkles, MessageSquare, ListChecks, ScanEye,
} from "lucide-react";
import type { ChapterComment, ID, ReviewSuggestion } from "@/core";
import { BUILTIN_CHECKLIST } from "@/core";
import { useAppStore } from "@/app/store";
import { useLiveQuery } from "dexie-react-hooks";
import {
  addComment, addReply, deleteComment, deleteResolvedComments, listComments,
  listReviewSuggestions, markReviewSuggestion, reviewStats, toggleCommentResolved,
} from "@/db/repo/review";
import { locateAnchor, makeAnchor } from "@/utils/anchor";
import { countWords } from "@/utils/text";
import { formatRelative } from "@/utils/format";
import { verifyChecklist } from "@/ai/review";

interface Props {
  projectId: ID;
  chapterId: ID;
  /** 当前正文纯文本，用于生成锚点与定位 */
  text: string;
  /** 编辑器里的当前选区（纯文本偏移） */
  selection: { text: string; from: number; to: number } | null;
  onClose: () => void;
  onJumpTo: (from: number, to: number) => void;
  onAcceptSuggestion: (id: ID) => void;
  onRejectSuggestion: (id: ID) => void;
  onAcceptAll: () => void;
}

type Tab = "comments" | "suggestions" | "checklist";

/**
 * 审稿面板：批注 / 修订建议 / 审稿清单。
 * 与 AI 面板并列，作者和编辑可以在同一屏里讨论与修改。
 */
export function CommentPanel({
  projectId, chapterId, text, selection, onClose, onJumpTo,
  onAcceptSuggestion, onRejectSuggestion, onAcceptAll,
}: Props) {
  const notify = useAppStore((s) => s.notify);
  const [tab, setTab] = useState<Tab>("comments");
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<ID | null>(null);
  const [replyText, setReplyText] = useState("");
  const [checking, setChecking] = useState(false);
  const [withSelection, setWithSelection] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const comments = useLiveQuery(() => listComments(chapterId), [chapterId], [] as ChapterComment[]);
  const suggestions = useLiveQuery(() => listReviewSuggestions(chapterId), [chapterId], [] as ReviewSuggestion[]);
  const stats = useLiveQuery(() => reviewStats(chapterId), [chapterId], undefined);

  // 评论锚点在正文里的实时定位结果
  const located = useMemo(() => {
    const map = new Map<ID, { from: number; to: number } | null>();
    for (const c of comments) {
      if (!c.anchor) continue;
      const hit = locateAnchor(text, c.anchor);
      map.set(c.id, hit ? { from: hit.from, to: hit.to } : null);
    }
    return map;
  }, [comments, text]);

  const pending = suggestions.filter((s) => s.status === "pending");

  const submitComment = async () => {
    const body = draft.trim();
    if (!body) return;
    const anchor =
      withSelection && selection && selection.text.trim()
        ? makeAnchor(text, selection.from, selection.to)
        : undefined;
    await addComment({ projectId, chapterId, body, anchor, kind: "note" });
    setDraft("");
    notify("success", anchor ? "已添加批注（锚定到选中文字）" : "已添加整章批注");
  };

  const runChecklist = async () => {
    setChecking(true);
    try {
      const res = await verifyChecklist({ projectId, chapterId, text });
      if (!res.ok) {
        notify("danger", "AI 审稿失败", res.error);
        return;
      }
      let added = 0;
      for (const item of res.items) {
        if (item.pass) continue;
        const anchor = item.quote ? locateAnchor(text, { from: 0, to: 0, quote: item.quote }) : null;
        await addComment({
          projectId, chapterId, body: item.comment, kind: "checklist", checklistLabel: item.label,
          anchor: anchor ? makeAnchor(text, anchor.from, anchor.to) : undefined,
        });
        added += 1;
      }
      notify(added ? "success" : "info", added ? "AI 审稿发现 " + added + " 处问题" : "AI 审稿通过，没有发现问题");
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="flex h-full w-[380px] flex-col border-l border-black/5 dark:border-white/5">
      <div className="flex shrink-0 items-center justify-between border-b border-black/5 px-4 py-3 dark:border-white/5">
        <div className="flex items-center gap-2">
          <ScanEye className="size-4 text-amber-500" />
          <span className="text-sm font-medium">审稿</span>
          {stats && (stats.openComments > 0 || stats.pendingSuggestions > 0) && (
            <Chip size="sm" color="warning">
              {stats.openComments + stats.pendingSuggestions} 待处理
            </Chip>
          )}
        </div>
        <Button isIconOnly size="sm" variant="ghost" onPress={onClose}>
          <X className="size-4" />
        </Button>
      </div>

      <div className="flex shrink-0 gap-1 border-b border-black/5 px-3 py-2 dark:border-white/5">
        {([
          ["comments", "批注 " + (stats?.openComments ?? 0), MessageSquare],
          ["suggestions", "修订 " + (stats?.pendingSuggestions ?? 0), CheckCheck],
          ["checklist", "清单", ListChecks],
        ] as [Tab, string, typeof MessageSquare][]).map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={
              "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs transition " +
              (tab === key ? "bg-black/[0.06] font-medium dark:bg-white/10" : "opacity-55 hover:opacity-100")
            }
          >
            <Icon className="size-3.5" />
            {label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {tab === "comments" && (
          <div className="space-y-3">
            {comments.length === 0 && (
              <p className="py-10 text-center text-xs leading-relaxed opacity-50">
                还没有批注。
                <br />
                在正文里选中一段文字，写下你的意见，它会被锚定到那句话上。
              </p>
            )}
            {comments.map((c) => {
              const hit = located.get(c.id);
              const isOpen = expanded[c.id] ?? false;
              return (
                <div
                  key={c.id}
                  className={
                    "rounded-xl border p-3 transition " +
                    (c.resolved
                      ? "border-black/5 opacity-55 dark:border-white/5"
                      : "border-amber-500/35 bg-amber-500/[0.04]")
                  }
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-medium">{c.author}</span>
                        {c.kind === "checklist" && (
                          <Chip size="sm" color="accent">
                            清单
                          </Chip>
                        )}
                        <span className="text-[10px] opacity-45">{formatRelative(c.createdAt)}</span>
                      </div>
                      {c.anchor && (
                        <button
                          type="button"
                          onClick={() => {
                            if (hit) onJumpTo(hit.from, hit.to);
                            else notify("warning", "这段原文已经找不到了", "正文改动较大，批注无法定位");
                          }}
                          className="mt-1.5 block max-w-full truncate rounded-md bg-black/[0.05] px-2 py-1 text-left text-[11px] italic transition hover:bg-black/[0.09] dark:bg-white/[0.07] dark:hover:bg-white/[0.12]"
                        >
                          「{c.anchor.quote}」
                          {!hit && <span className="ml-1 not-italic text-rose-500">（已失效）</span>}
                        </button>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <button
                        type="button"
                        title={c.resolved ? "重新打开" : "标记已解决"}
                        onClick={() => void toggleCommentResolved(c.id)}
                        className="rounded p-1 opacity-45 transition hover:opacity-100"
                      >
                        {c.resolved ? <Undo2 className="size-3" /> : <Check className="size-3" />}
                      </button>
                      <button
                        type="button"
                        title="删除批注"
                        onClick={() => void deleteComment(c.id)}
                        className="rounded p-1 opacity-40 transition hover:text-rose-500 hover:opacity-100"
                      >
                        <Trash2 className="size-3" />
                      </button>
                    </div>
                  </div>

                  <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed">{c.body}</p>

                  {c.replies.length > 0 && (
                    <div className="mt-2 space-y-1.5 border-l-2 border-black/8 pl-2.5 dark:border-white/10">
                      {c.replies.map((r) => (
                        <div key={r.id}>
                          <p className="text-[10px] opacity-50">
                            {r.author} · {formatRelative(r.createdAt)}
                          </p>
                          <p className="whitespace-pre-wrap text-[11px] leading-relaxed">{r.body}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {replyTo === c.id ? (
                    <div className="mt-2 flex items-center gap-1.5">
                      <input
                        autoFocus
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && replyText.trim()) {
                            void addReply(c.id, replyText).then(() => {
                              setReplyText("");
                              setReplyTo(null);
                            });
                          }
                          if (e.key === "Escape") setReplyTo(null);
                        }}
                        placeholder="回复…"
                        className="min-w-0 flex-1 rounded-md border border-black/10 bg-transparent px-2 py-1 text-[11px] outline-none dark:border-white/15"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (!replyText.trim()) return;
                          void addReply(c.id, replyText).then(() => {
                            setReplyText("");
                            setReplyTo(null);
                          });
                        }}
                        className="rounded p-1 opacity-60 hover:opacity-100"
                      >
                        <Send className="size-3" />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setReplyTo(c.id)}
                      className="mt-2 flex items-center gap-1 text-[11px] opacity-45 transition hover:opacity-90"
                    >
                      <CornerDownRight className="size-3" />
                      回复
                    </button>
                  )}
                </div>
              );
            })}
            {comments.some((c) => c.resolved) && (
              <Button
                size="sm"
                variant="ghost"
                fullWidth
                onPress={async () => {
                  const n = await deleteResolvedComments(chapterId);
                  notify("success", "已清理 " + n + " 条已解决批注");
                }}
              >
                <Trash2 className="size-3.5" />
                清理已解决的批注
              </Button>
            )}
          </div>
        )}

        {tab === "suggestions" && (
          <div className="space-y-3">
            {pending.length > 1 && (
              <Button size="sm" variant="primary" fullWidth onPress={onAcceptAll}>
                <CheckCheck className="size-3.5" />
                全部接受（{pending.length} 条）
              </Button>
            )}
            {suggestions.length === 0 && (
              <p className="py-10 text-center text-xs leading-relaxed opacity-50">
                还没有修订建议。
                <br />
                在正文里选中文字后，用「改成…」或让 AI 出修改方案，都会以建议形式排队，
                你逐条接受或拒绝，正文不会被直接改掉。
              </p>
            )}
            {suggestions.map((s) => (
              <div
                key={s.id}
                className={
                  "rounded-xl border p-3 " +
                  (s.status === "pending"
                    ? "border-emerald-500/35 bg-emerald-500/[0.04]"
                    : "border-black/5 opacity-55 dark:border-white/5")
                }
              >
                <div className="flex items-center gap-1.5">
                  <Chip size="sm" color={s.kind === "delete" ? "danger" : "success"}>
                    {s.kind === "replace" ? "替换" : s.kind === "delete" ? "删除" : "插入"}
                  </Chip>
                  {s.source === "ai" && (
                    <Chip size="sm" color="accent">
                      <Sparkles className="mr-0.5 inline size-2.5" />
                      AI
                    </Chip>
                  )}
                  <span className="text-[10px] opacity-45">
                    {s.author} · {formatRelative(s.createdAt)}
                  </span>
                  {s.status !== "pending" && (
                    <span className="ml-auto text-[10px] opacity-60">
                      {s.status === "accepted" ? "已接受" : "已拒绝"}
                    </span>
                  )}
                </div>

                {s.anchor.quote && (
                  <p className="mt-2 text-[11px] leading-relaxed">
                    <span className="hj-review-delete-chip">{s.anchor.quote}</span>
                    {s.kind !== "delete" && (
                      <>
                        <span className="mx-1 opacity-40">→</span>
                        <span className="hj-review-insert-chip">{s.proposed || "（空）"}</span>
                      </>
                    )}
                  </p>
                )}
                {s.kind === "insert" && !s.anchor.quote && (
                  <p className="mt-2 text-[11px] leading-relaxed">
                    <span className="hj-review-insert-chip">{s.proposed}</span>
                  </p>
                )}
                {s.reason && <p className="mt-1.5 text-[11px] leading-relaxed opacity-65">理由：{s.reason}</p>}

                {s.status === "pending" && (
                  <div className="mt-2.5 flex items-center gap-1.5">
                    <Button size="sm" variant="primary" onPress={() => onAcceptSuggestion(s.id)}>
                      <Check className="size-3.5" />
                      接受
                    </Button>
                    <Button size="sm" variant="outline" onPress={() => onRejectSuggestion(s.id)}>
                      <X className="size-3.5" />
                      拒绝</Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onPress={() => onJumpTo(s.anchor.from, s.anchor.to)}
                    >
                      定位
                    </Button>
                  </div>
                )}
                {s.status !== "pending" && (
                  <Button
                    className="mt-2"
                    size="sm"
                    variant="ghost"
                    onPress={() => void markReviewSuggestion(s.id, "pending")}
                  >
                    <Undo2 className="size-3" />
                    撤销决定
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}

        {tab === "checklist" && (
          <div className="space-y-4">
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.05] p-3">
              <p className="text-xs font-medium">AI 审稿</p>
              <p className="mt-1 text-[11px] leading-relaxed opacity-70">
                按下面的清单逐项检查本章，未通过的会变成批注锚定到具体句子，你可以逐条处理。
              </p>
              <Button
                className="mt-2.5"
                size="sm"
                variant="primary"
                isPending={checking}
                onPress={() => void runChecklist()}
              >
                <Sparkles className="size-3.5" />
                跑一遍审稿清单
              </Button>
            </div>

            <div className="space-y-1.5">
              <p className="text-[11px] font-medium opacity-60">清单项</p>
              {BUILTIN_CHECKLIST.filter((i) => i.perChapter || i.scope === "book").map((item) => {
                const hit = comments.filter((c) => c.checklistLabel === item.label);
                return (
                  <div key={item.id} className="rounded-lg bg-black/[0.03] px-2.5 py-2 dark:bg-white/[0.05]">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-medium">{item.label}</span>
                      {hit.length > 0 ? (
                        <Chip size="sm" color="warning">
                          {hit.length} 处
                        </Chip>
                      ) : (
                        <Chip size="sm" color="default">
                          未检查
                        </Chip>
                      )}
                    </div>
                    {item.hint && <p className="mt-0.5 text-[10px] leading-relaxed opacity-50">{item.hint}</p>}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {tab === "comments" && (
        <div className="shrink-0 space-y-2 border-t border-black/5 px-4 py-3 dark:border-white/5">
          {selection?.text.trim() && (
            <label className="flex cursor-pointer items-center gap-1.5 text-[11px] opacity-70">
              <input
                type="checkbox"
                checked={withSelection}
                onChange={(e) => setWithSelection(e.target.checked)}
                className="accent-amber-500"
              />
              锚定到选中文字「{selection.text.trim().slice(0, 16)}
              {selection.text.trim().length > 16 ? "…" : ""}」
            </label>
          )}
          <TextArea
            rows={3}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="写下批注…（⌘/Ctrl + Enter 提交）"
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void submitComment();
            }}
          />
          <div className="flex items-center justify-between">
            <span className="text-[10px] opacity-45">
              {text ? countWords(text).toLocaleString() + " 字" : "本章暂无正文"}
            </span>
            <Button size="sm" variant="primary" isDisabled={!draft.trim()} onPress={() => void submitComment()}>
              <MessageSquarePlus className="size-3.5" />
              添加批注
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

