import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Card, Chip } from "@heroui/react";
import { AlertTriangle, BookOpenCheck, Ban, Play, Save, Search, Sparkles } from "lucide-react";
import type { Chapter, ID } from "@/core";
import { localAudit, persistLocalAudit, type LocalAudit } from "@/ai/analysis";
import { EmptyHint, Loading, Progress, SectionTitle, StatCard } from "@/components/common/ui";
import { ROUTES } from "@/app/routes";
import { useAppStore } from "@/app/store";
import { fmtInt, fmtPct, useSettle } from "./helpers";

interface ScanRow {
  chapterId: ID;
  title: string;
  order: number;
  words: number;
  aiHits: number;
  aiScore: number;
  typos: number;
  repeats: number;
  punctuation: number;
  similar: { chapterId: ID; title: string; similarity: number }[];
}

/** AI 味体检：单章明细 + 整本扫描（可中断） */
export function LocalAuditPanel({ projectId, chapters }: { projectId: ID; chapters: Chapter[] }) {
  const navigate = useNavigate();
  const notify = useAppStore((s) => s.notify);
  const settled = useSettle();

  const ordered = useMemo(() => chapters.slice().sort((a, b) => a.order - b.order), [chapters]);
  const [chapterId, setChapterId] = useState<ID>("");
  const [audit, setAudit] = useState<LocalAudit | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);

  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState({ done: 0, total: 0 });
  const [rows, setRows] = useState<ScanRow[]>([]);
  const [scanned, setScanned] = useState(false);
  const [savingAll, setSavingAll] = useState(false);
  const scanAbort = useRef(false);
  const scanAudits = useRef<LocalAudit[]>([]);

  // 默认选中第一章
  useEffect(() => {
    if (!chapterId && ordered.length) setChapterId(ordered[0].id);
    if (chapterId && ordered.length && !ordered.some((c) => c.id === chapterId)) setChapterId(ordered[0].id);
  }, [ordered, chapterId]);

  const runOne = useCallback(async () => {
    if (!chapterId) return;
    setBusy(true);
    setAudit(undefined);
    try {
      const result = await localAudit(projectId, chapterId);
      if (!result) {
        notify("warning", "章节没有正文", "本章还没有内容可以体检。");
        return;
      }
      setAudit(result);
    } catch (e) {
      notify("danger", "本地体检失败", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [projectId, chapterId, notify]);

  const saveOne = useCallback(async () => {
    if (!audit) return;
    setSaving(true);
    try {
      const created = await persistLocalAudit(projectId, audit);
      notify("success", "已写入问题库", "新增 " + created.length + " 条待处理问题");
    } catch (e) {
      notify("danger", "写入失败", e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [audit, projectId, notify]);

  const runScan = useCallback(async () => {
    if (!ordered.length) return;
    scanAbort.current = false;
    scanAudits.current = [];
    setRows([]);
    setScanning(true);
    setScanned(false);
    setScanProgress({ done: 0, total: ordered.length });

    const collected: ScanRow[] = [];
    const audits: LocalAudit[] = [];
    try {
      for (let i = 0; i < ordered.length; i++) {
        if (scanAbort.current) break;
        const chapter = ordered[i];
        const result = await localAudit(projectId, chapter.id);
        if (result) {
          audits.push(result);
          collected.push({
            chapterId: chapter.id,
            title: chapter.title,
            order: chapter.order,
            words: result.wordCount,
            aiHits: result.aiSmell.length,
            aiScore: result.aiSmell.reduce((a, h) => a + h.score, 0),
            typos: result.typos.length,
            repeats: result.repeats.length,
            punctuation: result.punctuation.length,
            similar: result.similarTo,
          });
        }
        setScanProgress({ done: i + 1, total: ordered.length });
        setRows(collected.slice().sort((a, b) => b.aiScore - a.aiScore));
        // 让出主线程：保证进度条刷新与中断按钮可响应
        await new Promise((r) => setTimeout(r, 0));
      }
      scanAudits.current = audits;
      setScanned(true);
      if (scanAbort.current) notify("info", "整本扫描已中断", "已完成 " + collected.length + " 章");
      else notify("success", "整本扫描完成", "共 " + collected.length + " 章");
    } catch (e) {
      notify("danger", "整本扫描失败", e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  }, [ordered, projectId, notify]);

  const saveAll = useCallback(async () => {
    if (!scanAudits.current.length) return;
    setSavingAll(true);
    try {
      let count = 0;
      for (const a of scanAudits.current) {
        count += (await persistLocalAudit(projectId, a)).length;
      }
      notify("success", "扫描结果已写入问题库", "新增 " + count + " 条问题");
    } catch (e) {
      notify("danger", "写入失败", e instanceof Error ? e.message : String(e));
    } finally {
      setSavingAll(false);
    }
  }, [projectId, notify]);

  const pairCount = useMemo(() => {
    const seen = new Set<string>();
    for (const r of rows) {
      for (const s of r.similar) {
        if (s.similarity < 0.4) continue;
        const key = [r.chapterId, s.chapterId].sort().join("::");
        seen.add(key);
      }
    }
    return seen.size;
  }, [rows]);

  if (!settled) return <Loading label="正在准备体检数据…" />;

  if (!ordered.length) {
    return (
      <EmptyHint
        icon={<BookOpenCheck className="size-7" />}
        title="还没有章节"
        description="先在大纲页建立章节并在写作台写下正文，这里才能做 AI 味体检。"
        action={
          <Button variant="primary" size="sm" onPress={() => navigate(ROUTES.outline(projectId))}>
            去大纲页
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-5">
      <Card className="p-4">
        <SectionTitle
          hint="完全离线：AI 味套话、错别字、标点、重复片段、与其它章节的相似度"
          action={
            <div className="flex items-center gap-2">
              <select
                value={chapterId}
                onChange={(e) => {
                  setChapterId(e.target.value);
                  setAudit(undefined);
                }}
                className="max-w-56 rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-xs dark:border-white/10 dark:bg-neutral-900"
              >
                {ordered.map((c) => (
                  <option key={c.id} value={c.id}>
                    第{c.order + 1}章 {c.title}
                  </option>
                ))}
              </select>
              <Button variant="primary" size="sm" isDisabled={busy} isPending={busy} onPress={() => void runOne()}>
                <Search className="size-4" />
                体检本章
              </Button>
            </div>
          }
        >
          单章体检
        </SectionTitle>

        {busy && <Loading label="正在逐句扫描本章…" />}

        {!busy && !audit && (
          <EmptyHint icon={<Sparkles className="size-7" />} title="选择章节后开始体检" description="本地启发式检测，不需要配置模型，也不会消耗 token。" />
        )}

        {!busy && audit && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label="本章字数" value={fmtInt(audit.wordCount) + " 字"} tone="accent" />
              <StatCard label="AI 味命中" value={fmtInt(audit.aiSmell.length) + " 句"} hint={"累计可疑度 " + audit.aiSmell.reduce((a, h) => a + h.score, 0)} tone="danger" />
              <StatCard label="疑似误写" value={fmtInt(audit.typos.length) + " 处"} tone="warning" />
              <StatCard label="重复片段" value={fmtInt(audit.repeats.length) + " 组"} hint={audit.punctuation.length ? audit.punctuation.length + " 项标点建议" : "标点良好"} tone="warning" />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" isDisabled={saving} isPending={saving} onPress={() => void saveOne()}>
                <Save className="size-4" />
                写入问题库
              </Button>
              <Button variant="ghost" size="sm" onPress={() => navigate(ROUTES.write(projectId, audit.chapterId))}>
                打开本章写作页
              </Button>
              <span className="text-[11px] opacity-45">写入后会在一致性报告页统一处理</span>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <p className="mb-2 text-xs font-medium opacity-70">AI 味命中（按可疑度排序）</p>
                {audit.aiSmell.length === 0 ? (
                  <p className="rounded-lg bg-black/[0.03] p-3 text-xs opacity-55 dark:bg-white/[0.04]">没有命中任何套话模式，很好。</p>
                ) : (
                  <ul className="space-y-2">
                    {audit.aiSmell.map((h, i) => (
                      <li key={i} className="rounded-lg border border-black/5 p-2.5 text-xs dark:border-white/5">
                        <div className="mb-1 flex items-center gap-2">
                          <Chip size="sm" color={h.score >= 3 ? "danger" : "warning"}>
                            {h.reason}
                          </Chip>
                          <span className="tabular opacity-45">可疑度 {h.score}</span>
                        </div>
                        <p className="leading-relaxed opacity-80">{h.quote}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="space-y-4">
                <div>
                  <p className="mb-2 text-xs font-medium opacity-70">相似章节</p>
                  {audit.similarTo.length === 0 ? (
                    <p className="rounded-lg bg-black/[0.03] p-3 text-xs opacity-55 dark:bg-white/[0.04]">与前文没有明显自我重复。</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {audit.similarTo.map((s) => (
                        <li key={s.chapterId} className="flex items-center justify-between gap-2 rounded-lg border border-black/5 px-2.5 py-1.5 text-xs dark:border-white/5">
                          <span className="truncate">{s.title}</span>
                          <span className="flex shrink-0 items-center gap-2">
                            <span className="tabular opacity-60">{fmtPct(s.similarity, 1)}</span>
                            <Button variant="ghost" size="sm" onPress={() => navigate(ROUTES.write(projectId, s.chapterId))}>
                              查看
                            </Button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <p className="mb-2 text-xs font-medium opacity-70">重复片段</p>
                  {audit.repeats.length === 0 ? (
                    <p className="rounded-lg bg-black/[0.03] p-3 text-xs opacity-55 dark:bg-white/[0.04]">没有发现反复出现的片段。</p>
                  ) : (
                    <ul className="flex flex-wrap gap-1.5">
                      {audit.repeats.map((r, i) => (
                        <Chip key={i} size="sm" color="warning">
                          {r.phrase} × {r.count}
                        </Chip>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <p className="mb-2 text-xs font-medium opacity-70">错别字与标点</p>
                  {audit.typos.length === 0 && audit.punctuation.length === 0 ? (
                    <p className="rounded-lg bg-black/[0.03] p-3 text-xs opacity-55 dark:bg-white/[0.04]">没有命中常见误写与标点规则。</p>
                  ) : (
                    <ul className="space-y-1.5 text-xs">
                      {audit.typos.map((t, i) => (
                        <li key={"t" + i} className="flex items-center gap-2">
                          <Chip size="sm" color="danger">
                            {t.wrong}
                          </Chip>
                          <span className="opacity-60">→ {t.right}（{t.note}）</span>
                        </li>
                      ))}
                      {audit.punctuation.map((p, i) => (
                        <li key={"p" + i} className="flex items-center gap-2">
                          <Chip size="sm" color="default">
                            {p.kind}
                          </Chip>
                          <span className="opacity-60">
                            {p.count} 处 · {p.advice}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </Card>

      <Card className="p-4">
        <SectionTitle
          hint="对每一章依次做本地体检，逐章累计 AI 味命中与相似章对（不消耗 token）"
          action={
            scanning ? (
              <Button variant="danger-soft" size="sm" onPress={() => (scanAbort.current = true)}>
                <Ban className="size-4" />
                中断扫描
              </Button>
            ) : (
              <Button variant="primary" size="sm" onPress={() => void runScan()}>
                <Play className="size-4" />
                开始整本扫描
              </Button>
            )
          }
        >
          整本扫描
        </SectionTitle>

        {scanning && (
          <div className="mb-4 space-y-1.5">
            <p className="text-xs opacity-60">
              正在体检第 {scanProgress.done}/{scanProgress.total} 章…
            </p>
            <Progress value={scanProgress.done} max={scanProgress.total} />
          </div>
        )}

        {!scanning && rows.length === 0 && (
          <EmptyHint
            icon={<AlertTriangle className="size-7" />}
            title="还没有扫描结果"
            description="整本扫描会逐章跑本地规则，章节很多时需要一点时间，中途可以随时中断。"
          />
        )}

        {rows.length > 0 && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label="已扫描章节" value={fmtInt(rows.length) + " 章"} hint={scanned ? "扫描已完成" : "扫描中…"} tone="accent" />
              <StatCard label="AI 味命中合计" value={fmtInt(rows.reduce((a, r) => a + r.aiHits, 0)) + " 句"} tone="danger" />
              <StatCard label="疑似误写合计" value={fmtInt(rows.reduce((a, r) => a + r.typos, 0)) + " 处"} tone="warning" />
              <StatCard label="高度相似章对" value={fmtInt(pairCount) + " 对"} hint="相似度 ≥ 40%" tone="warning" />
            </div>

            <div className="flex items-center justify-between gap-2">
              <p className="text-xs opacity-55">按累计可疑度排序，点击行可跳到该章</p>
              <Button variant="outline" size="sm" isDisabled={savingAll || !scanned} isPending={savingAll} onPress={() => void saveAll()}>
                <Save className="size-4" />
                全部写入问题库
              </Button>
            </div>

            <div className="overflow-hidden rounded-xl border border-black/5 dark:border-white/5">
              <div className="grid grid-cols-[1.6fr_60px_70px_60px_60px_70px] gap-2 bg-black/[0.03] px-3 py-2 text-[11px] opacity-55 dark:bg-white/[0.04]">
                <span>章节</span>
                <span className="text-right">字数</span>
                <span className="text-right">AI 味</span>
                <span className="text-right">误写</span>
                <span className="text-right">重复</span>
                <span className="text-right">相似</span>
              </div>
              <div className="max-h-96 divide-y divide-black/5 overflow-y-auto dark:divide-white/5">
                {rows.map((r) => (
                  <button
                    key={r.chapterId}
                    type="button"
                    onClick={() => navigate(ROUTES.write(projectId, r.chapterId))}
                    className="grid w-full grid-cols-[1.6fr_60px_70px_60px_60px_70px] items-center gap-2 px-3 py-2 text-left text-xs transition hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
                  >
                    <span className="truncate">
                      第{r.order + 1}章 {r.title}
                    </span>
                    <span className="tabular text-right opacity-60">{fmtInt(r.words)}</span>
                    <span className={"tabular text-right " + (r.aiScore >= 6 ? "text-rose-500" : r.aiHits ? "" : "opacity-40")}>
                      {r.aiHits} / {r.aiScore}
                    </span>
                    <span className="tabular text-right opacity-60">{r.typos}</span>
                    <span className="tabular text-right opacity-60">{r.repeats}</span>
                    <span className="tabular text-right opacity-60">
                      {r.similar.filter((s) => s.similarity >= 0.4).length}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
