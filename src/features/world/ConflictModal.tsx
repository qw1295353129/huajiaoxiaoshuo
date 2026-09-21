import { useEffect, useMemo, useState } from "react";
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

/** 规则冲突自检：把所有启用规则 + 世界观条目正文交给模型找矛盾 */
export function ConflictModal({ projectId, open, onOpenChange, entries, projectRules, onOpenEntry }: Props) {
  const notify = useAppStore((s) => s.notify);
  const [running, setRunning] = useState(false);
  const [rows, setRows] = useState<ConflictRow[]>([]);
  const [meta, setMeta] = useState<RunMeta | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
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
    try {
      const payload = buildPayload(entries, projectRules);
      if (!payload.text.trim()) {
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

      const res = await runJson<Record<string, unknown>>({
        taskKind: "consistency",
        projectId,
        system: system,
        user: [
          "### 待检查的设定与规则",
          payload.text,
          "",
          "### 检查要求",
          "逐条比对上面的世界观条目、条目硬规则与项目级写作规则，找出：",
          "1. 两条规则直接冲突（无法同时为真）；",
          "2. 规则与条目正文描述不符；",
          "3. 同一设定在不同条目里表述不一致（数值、时间、范围、所有权等）。",
          "按严重程度排序，最多 20 条。没有冲突就返回空数组。",
        ].join("\n"),
        jsonSchemaHint: jsonInstruction(CONFLICT_SCHEMA),
        context: { projectId: projectId, sections: ["profile"] },
      });

      if (!res.ok) {
        setError(res.error ?? "生成失败，请检查模型配置");
        return;
      }
      const data = res.parsed?.data as Record<string, unknown> | undefined;
      if (!res.parsed?.ok || !data) {
        setError("模型输出不是合法 JSON，可以再试一次");
        return;
      }
      const raw = asArray<Record<string, unknown>>(data.conflicts ?? data);
      const parsed = raw
        .map((item, index) => toRow(item, index))
        .filter((row) => row.ruleA || row.ruleB || row.why)
        .slice(0, 40);
      setRows(parsed);
      setMeta({
        model: res.model,
        ms: Math.round(res.ms),
        included: payload.included,
        total: payload.total,
        truncated: payload.truncated,
      });
      notify(parsed.length ? "warning" : "success", parsed.length ? "发现 " + parsed.length + " 处疑似冲突" : "没有发现规则冲突");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
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
                把 {ruleCount.entryRules} 条条目规则 + {ruleCount.project} 条项目规则与全部条目正文交给模型，找出互相矛盾的设定。会消耗 token。
              </p>
            </Modal.Header>

            <Modal.Body>
              {running ? (
                <Loading label="模型正在比对设定…" />
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
          className="text-[11px] text-violet-600 underline decoration-dotted underline-offset-2 dark:text-violet-300"
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
