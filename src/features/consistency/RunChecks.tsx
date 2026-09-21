import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Card, Chip } from "@heroui/react";
import {
  AlertTriangle, ArrowUpRight, Ban, BookOpen, Hammer, ListChecks, Play, Settings2, ShieldCheck, Sparkles, Waves, Zap,
} from "lucide-react";
import type { Chapter, ID, Issue } from "@/core";
import {
  checkConsistency, checkVoice, fullChapterReview, localAudit, persistLocalAudit,
  type ConsistencyOutput,
} from "@/ai/analysis";
import { upsertIssue } from "@/db/repo/story";
import { EmptyHint, Loading, Progress, SectionTitle, SeverityChip } from "@/components/common/ui";
import { ROUTES } from "@/app/routes";
import { useAppStore } from "@/app/store";
import { useOpenSettings } from "@/app/useOpenSettings";
import { KIND_LABELS, fmtInt } from "./helpers";

/** 单章检查时轮换的进度文案（模型调用没有真实分片进度，用阶段感替代） */
const STAGES = ["组装上下文（人物 / 世界观 / 伏笔 / 前文脉络）…", "检索相关设定片段…", "模型正在逐段比对前后矛盾…", "整理问题清单与原文证据…"];

const STEP_STYLE = "rounded-lg border border-black/5 px-3 py-2 text-xs dark:border-white/5";

/** AI 未配置等错误提示：错误信息里已带「设置 → 模型与 AI」引导 */
function ErrorNote({ text }: { text: string }) {
  const openSettings = useOpenSettings();
  return (
    <div className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/[0.07] px-3 py-2.5 text-xs leading-relaxed">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-rose-500" />
      <div className="min-w-0 flex-1">
        <p>{text}</p>
        <Button className="mt-2" variant="outline" size="sm" onPress={() => openSettings("models")}>
          <Settings2 className="size-3.5" />
          打开设置
        </Button>
      </div>
    </div>
  );
}

/** 新建问题的紧凑列表 */
function CreatedList({ projectId, issues, chapters }: { projectId: ID; issues: Issue[]; chapters: Chapter[] }) {
  const navigate = useNavigate();
  const chapterMap = useMemo(() => new Map(chapters.map((c) => [c.id, c])), [chapters]);
  if (!issues.length) return <p className="text-xs opacity-50">没有新增问题。</p>;
  return (
    <ul className="max-h-72 space-y-1.5 overflow-y-auto">
      {issues.map((i) => (
        <li key={i.id}>
          <button
            type="button"
            onClick={() => i.chapterId && navigate(ROUTES.write(projectId, i.chapterId))}
            className="flex w-full items-center gap-2 rounded-lg border border-black/5 px-2.5 py-2 text-left text-xs transition hover:bg-black/[0.03] dark:border-white/5 dark:hover:bg-white/[0.04]"
          >
            <SeverityChip severity={i.severity} />
            <span className="min-w-0 flex-1 truncate">{i.title}</span>
            <span className="shrink-0 opacity-45">
              {i.chapterId ? "第" + ((chapterMap.get(i.chapterId)?.order ?? 0) + 1) + "章" : "全书"}
            </span>
            <ArrowUpRight className="size-3 shrink-0 opacity-40" />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** 运行检查：单章 / 整本 / 本地体检 / 口吻 / 一键全流程 */
export function RunChecks({ projectId, chapters }: { projectId: ID; chapters: Chapter[] }) {
  const navigate = useNavigate();
  const openSettings = useOpenSettings();
  const notify = useAppStore((s) => s.notify);
  const ordered = useMemo(() => chapters.slice().sort((a, b) => a.order - b.order), [chapters]);
  const [chapterId, setChapterId] = useState<ID>("");

  const [single, setSingle] = useState<{ running: boolean; error?: string; result?: ConsistencyOutput; created: Issue[] }>({
    running: false,
    created: [],
  });
  const [seconds, setSeconds] = useState(0);

  const [book, setBook] = useState<{ running: boolean; done: number; total: number; created: number; errors: string[]; current: string; aborted: boolean }>({
    running: false, done: 0, total: 0, created: 0, errors: [], current: "", aborted: false,
  });

  const [local, setLocal] = useState<{ running: boolean; created?: Issue[]; error?: string }>({ running: false });
  const [voice, setVoice] = useState<{ running: boolean; error?: string; note?: string; created?: Issue[] }>({ running: false });
  const [full, setFull] = useState<{ running: boolean; stage: string; steps?: { stage: string; ok: boolean; count?: number; error?: string }[] }>({
    running: false, stage: "",
  });

  const abortRef = useRef<AbortController | null>(null);
  const busy = single.running || book.running || local.running || voice.running || full.running;

  useEffect(() => {
    if (!chapterId && ordered.length) setChapterId(ordered[0].id);
    if (chapterId && ordered.length && !ordered.some((c) => c.id === chapterId)) setChapterId(ordered[0].id);
  }, [ordered, chapterId]);

  // 单章检查的秒表（用于阶段文案与耗时提示）
  useEffect(() => {
    if (!single.running) return;
    setSeconds(0);
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [single.running]);

  const chapterLabel = useCallback(
    (id: ID) => {
      const c = ordered.find((x) => x.id === id);
      return c ? "第" + (c.order + 1) + "章 " + c.title : "本章";
    },
    [ordered],
  );

  /** 单章一致性检查 */
  const runSingle = useCallback(async () => {
    if (!chapterId) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setSingle({ running: true, created: [] });
    try {
      const res = await checkConsistency({ projectId, chapterId, signal: ctrl.signal });
      if (!res.ok) {
        setSingle({ running: false, error: res.error ?? "检查失败", created: [] });
        notify("danger", "一致性检查未完成", res.error);
        return;
      }
      setSingle({ running: false, created: res.issues, result: res });
      notify("success", "一致性检查完成", chapterLabel(chapterId) + " · 新增 " + res.issues.length + " 条问题");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSingle({ running: false, error: msg, created: [] });
      notify("danger", "一致性检查失败", msg);
    }
  }, [projectId, chapterId, notify, chapterLabel]);

  /** 整本逐章检查（可中断） */
  const runBook = useCallback(async () => {
    if (!ordered.length) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBook({ running: true, done: 0, total: ordered.length, created: 0, errors: [], current: "", aborted: false });
    let created = 0;
    const errors: string[] = [];
    try {
      for (let i = 0; i < ordered.length; i++) {
        if (ctrl.signal.aborted) break;
        const ch = ordered[i];
        setBook((b) => ({ ...b, current: ch.title }));
        try {
          const res = await checkConsistency({ projectId, chapterId: ch.id, signal: ctrl.signal });
          if (res.ok) created += res.issues.length;
          else if (res.error) errors.push("第" + (ch.order + 1) + "章：" + res.error);
        } catch (e) {
          errors.push("第" + (ch.order + 1) + "章：" + (e instanceof Error ? e.message : String(e)));
        }
        setBook((b) => ({ ...b, done: i + 1, created, errors: errors.slice() }));
        // 让出主线程，保证进度刷新与中断按钮可响应
        await new Promise((r) => setTimeout(r, 0));
      }
      const aborted = ctrl.signal.aborted;
      setBook((b) => ({ ...b, running: false, created, errors: errors.slice(), aborted }));
      if (aborted) notify("info", "整本检查已中断", "已完成 " + created + " 条问题汇总");
      else notify(errors.length ? "warning" : "success", "整本检查完成", "新增 " + created + " 条问题" + (errors.length ? "，" + errors.length + " 章失败" : ""));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setBook((b) => ({ ...b, running: false, errors: [...errors, msg] }));
      notify("danger", "整本检查失败", msg);
    }
  }, [ordered, projectId, notify]);

  /** 本地体检（免费，不消耗 token） */
  const runLocal = useCallback(async () => {
    if (!chapterId) return;
    setLocal({ running: true });
    try {
      const audit = await localAudit(projectId, chapterId);
      if (!audit) {
        setLocal({ running: false, error: "章节还没有正文" });
        return;
      }
      const created = await persistLocalAudit(projectId, audit);
      setLocal({ running: false, created });
      notify("success", "本地体检完成", "新增 " + created.length + " 条问题");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLocal({ running: false, error: msg });
    }
  }, [projectId, chapterId, notify]);

  /** 口吻检查：结果落库为 character-voice 问题 */
  const runVoice = useCallback(async () => {
    if (!chapterId) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setVoice({ running: true });
    try {
      const res = await checkVoice(projectId, chapterId, ctrl.signal);
      if (!res.ok) {
        setVoice({ running: false, error: res.error ?? "口吻检查失败" });
        return;
      }
      const created: Issue[] = [];
      for (const d of res.deviations) {
        created.push(
          await upsertIssue({
            projectId,
            chapterId,
            kind: "character-voice",
            severity: "warn",
            title: d.character + " 的台词不像他本人",
            detail: d.why,
            evidence: { quote: d.quote },
            suggestion: d.suggested,
            source: "llm",
            detector: "llm-voice",
          }),
        );
      }
      setVoice({ running: false, created, note: res.note });
      notify("success", "口吻检查完成", "新增 " + created.length + " 条问题");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setVoice({ running: false, error: msg });
    }
  }, [projectId, chapterId, notify]);

  /** 一键全流程：本地体检 + 一致性 + 口吻 */
  const runFull = useCallback(async () => {
    if (!chapterId) return;
    setFull({ running: true, stage: "准备中…" });
    try {
      const steps = await fullChapterReview(projectId, chapterId, {
        llm: true,
        onProgress: (stage) => setFull((s) => ({ ...s, stage })),
      });
      setFull({ running: false, stage: "", steps });
      const failed = steps.filter((s) => !s.ok);
      notify(failed.length ? "warning" : "success", "全流程检查完成", steps.map((s) => s.stage + (s.ok ? " ✓" : " ✗")).join(" · "));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setFull({ running: false, stage: "", steps: [{ stage: "执行失败", ok: false, error: msg }] });
      notify("danger", "全流程检查失败", msg);
    }
  }, [projectId, chapterId, notify]);

  if (!ordered.length) {
    return (
      <EmptyHint
        icon={<BookOpen className="size-7" />}
        title="还没有章节"
        description="一致性检查需要先有章节正文：去大纲页建立章节结构，再到写作台写下内容。"
        action={
          <Button variant="primary" size="sm" onPress={() => navigate(ROUTES.outline(projectId))}>
            去大纲页
          </Button>
        }
      />
    );
  }

  const singleCreatedCount = single.created.length;

  return (
    <div className="space-y-5">
      <Card className="p-4">
        <SectionTitle
          hint="一致性 / 口吻检查需要模型；本地体检完全离线。检查会消耗 token，长章节更贵。"
          action={
            <div className="flex items-center gap-2">
              <select
                value={chapterId}
                onChange={(e) => setChapterId(e.target.value)}
                className="max-w-56 rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-xs dark:border-white/10 dark:bg-neutral-900"
              >
                {ordered.map((c) => (
                  <option key={c.id} value={c.id}>
                    第{c.order + 1}章 {c.title}
                  </option>
                ))}
              </select>
              {busy && (
                <Button variant="danger-soft" size="sm" onPress={() => abortRef.current?.abort()}>
                  <Ban className="size-4" />
                  中断
                </Button>
              )}
            </div>
          }
        >
          运行检查
        </SectionTitle>

        <div className="flex flex-wrap gap-2">
          <Button variant="primary" size="sm" isDisabled={busy} isPending={single.running} onPress={() => void runSingle()}>
            <ShieldCheck className="size-4" />
            本章一致性检查
          </Button>
          <Button variant="outline" size="sm" isDisabled={busy} isPending={local.running} onPress={() => void runLocal()}>
            <Zap className="size-4" />
            本地体检（免费）
          </Button>
          <Button variant="outline" size="sm" isDisabled={busy} isPending={voice.running} onPress={() => void runVoice()}>
            <Waves className="size-4" />
            口吻检查
          </Button>
          <Button variant="secondary" size="sm" isDisabled={busy} isPending={full.running} onPress={() => void runFull()}>
            <Hammer className="size-4" />
            一键全流程
          </Button>
          <Button className="ml-auto" variant="danger-soft" size="sm" isDisabled={busy} isPending={book.running} onPress={() => void runBook()}>
            <ListChecks className="size-4" />
            整本检查
          </Button>
        </div>

        {single.running && (
          <div className="mt-4 space-y-1.5">
            <p className="text-xs opacity-60">
              {STAGES[Math.min(STAGES.length - 1, Math.floor(seconds / 3))]}（{seconds}s）
            </p>
            <Progress value={Math.min(seconds, 12)} max={12} />
            <p className="text-[11px] opacity-45">{chapterLabel(chapterId)} · 模型正在工作，可以随时中断</p>
          </div>
        )}

        {book.running && (
          <div className="mt-4 space-y-1.5">
            <p className="text-xs opacity-60">
              正在检查第 {book.done + 1}/{book.total} 章：{book.current}
            </p>
            <Progress value={book.done} max={book.total} />
            <p className="text-[11px] opacity-45">已汇总 {fmtInt(book.created)} 条问题；中断后已完成的章节结果仍然保留。</p>
          </div>
        )}

        {full.running && (
          <div className="mt-4 flex items-center gap-2 text-xs opacity-60">
            <Loading label={"全流程执行中：" + full.stage} />
          </div>
        )}
      </Card>

      {/* 单章一致性检查结果 */}
      {(single.error || single.result) && (
        <Card className="p-4">
          <SectionTitle hint={single.result ? "由模型返回，已写入问题库（可在看板处理）" : undefined}>一致性检查结果</SectionTitle>
          {single.error ? (
            <ErrorNote text={single.error} />
          ) : single.result ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2 text-[11px] opacity-55">
                <Chip size="sm" color={singleCreatedCount ? "warning" : "success"}>
                  新增 {singleCreatedCount} 条
                </Chip>
                {single.result.model && <span>模型 {single.result.model}</span>}
                <span>耗时 {(single.result.ms / 1000).toFixed(1)}s</span>
                {single.result.promptTokens > 0 && <span>输入约 {fmtInt(single.result.promptTokens)} tokens</span>}
              </div>
              {singleCreatedCount === 0 ? (
                <p className="rounded-xl bg-emerald-500/[0.07] px-3 py-2 text-xs leading-relaxed">
                  模型没有发现可用原文支撑的矛盾，这一章是干净的。
                </p>
              ) : (
                <CreatedList projectId={projectId} issues={single.created} chapters={chapters} />
              )}
            </div>
          ) : null}
        </Card>
      )}

      {/* 整本检查汇总 */}
      {(book.done > 0 || book.errors.length > 0) && (
        <Card className="p-4">
          <SectionTitle hint={"已检查 " + book.done + "/" + book.total + " 章" + (book.aborted ? "（已中断）" : "")}>整本检查汇总</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className={STEP_STYLE}>
              <p className="opacity-55">新增问题</p>
              <p className="tabular mt-1 text-lg font-semibold">{fmtInt(book.created)}</p>
            </div>
            <div className={STEP_STYLE}>
              <p className="opacity-55">已检查章节</p>
              <p className="tabular mt-1 text-lg font-semibold">
                {book.done}/{book.total}
              </p>
            </div>
            <div className={STEP_STYLE}>
              <p className="opacity-55">失败章节</p>
              <p className="tabular mt-1 text-lg font-semibold">{book.errors.length}</p>
            </div>
          </div>
          {book.errors.length > 0 && (
            <div className="mt-3 space-y-2">
              <ErrorNote text={book.errors[0] + (book.errors.length > 1 ? "（另有 " + (book.errors.length - 1) + " 章同类错误）" : "")} />
            </div>
          )}
        </Card>
      )}

      {/* 本地体检结果 */}
      {(local.error || local.created) && (
        <Card className="p-4">
          <SectionTitle hint="本地启发式：AI 味、错别字、标点、重复、相似章">本地体检结果</SectionTitle>
          {local.error ? (
            <ErrorNote text={local.error} />
          ) : (
            <div className="space-y-3">
              <p className="text-xs opacity-60">新增 {local.created?.length ?? 0} 条问题，已写入问题库。</p>
              <CreatedList projectId={projectId} issues={local.created ?? []} chapters={chapters} />
              <Button variant="ghost" size="sm" onPress={() => navigate(ROUTES.insights(projectId))}>
                <Sparkles className="size-3.5" />
                在写作分析页查看整本体检
              </Button>
            </div>
          )}
        </Card>
      )}

      {/* 口吻检查结果 */}
      {(voice.error || voice.created || voice.note) && (
        <Card className="p-4">
          <SectionTitle hint="依据人物卡（口癖、语域、绝不会说的话）判断台词是否跑偏">口吻检查结果</SectionTitle>
          {voice.error ? (
            <ErrorNote text={voice.error} />
          ) : voice.note ? (
            <p className="text-xs opacity-60">{voice.note}</p>
          ) : (
            <div className="space-y-3">
              {(voice.created?.length ?? 0) === 0 ? (
                <p className="rounded-xl bg-emerald-500/[0.07] px-3 py-2 text-xs leading-relaxed">所有台词都符合人物人设。</p>
              ) : (
                <CreatedList projectId={projectId} issues={voice.created ?? []} chapters={chapters} />
              )}
            </div>
          )}
        </Card>
      )}

      {/* 全流程步骤 */}
      {full.steps && (
        <Card className="p-4">
          <SectionTitle hint="本地体检 → 一致性检查 → 口吻检查，问题统一写入问题库">一键全流程</SectionTitle>
          <ul className="space-y-2">
            {full.steps.map((s, i) => (
              <li key={i} className={STEP_STYLE}>
                <div className="flex items-center gap-2">
                  <Chip size="sm" color={s.ok ? "success" : "danger"}>
                    {s.ok ? "完成" : "失败"}
                  </Chip>
                  <span className="font-medium">{s.stage}</span>
                  {s.count !== undefined && <span className="tabular opacity-55">新增 {s.count} 条</span>}
                </div>
                {s.error && <p className="mt-1.5 leading-relaxed opacity-70">{s.error}</p>}
              </li>
            ))}
          </ul>
          <Button className="mt-3" variant="outline" size="sm" onPress={() => navigate(ROUTES.insights(projectId))}>
            <Play className="size-3.5" />
            去写作分析页看宏观结论
          </Button>
        </Card>
      )}

      <p className="px-1 text-[11px] opacity-45">
        提示：{KIND_LABELS.continuity}、{KIND_LABELS["world-rule"]}、{KIND_LABELS.timeline} 等问题都可以在看板里逐条标记为已修复、忽略或误报。
      </p>
    </div>
  );
}
