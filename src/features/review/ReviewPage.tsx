import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Card, Chip } from "@heroui/react";
import { ArrowRight, Check, CheckCheck, ExternalLink, GitBranch, MessageSquare, ScanEye, Sparkles, X } from "lucide-react";
import type { ChapterComment, ID, ReviewSuggestion } from "@/core";
import { PageScaffold } from "@/components/common/PageScaffold";
import { EmptyHint, SectionTitle, StatCard } from "@/components/common/ui";
import { ROUTES } from "@/app/routes";
import { useAppStore } from "@/app/store";
import { useChapters, useDebounced } from "@/app/hooks";
import { useLiveQuery } from "dexie-react-hooks";
import {
  listProjectComments, listProjectReviewSuggestions, markReviewSuggestion, toggleCommentResolved,
} from "@/db/repo/review";
import { addComment } from "@/db/repo/review";

import { verifyChecklist } from "@/ai/review";
import { formatRelative } from "@/utils/format";

type Tab = "comments" | "suggestions";

/**
 * 项目级审稿台：跨章节汇总所有批注与修订建议。
 * 适用场景：编辑通读全书后统一给意见，作者在写作台里逐条处理。
 */
export function ReviewPage() {
  const { projectId = "" } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const project = useAppStore((s) => s.project);
  const notify = useAppStore((s) => s.notify);
  const chapters = useChapters(projectId);
  const [tab, setTab] = useState<Tab>("comments");
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query, 220);
  const [running, setRunning] = useState(false);

  const comments = useLiveQuery(() => listProjectComments(projectId), [projectId], [] as ChapterComment[]);
  const suggestions = useLiveQuery(() => listProjectReviewSuggestions(projectId), [projectId], [] as ReviewSuggestion[]);

  const chapterTitle = useMemo(() => {
    const map = new Map(chapters.map((c) => [c.id, c]));
    return (id: ID) => map.get(id);
  }, [chapters]);

  const filteredComments = useMemo(() => {
    const q = debounced.trim().toLowerCase();
    return comments
      .filter((c) => (q ? c.body.toLowerCase().includes(q) || c.anchor?.quote.toLowerCase().includes(q) : true))
      .sort((a, b) => {
        const ca = chapterTitle(a.chapterId)?.order ?? 0;
        const cb = chapterTitle(b.chapterId)?.order ?? 0;
        return ca - cb || (a.createdAt < b.createdAt ? -1 : 1);
      });
  }, [comments, debounced, chapterTitle]);

  const filteredSuggestions = useMemo(() => {
    const q = debounced.trim().toLowerCase();
    return suggestions
      .filter((s) =>
        q ? s.proposed.toLowerCase().includes(q) || (s.reason ?? "").toLowerCase().includes(q) || s.anchor.quote.toLowerCase().includes(q) : true,
      )
      .sort((a, b) => {
        const ca = chapterTitle(a.chapterId)?.order ?? 0;
        const cb = chapterTitle(b.chapterId)?.order ?? 0;
        return ca - cb || a.anchor.from - b.anchor.from;
      });
  }, [suggestions, debounced, chapterTitle]);

  const openComments = comments.filter((c) => !c.resolved);
  const pendingSuggestions = suggestions.filter((s) => s.status === "pending");

  /** 整本跑一遍 AI 审稿清单，把未通过的项落成批注 */
  const runWholeBook = async () => {
    const targets = chapters.filter((c) => c.wordCount > 200);
    if (!targets.length) {
      notify("warning", "还没有可审的章节", "至少写满 200 字的章节才会进入审稿");
      return;
    }
    setRunning(true);
    let added = 0;
    let failed = 0;
    try {
      for (const ch of targets) {
        const res = await verifyChecklist({ projectId, chapterId: ch.id });
        if (!res.ok) {
          failed += 1;
          continue;
        }
        const text = "";
        void text;
        for (const item of res.items) {
          if (item.pass) continue;
          await addComment({
            projectId,
            chapterId: ch.id,
            body: item.comment,
            kind: "checklist",
            checklistLabel: item.label,
          });
          added += 1;
        }
      }
      notify(
        added ? "success" : "info",
        added ? "整本审稿完成，发现 " + added + " 处问题" : "整本审稿通过",
        failed ? failed + " 章因模型报错被跳过" : undefined,
      );
    } finally {
      setRunning(false);
    }
  };

  /** 跳到写作台并定位到这条批注/建议所在的句子 */
  const openInEditor = async (chapterId: ID, from?: number, to?: number) => {
    const ch = chapterTitle(chapterId);
    if (!ch) return;
    const content = await (await import("@/db/repo/outline")).getChapterContent(chapterId);
    const text = content?.text ?? "";
    const offset = from !== undefined && to !== undefined ? { from, to } : { from: 0, to: 0 };
    void text;
    void offset;
    // 用 query 传位置，写作台会把它转成选区（与一致性报告的工单机制一致）
    const params = new URLSearchParams();
    if (from !== undefined && to !== undefined) {
      params.set("from", String(from));
      params.set("to", String(to));
    }
    navigate(ROUTES.write(projectId, chapterId) + (params.toString() ? "?" + params.toString() : ""));
  };

  return (
    <PageScaffold
      title="审稿台"
      description={project ? project.title + " · 跨章节汇总批注与修订建议" : undefined}
      actions={
        <>
          <Button size="sm" variant="outline" isPending={running} onPress={() => void runWholeBook()}>
            <Sparkles className="size-3.5" />
            整本 AI 审稿
          </Button>
          <Button size="sm" variant="ghost" onPress={() => navigate(ROUTES.write(projectId))}>
            <ExternalLink className="size-3.5" />
            去写作台
          </Button>
        </>
      }
    >
      <div className="mb-5 grid gap-3 sm:grid-cols-4">
        <StatCard label="待处理批注" value={openComments.length} hint={"共 " + comments.length + " 条"} icon={<MessageSquare className="size-4" />} tone="warning" />
        <StatCard label="待确认修订" value={pendingSuggestions.length} hint={"共 " + suggestions.length + " 条"} icon={<CheckCheck className="size-4" />} tone="accent" />
        <StatCard label="已解决批注" value={comments.length - openComments.length} icon={<Check className="size-4" />} tone="success" />
        <StatCard label="已处理修订" value={suggestions.length - pendingSuggestions.length} icon={<GitBranch className="size-4" />} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {([
          ["comments", "批注", MessageSquare],
          ["suggestions", "修订建议", CheckCheck],
        ] as [Tab, string, typeof MessageSquare][]).map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition " +
              (tab === key ? "bg-black/[0.06] font-medium dark:bg-white/10" : "opacity-60 hover:opacity-100")
            }
          >
            <Icon className="size-3.5" />
            {label}
          </button>
        ))}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索批注内容或引用原文"
          className="ml-auto w-56 rounded-lg border border-black/10 bg-transparent px-3 py-1.5 text-sm outline-none dark:border-white/15"
        />
      </div>

      {tab === "comments" && (
        <div className="space-y-3">
          {filteredComments.length === 0 && (
            <EmptyHint
              icon={<ScanEye className="size-7" />}
              title="还没有批注"
              description="在写作台里选中正文写批注，或点右上角「整本 AI 审稿」按退稿高频问题扫一遍。"
            />
          )}
          {filteredComments.map((c) => {
            const ch = chapterTitle(c.chapterId);
            return (
              <Card key={c.id} className="p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Chip size="sm" color={c.resolved ? "default" : "warning"}>
                    {c.resolved ? "已解决" : "待处理"}
                  </Chip>
                  <span className="text-xs font-medium">第 {(ch?.order ?? 0) + 1} 章 {ch?.title ?? "（已删除）"}</span>
                  {c.kind === "checklist" && c.checklistLabel && (
                    <Chip size="sm" color="accent">
                      {c.checklistLabel}
                    </Chip>
                  )}
                  <span className="ml-auto text-[11px] opacity-45">
                    {c.author} · {formatRelative(c.createdAt)}
                  </span>
                </div>
                {c.anchor?.quote && (
                  <p className="mt-2 rounded-md bg-black/[0.04] px-2.5 py-1.5 text-[11px] italic dark:bg-white/[0.06]">
                    「{c.anchor.quote}」
                  </p>
                )}
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{c.body}</p>
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <Button size="sm" variant="outline" onPress={() => void openInEditor(c.chapterId, c.anchor?.from, c.anchor?.to)}>
                    <ExternalLink className="size-3.5" />
                    定位到原文
                  </Button>
                  <Button size="sm" variant="ghost" onPress={() => void toggleCommentResolved(c.id)}>
                    {c.resolved ? <X className="size-3.5" /> : <Check className="size-3.5" />}
                    {c.resolved ? "重新打开" : "标记已解决"}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {tab === "suggestions" && (
        <div className="space-y-3">
          {filteredSuggestions.length === 0 && (
            <EmptyHint
              icon={<CheckCheck className="size-7" />}
              title="还没有修订建议"
              description="在写作台选中文字后用 AI 改写，再点「加入修订建议」，就会出现在这里等待确认。"
            />
          )}
          {filteredSuggestions.map((s) => {
            const ch = chapterTitle(s.chapterId);
            return (
              <Card key={s.id} className="p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Chip size="sm" color={s.status === "pending" ? (s.kind === "delete" ? "danger" : "success") : "default"}>
                    {s.kind === "replace" ? "替换" : s.kind === "delete" ? "删除" : "插入"}
                  </Chip>
                  {s.source === "ai" && (
                    <Chip size="sm" color="accent">
                      AI
                    </Chip>
                  )}
                  <span className="text-xs font-medium">第 {(ch?.order ?? 0) + 1} 章 {ch?.title ?? "（已删除）"}</span>
                  <span className="ml-auto text-[11px] opacity-45">
                    {s.status === "pending" ? "待确认" : s.status === "accepted" ? "已接受" : "已拒绝"} · {formatRelative(s.createdAt)}
                  </span>
                </div>
                <p className="mt-2 text-xs leading-relaxed">
                  {s.anchor.quote && <span className="hj-review-delete-chip">{s.anchor.quote}</span>}
                  {s.kind !== "delete" && (
                    <>
                      <span className="mx-1 opacity-40">→</span>
                      <span className="hj-review-insert-chip">{s.proposed || "（空）"}</span>
                    </>
                  )}
                </p>
                {s.reason && <p className="mt-1.5 text-[11px] opacity-65">理由：{s.reason}</p>}
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <Button size="sm" variant="outline" onPress={() => void openInEditor(s.chapterId, s.anchor.from, s.anchor.to)}>
                    <ExternalLink className="size-3.5" />
                    到写作台处理
                    <ArrowRight className="size-3.5" />
                  </Button>
                  {s.status === "pending" && (
                    <>
                      <Button size="sm" variant="ghost" onPress={() => void markReviewSuggestion(s.id, "rejected")}>
                        <X className="size-3.5" />
                        拒绝</Button>
                    </>
                  )}
                  {s.status !== "pending" && (
                    <Button size="sm" variant="ghost" onPress={() => void markReviewSuggestion(s.id, "pending")}>
                      撤销决定
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <div className="mt-6">
        <SectionTitle hint="审稿时优先看这几章">还没处理的章节</SectionTitle>
        <div className="flex flex-wrap gap-1.5">
          {chapters
            .filter((c) => c.wordCount > 0 && !comments.some((x) => x.chapterId === c.id && !x.resolved))
            .slice(0, 12)
            .map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => navigate(ROUTES.write(projectId, c.id))}
                className="rounded-md bg-black/[0.04] px-2 py-1 text-[11px] opacity-70 transition hover:opacity-100 dark:bg-white/[0.06]"
              >
                {c.title}
              </button>
            ))}
          {chapters.filter((c) => c.wordCount > 0).length === 0 && (
            <p className="text-xs opacity-50">还没有写正文的章节</p>
          )}
        </div>
      </div>

    </PageScaffold>
  );
}