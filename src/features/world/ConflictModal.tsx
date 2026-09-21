import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, Chip, Modal } from "@heroui/react";
import { Copy, RefreshCw, ShieldCheck } from "lucide-react";
import type { ContinuityRule, ID, WorldEntry } from "@/core";
import { runJson, systemWithProject } from "@/ai/runner";
import { jsonInstruction } from "@/ai/prompts";
import { asArray, pickStr } from "@/ai/json";
import { useAppStore } from "@/app/store";
import { EmptyHint, Loading } from "@/components/common/ui";
import { truncate } from "@/utils/text";

interface Props {
  projectId: ID;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entries: WorldEntry[];
  projectRules: ContinuityRule[];
  onOpenEntry: (id: ID) => void;
}

interface ConflictRow {
  key: string;
  severity: "error" | "warn" | "info";
  topic: string;
  ruleA: string;
  sourceA: string;
  ruleB: string;
  sourceB: string;
  why: string;
  fix: string;
}

interface RunMeta {
  model: string;
  ms: number;
  included: number;
  total: number;
  truncated: boolean;
}

const CONFLICT_SCHEMA = [
  "{",
  '  "conflicts": [',
  "    {",
  '      "severity": "error|warn|info",',
  '      "topic": "冲突主题（15 字内）",',
  '      "ruleA": "第一条规则或设定的原文（可逐字引用）",',
  '      "sourceA": "它来自哪个条目或哪条规则",',
  '      "ruleB": "与之矛盾的另一条规则或设定原文",',
  '      "sourceB": "它来自哪个条目或哪条规则",',
  '      "why": "为什么算矛盾：具体推导，不要泛泛而谈",',
  '      "fix": "建议改哪一条、改成什么"',
  "    }",
  "  ]",
  "}",
].join("\n");

/** 单次自检的设定文本上限（字符），超出部分按重要度截断 */
const MAX_PAYLOAD = 60000;
const ACK_PREFIX = "huajiao.world.conflicts.";

/**
 * 每批检查多少个条目。
 * 一次性把全部设定塞给模型会超时（实测 12 条目 + 6 规则就跑到 300 秒上限），
 * 而且超出上下文预算会被静默截断。分批后每批请求都小、快、可中断。
 */
const BATCH_SIZE = 6;

/** 规则冲突自检：把所有启用规则 + 世界观条目正文交给模型找矛盾 */
export function ConflictModal({ projectId, open, onOpenChange, entries, projectRules, onOpenEntry }: Props) {
  const notify = useAppStore((s) => s.notify);
  const [running, setRunning] = useState(false);
  const [rows, setRows] = useState<ConflictRow[]>([]);
  const [meta, setMeta] = useState<RunMeta | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  /** 区分"用户取消"与"真的失败"：取消是中性状态，不该显示成红色错误 */
  const [cancelled, setCancelled] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | undefined>(undefined);
  const ctrlRef = useRef<AbortController | null>(null);
  const [acked, setAcked] = useState<string[]>([]);
  const [showAcked, setShowAcked] = useState(false);

  useEffect(() => {
    if (!open) return;
    try {
      const raw = localStorage.getItem(ACK_PREFIX + projectId);
      const data: unknown = raw ? JSON.parse(raw) : [];
      setAcked(Array.isArray(data) ? data.filter((x): x is string => typeof x === "string") : []);
    } catch {
      setAcked([]);
    }
  }, [open, projectId]);

  const ackSet = useMemo(() => new Set(acked), [acked]);
  const visible = useMemo(() => (showAcked ? rows : rows.filter((r) => !ackSet.has(r.key))), [rows, ackSet, showAcked]);
  const ackedCount = rows.filter((r) => ackSet.has(r.key)).length;

  /** 有正文或启用规则的条目才会被检查，批数按它算才准确 */
  const entryCount = useMemo(
    () => entries.filter((e) => e.body.trim() || e.rules.some((r) => r.enabled && r.statement.trim())).length,
    [entries],
  );

  const ruleCount = useMemo(() => {
    const entryRules = entries.reduce((n, e) => n + e.rules.filter((r) => r.enabled && r.statement.trim()).length, 0);
    const projectRuleCount = projectRules.filter((r) => r.enabled).length;
    return { entryRules: entryRules, project: projectRuleCount };
  }, [entries, projectRules]);

  function markAcked(row: ConflictRow) {
    if (ackSet.has(row.key)) return;
    const next = [...acked, row.key];
    setAcked(next);
    try {
      localStorage.setItem(ACK_PREFIX + projectId, JSON.stringify(next));
    } catch {
      /* 隐私模式下写不了，忽略即可 */
    }
  }

  async function runCheck() {
    setRunning(true);
    setError(undefined);
    setCancelled(false);
    setRows([]);
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    try {
      const batches = buildBatches(entries, projectRules, BATCH_SIZE);
      if (!batches.length) {
        setError("还没有可检查的内容：先写一些带规则的世界观条目。");
        return;
      }

      const system = await systemWithProject(
        projectId,
        [
          "你是长篇小说的设定编辑，专门负责审世界观设定与硬规则。",
          "你的任务是找出互相矛盾、无法同时成立、或表述不一致（同一件事有两种说法）的规则与设定。",
          "只报告真正冲突的，不要报告「可以更详细」这类建议；不要脑补设定里没写的内容。",
          "证据必须逐字引用给定的规则或设定原文，不要改写。",
        ].join("\n"),
      );

      // 分批检查：一次性把上百条设定塞给模型会超时，也会超出上下文预算
      const all: ConflictRow[] = [];
      const failures: string[] = [];
      let truncated = false;
      let model = "";
      let ms = 0;

      for (let i = 0; i < batches.length; i++) {
        if (ctrl.signal.aborted) break;
        const batch = batches[i];
        setProgress({ done: i, total: batches.length, label: batch.label });
        try {
          const res = await runJson<Record<string, unknown>>({
            taskKind: "consistency",
            projectId,
            system,
            user: [
              "### 待检查的设定与规则（第 " + (i + 1) + " / " + batches.length + " 批）",
              batch.text,
              "",
              "### 检查要求",
              "逐条比对上面的条目正文、条目硬规则与项目级写作规则，找出：",
              "1. 两条规则直接冲突（无法同时为真）；",
              "2. 规则与条目正文描述不符；",
              "3. 同一设定表述不一致（数值、时间、范围、所有权等）。",
              "只报告与上面这批内容相关的冲突，最多 12 条。没有冲突就返回空数组。",
            ].join("\n"),
            jsonSchemaHint: jsonInstruction(CONFLICT_SCHEMA),
            context: { projectId, sections: ["profile"] },
            signal: ctrl.signal,
          });
          if (!res.ok) {
            // 用户点的取消：立刻停，不当失败
            if (res.errorKind === "aborted" || ctrl.signal.aborted) break;
            failures.push("第 " + (i + 1) + " 批：" + (res.error ?? "失败"));
            continue;
          }
          model = res.model || model;
          ms += res.ms;
          if (batch.truncated) truncated = true;
          const data = res.parsed?.data as Record<string, unknown> | undefined;
          if (!res.parsed?.ok || !data) {
            failures.push("第 " + (i + 1) + " 批：模型输出不是合法 JSON");
            continue;
          }
          const raw = asArray<Record<string, unknown>>(data.conflicts ?? data);
          for (const item of raw) {
            const row = toRow(item, all.length);
            if (row.ruleA || row.ruleB || row.why) all.push(row);
            if (all.length >= 60) break;
          }
          setRows([...all]);
        } catch (e) {
          if (ctrl.signal.aborted) break;
          failures.push("第 " + (i + 1) + " 批：" + (e instanceof Error ? e.message : String(e)));
        }
      }

      setProgress(undefined);

      if (ctrl.signal.aborted) {
        // 保留已经查出来的结果，明确告诉用户是中途停的
        setCancelled(true);
        setMeta({ model, ms: Math.round(ms), included: all.length, total: 0, truncated });
        return;
      }

      setRows(all);
      setMeta({
        model,
        ms: Math.round(ms),
        included: batches.length,
        total: batches.length,
        truncated,
      });
      if (failures.length) {
        setError(failures.length + " 个批次没有完成：" + failures.slice(0, 3).join("；"));
        return;
      }
      notify(all.length ? "warning" : "success", all.length ? "发现 " + all.length + " 处疑似冲突" : "没有发现规则冲突");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(undefined);
      setRunning(false);
      ctrlRef.current = null;
    }
  }

  /** 从冲突描述里找出对应的条目，支持点击跳转 */
  function findEntryId(text: string): ID | undefined {
    if (!text) return undefined;
    const hit = entries.find((e) => e.title.length >= 2 && text.includes(e.title));
    return hit?.id;
  }

  async function copyReport() {
    const text = visible
      .map((row, i) => {
        const head = i + 1 + ". [" + row.severity + "] " + row.topic;
        const lines = [head];
        if (row.ruleA) lines.push("  A：" + row.ruleA + (row.sourceA ? "（" + row.sourceA + "）" : ""));
        if (row.ruleB) lines.push("  B：" + row.ruleB + (row.sourceB ? "（" + row.sourceB + "）" : ""));
        if (row.why) lines.push("  原因：" + row.why);
        if (row.fix) lines.push("  建议：" + row.fix);
        return lines.join("\n");
      })
      .join("\n\n");
    if (!text) {
      notify("info", "没有可复制的内容");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      notify("success", "报告已复制到剪贴板");
    } catch {
      notify("danger", "复制失败，浏览器拒绝了剪贴板访问");
    }
  }

  return (
    <Modal isOpen={open} onOpenChange={onOpenChange}>
      <Modal.Backdrop>
        <Modal.Container size="lg" scroll="inside">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>规则冲突自检</Modal.Heading>
              <p className="mt-1 text-xs opacity-55">
                把 {ruleCount.entryRules} 条条目规则 + {ruleCount.project} 条项目规则与条目正文交给模型，找出互相矛盾的设定。
                {entryCount > 0 && " 分 " + Math.ceil(entryCount / BATCH_SIZE) + " 批检查，每批约 " + BATCH_SIZE + " 个条目，可随时中断。"}
                {" "}会消耗 token。
              </p>
            </Modal.Header>

            <Modal.Body>
              {running ? (
                <div className="space-y-3">
                  <Loading
                    label={
                      progress ? "正在检查第 " + (progress.done + 1) + " / " + progress.total + " 批…" : "正在准备检查…"
                    }
                  />
                  {progress && (
                    <div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-black/[0.07] dark:bg-white/10">
                        <div
                          className="h-full rounded-full bg-neutral-900 transition-all"
                          style={{ width: Math.round((progress.done / Math.max(1, progress.total)) * 100) + "%" }}
                        />
                      </div>
                      <p className="mt-1.5 truncate text-[11px] opacity-55">本批：{progress.label}</p>
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[11px] leading-relaxed opacity-50">已完成的批次会保留，随时可以中断。</p>
                    <Button
                      size="sm"
                      variant="outline"
                      onPress={() => {
                        ctrlRef.current?.abort();
                        notify("info", "已请求中断", "已完成的批次会保留");
                      }}
                    >
                      中断检查
                    </Button>
                  </div>
                </div>
              ) : cancelled ? (
                /* 用户主动取消：中性提示，不是错误，也不需要"重试"这种吓人的按钮 */
                <Card className="border border-black/8 p-4 dark:border-white/10">
                  <p className="text-sm font-medium opacity-80">已取消自检</p>
                  <p className="mt-1 text-xs leading-relaxed opacity-55">
                    没有产生任何修改，也没有消耗额外 token。想继续时再点下面的「开始自检」即可。
                  </p>
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" variant="outline" onPress={() => void runCheck()}>
                      <ShieldCheck className="size-3.5" />
                      重新开始自检
                    </Button>
                  </div>
                </Card>
              ) : error ? (
                <Card className="border border-rose-500/20 bg-rose-500/5 p-4">
                  <p className="text-sm font-medium text-rose-600 dark:text-rose-300">自检没有完成</p>
                  <p className="mt-1 text-xs leading-relaxed opacity-70">{error}</p>
                  <Button className="mt-3" size="sm" variant="outline" onPress={() => void runCheck()}>
                    <RefreshCw className="size-3.5" />
                    重试
                  </Button>
                </Card>
              ) : rows.length === 0 ? (
                <EmptyHint
                  icon={<ShieldCheck className="size-8" />}
                  title={meta ? "没有发现规则冲突" : "还没有自检结果"}
                  description={
                    meta
                      ? "已检查 " + meta.included + " / " + meta.total + " 个条目，模型没有报告矛盾。设定越多，自检越有价值。"
                      : "点击下面的「开始自检」，模型会逐条比对世界观硬规则与项目规则，找出无法同时成立的设定。"
                  }
                  action={
                    <Button variant="primary" size="sm" onPress={() => void runCheck()}>
                      <ShieldCheck className="size-4" />
                      {meta ? "再检查一次" : "开始自检"}
                    </Button>
                  }
                />
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2 text-[11px] opacity-55">
                    <span>共 {rows.length} 条</span>
                    {ackedCount > 0 && <span>· 已忽略 {ackedCount} 条</span>}
                    {meta && (
                      <span>
                        · {meta.model} · {meta.ms} ms · 检查 {meta.included}/{meta.total} 个条目
                        {meta.truncated ? "（其余条目因体量被略过）" : ""}
                      </span>
                    )}
                    {ackedCount > 0 && (
                      <button type="button" className="underline decoration-dotted" onClick={() => setShowAcked(!showAcked)}>
                        {showAcked ? "隐藏已忽略" : "显示已忽略"}
                      </button>
                    )}
                  </div>

                  {visible.length === 0 ? (
                    <p className="py-6 text-center text-xs opacity-55">所有冲突都已标记为「已知悉」。</p>
                  ) : (
                    visible.map((row) => (
                      <Card key={row.key} className="p-3.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <ConflictSeverityChip severity={row.severity} />
                          <span className="text-sm font-medium">{row.topic}</span>
                          <span className="flex-1" />
                          {ackSet.has(row.key) && (
                            <Chip size="sm" color="default">
                              已忽略
                            </Chip>
                          )}
                          <Button size="sm" variant="ghost" onPress={() => markAcked(row)} isDisabled={ackSet.has(row.key)}>
                            已知悉
                          </Button>
                        </div>

                        <div className="mt-2.5 space-y-1.5 text-xs leading-relaxed">
                          <Side
                            label="A"
                            text={row.ruleA}
                            source={row.sourceA}
                            entryId={findEntryId(row.sourceA) ?? findEntryId(row.ruleA)}
                            onOpenEntry={onOpenEntry}
                          />
                          <Side
                            label="B"
                            text={row.ruleB}
                            source={row.sourceB}
                            entryId={findEntryId(row.sourceB) ?? findEntryId(row.ruleB)}
                            onOpenEntry={onOpenEntry}
                          />
                          {row.why && (
                            <p className="opacity-70">
                              <span className="opacity-55">为什么矛盾：</span>
                              {row.why}
                            </p>
                          )}
                          {row.fix && (
                            <p className="rounded-lg bg-emerald-500/10 px-2 py-1.5 text-emerald-700 dark:text-emerald-300">
                              <span className="opacity-70">建议：</span>
                              {row.fix}
                            </p>
                          )}
                        </div>
                      </Card>
                    ))
                  )}
                </div>
              )}
            </Modal.Body>

            <Modal.Footer>
              <div className="flex w-full flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" onPress={() => void runCheck()} isPending={running}>
                  <RefreshCw className="size-3.5" />
                  {rows.length ? "重新自检" : "开始自检"}
                </Button>
                {rows.length > 0 && (
                  <Button variant="ghost" size="sm" onPress={() => void copyReport()}>
                    <Copy className="size-3.5" />
                    复制报告
                  </Button>
                )}
                <span className="flex-1" />
                <Button variant="ghost" size="sm" onPress={() => onOpenChange(false)}>
                  关闭
                </Button>
              </div>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

function Side({
  label,
  text,
  source,
  entryId,
  onOpenEntry,
}: {
  label: string;
  text: string;
  source: string;
  entryId?: ID;
  onOpenEntry: (id: ID) => void;
}) {
  if (!text) return null;
  return (
    <p className="flex flex-wrap items-baseline gap-1">
      <span className="rounded bg-black/5 px-1 font-mono text-[10px] opacity-60 dark:bg-white/10">{label}</span>
      <span>{text}</span>
      {source && <span className="opacity-50">（{source}）</span>}
      {entryId && (
        <button
          type="button"
          onClick={() => onOpenEntry(entryId)}
          className="text-[11px] text-neutral-800 underline decoration-dotted underline-offset-2 dark:text-neutral-200"
        >
          查看条目
        </button>
      )}
    </p>
  );
}

function ConflictSeverityChip({ severity }: { severity: ConflictRow["severity"] }) {
  if (severity === "error") return <Chip size="sm" color="danger">硬冲突</Chip>;
  if (severity === "warn") return <Chip size="sm" color="warning">不一致</Chip>;
  return <Chip size="sm" color="accent">待确认</Chip>;
}

function normalizeLevel(value: string): ConflictRow["severity"] {
  const text = value.toLowerCase();
  if (/error|blocker|严重|硬冲突|冲突/.test(text)) return "error";
  if (/warn|警告|不一致|中/.test(text)) return "warn";
  return "info";
}

function toRow(raw: Record<string, unknown>, index: number): ConflictRow {
  const topic = pickStr(raw, "topic", "title", "冲突主题") || "冲突 " + (index + 1);
  const ruleA = pickStr(raw, "ruleA", "rule1", "a", "第一条");
  const ruleB = pickStr(raw, "ruleB", "rule2", "b", "第二条");
  return {
    key: [topic, ruleA, ruleB].join("||").slice(0, 400),
    severity: normalizeLevel(pickStr(raw, "severity", "level", "严重程度")),
    topic: topic,
    ruleA: ruleA,
    sourceA: pickStr(raw, "sourceA", "fromA", "source1"),
    ruleB: ruleB,
    sourceB: pickStr(raw, "sourceB", "fromB", "source2"),
    why: pickStr(raw, "why", "detail", "reason", "说明"),
    fix: pickStr(raw, "fix", "suggestion", "建议"),
  };
}

/** 组装交给模型的设定文本：按重要度优先，超出上限就截断 */
/**
 * 把设定切成若干批，每批都带上项目级规则（规则之间也要互相比对）。
 * 重要度高的条目排前面，保证时间不够时先检查最重要的设定。
 */
function buildBatches(
  entries: WorldEntry[],
  projectRules: ContinuityRule[],
  batchSize: number,
): { text: string; label: string; truncated: boolean }[] {
  const sorted = [...entries].sort((a, b) => b.importance - a.importance || a.title.localeCompare(b.title, "zh"));
  const eligible = sorted.filter((e) => e.body.trim() || e.rules.some((r) => r.enabled && r.statement.trim()));
  if (!eligible.length) return [];

  const projectLines = projectRules
    .filter((r) => r.enabled)
    .map((r) => "- [" + r.severity + "] " + r.name + "：" + r.description + (r.value ? "（" + r.value + "）" : ""));
  const projectBlock = projectLines.length ? ["### 项目级写作规则", projectLines.join("\n")] : [];

  const batches: { text: string; label: string; truncated: boolean }[] = [];
  for (let i = 0; i < eligible.length; i += batchSize) {
    const slice = eligible.slice(i, i + batchSize);
    const blocks: string[] = [];
    let used = 0;
    let truncated = false;
    for (const entry of slice) {
      const rules = entry.rules.filter((r) => r.enabled && r.statement.trim());
      const block: string[] = ["#### 【" + entry.category + "】" + entry.title + "（重要度 " + entry.importance + "）"];
      if (entry.aliases.length) block.push("别称：" + entry.aliases.join("、"));
      if (entry.body.trim()) block.push("正文：" + truncate(entry.body.replace(/\s+/g, " ").trim(), 600));
      for (const rule of rules) block.push("- [" + rule.severity + "] " + rule.statement.trim());
      const text = block.join("\n");
      if (used + text.length > MAX_PAYLOAD) {
        truncated = true;
        break;
      }
      used += text.length;
      blocks.push(text);
    }
    batches.push({
      text: ["### 世界观条目与条目级硬规则", blocks.join("\n\n"), "", ...projectBlock].join("\n"),
      label: slice.map((e) => e.title).join("、").slice(0, 40),
      truncated,
    });
  }
  return batches;
}

function buildPayload(entries: WorldEntry[], projectRules: ContinuityRule[]): { text: string; included: number; total: number; truncated: boolean } {
  const sorted = [...entries].sort((a, b) => b.importance - a.importance || a.title.localeCompare(b.title, "zh"));
  // 没有任何正文与启用规则的条目没有可比对内容，直接跳过
  const eligible = sorted.filter((e) => e.body.trim() || e.rules.some((r) => r.enabled && r.statement.trim()));
  const blocks: string[] = [];
  let used = 0;
  let included = 0;

  for (const entry of eligible) {
    const rules = entry.rules.filter((r) => r.enabled && r.statement.trim());
    const block: string[] = ["#### 【" + entry.category + "】" + entry.title + "（重要度 " + entry.importance + "）"];
    if (entry.aliases.length) block.push("别称：" + entry.aliases.join("、"));
    if (entry.body.trim()) block.push("正文：" + truncate(entry.body.replace(/\s+/g, " ").trim(), 600));
    for (const rule of rules) block.push("- [" + rule.severity + "] " + rule.statement.trim());
    const text = block.join("\n");
    if (used + text.length > MAX_PAYLOAD) break;
    used += text.length;
    included += 1;
    blocks.push(text);
  }

  const projectLines = projectRules
    .filter((r) => r.enabled)
    .map((r) => "- [" + r.severity + "] " + r.name + "：" + r.description + (r.value ? "（" + r.value + "）" : ""));

  const parts = ["### 世界观条目与条目级硬规则", blocks.join("\n\n") || "（暂无）"];
  if (projectLines.length) parts.push("", "### 项目级写作规则", projectLines.join("\n"));

  return {
    text: parts.join("\n"),
    included: included,
    total: eligible.length,
    truncated: included < eligible.length,
  };
}
