import { useState } from "react";
import { Button, Chip, TextArea } from "@heroui/react";
import {
  Check, ClipboardCopy, Expand, Feather, Languages, MessageSquareQuote, RefreshCw,
  Sparkles, SquareStack, Trash2, Wand2, X, AlertTriangle, Coins,
} from "lucide-react";
import type { ID } from "@/core";
import {
  continueWriting, expandSelection, polishSelection, rewriteSelection,
  generateDescription, generateDialogue, brainstorm,
} from "@/ai/writing";
import { useEditorStore, resultFromOutput, type AiResultView } from "./editorStore";
import { useAppStore } from "@/app/store";
import { formatTokens } from "@/utils/tokens";

interface Props {
  projectId: ID;
  chapterId?: ID;
  onInsert: (text: string, mode: "cursor" | "end" | "replace-selection") => void;
}

type ActionKey = "continue" | "rewrite" | "expand" | "polish" | "describe" | "dialogue" | "brainstorm";

const ACTIONS: { key: ActionKey; label: string; icon: typeof Wand2; needsSelection: boolean; hint: string }[] = [
  { key: "continue", label: "续写", icon: Feather, needsSelection: false, hint: "从断点往下写" },
  { key: "rewrite", label: "改写", icon: RefreshCw, needsSelection: true, hint: "重写选中段落" },
  { key: "expand", label: "扩写", icon: Expand, needsSelection: true, hint: "把选中段落写厚" },
  { key: "polish", label: "润色", icon: Sparkles, needsSelection: true, hint: "只改语言不动剧情" },
  { key: "describe", label: "描写", icon: Languages, needsSelection: false, hint: "生成一段描写" },
  { key: "dialogue", label: "对话", icon: MessageSquareQuote, needsSelection: false, hint: "写一段对话场景" },
  { key: "brainstorm", label: "走向", icon: SquareStack, needsSelection: false, hint: "给几个剧情方向" },
];

/** 写作台右侧 AI 面板：动作 → 生成 → 候选 → 插入。 */
export function AiPanel({ projectId, chapterId, onInsert }: Props) {
  const results = useEditorStore((s) => s.results);
  const running = useEditorStore((s) => s.running);
  const selection = useEditorStore((s) => s.selection);
  const activeResultId = useEditorStore((s) => s.activeResultId);
  const settings = useAppStore((s) => s.settings);
  const notify = useAppStore((s) => s.notify);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);

  const [instruction, setInstruction] = useState("");
  const [targetWords, setTargetWords] = useState(800);
  const [subject, setSubject] = useState("");
  const [participants, setParticipants] = useState("");
  const [candidates, setCandidates] = useState(settings.candidateCount || 3);
  const [directions, setDirections] = useState<Record<string, { title: string; premise: string; why: string; risk: string; examples: string[] }[]>>({});

  void activeResultId;
  const modelLabel = settings.activeModel ?? "未配置模型";

  const runAction = async (key: ActionKey) => {
    if (!settings.activeProviderId || !settings.activeModel) {
      notify("warning", "还没有选择模型", "请先到设置里添加供应商并选择模型。");
      setSettingsOpen(true);
      return;
    }
    if (ACTIONS.find((a) => a.key === key)?.needsSelection && !selection.trim()) {
      notify("warning", "请先在正文里选中一段文字");
      return;
    }

    const store = useEditorStore.getState();
    store.setRunning(true);
    const viewId = Math.random().toString(36).slice(2);
    store.pushResult({
      id: viewId,
      taskKind: key,
      label: ACTIONS.find((a) => a.key === key)?.label ?? key,
      candidates: [],
      activeIndex: 0,
      status: "running",
      streaming: "",
      createdAt: Date.now(),
    });

    const onDelta = (d: { text?: string }) => {
      if (!d.text) return;
      const cur = useEditorStore.getState().results.find((r) => r.id === viewId);
      useEditorStore.getState().updateResult(viewId, { streaming: (cur?.streaming ?? "") + d.text });
    };

    const base = { projectId, chapterId, instruction: instruction.trim() || undefined, candidates };

    try {
      if (key === "brainstorm") {
        const b = await brainstorm({ ...base, question: instruction.trim() || "接下来可以怎么发展？", count: 4 });
        if (b.ok) {
          setDirections((s) => ({ ...s, [viewId]: b.directions }));
          useEditorStore.getState().updateResult(viewId, {
            status: "done",
            candidates: b.directions.map((d) => ({ content: d.title, words: 0 })),
          });
        } else {
          useEditorStore.getState().updateResult(viewId, { status: "error", error: b.error ?? "生成失败" });
        }
        useEditorStore.getState().setRunning(false);
        return;
      }

      let out;
      if (key === "continue") out = await continueWriting({ ...base, targetWords, onDelta });
      else if (key === "rewrite") out = await rewriteSelection({ ...base, selection });
      else if (key === "expand") out = await expandSelection({ ...base, selection });
      else if (key === "polish") out = await polishSelection({ ...base, selection });
      else if (key === "describe") out = await generateDescription({ ...base, subject: subject.trim() || instruction.trim() || "当前场景" });
      else
        out = await generateDialogue({
          ...base,
          participants: participants.split(/[,，、\s]+/).filter(Boolean),
          situation: instruction.trim() || "当前情境",
        });

      const next = resultFromOutput(out, ACTIONS.find((a) => a.key === key)?.label ?? key, key);
      useEditorStore.getState().updateResult(viewId, {
        candidates: next.candidates,
        status: next.status,
        error: next.error,
        model: next.model,
        usage: next.usage,
        contextTokens: next.contextTokens,
        contextSources: next.contextSources,
        streaming: undefined,
      });
      if (!out.ok) notify("danger", "生成失败", out.error);
    } catch (e) {
      useEditorStore.getState().updateResult(viewId, {
        status: "error",
        error: e instanceof Error ? e.message : String(e),
        streaming: undefined,
      });
    } finally {
      useEditorStore.getState().setRunning(false);
    }
  };

  return (
    <div className="flex h-full w-[380px] flex-col border-l border-black/5 dark:border-white/5">
      <div className="shrink-0 border-b border-black/5 px-4 py-3 dark:border-white/5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wand2 className="size-4 text-violet-500" />
            <span className="text-sm font-medium">AI 助手</span>
          </div>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] opacity-60 transition hover:opacity-100"
            title="切换模型"
          >
            <Coins className="size-3" />
            {modelLabel}
          </button>
        </div>
        {!settings.activeModel && (
          <div className="mt-2 flex items-start gap-2 rounded-lg bg-amber-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>还没有选择模型，AI 功能不可用。点右上角进入设置。</span>
          </div>
        )}
      </div>

      <div className="shrink-0 space-y-2.5 border-b border-black/5 px-4 py-3 dark:border-white/5">
        <div className="grid grid-cols-4 gap-1.5">
          {ACTIONS.map((a) => {
            const disabled = running || (a.needsSelection && !selection.trim());
            return (
              <button
                key={a.key}
                type="button"
                disabled={disabled}
                onClick={() => void runAction(a.key)}
                title={a.hint}
                className={
                  "flex flex-col items-center gap-1 rounded-lg border border-black/8 py-2 text-[11px] transition dark:border-white/10 " +
                  (disabled ? "cursor-not-allowed opacity-35" : "hover:border-violet-500/50 hover:bg-violet-500/[0.06]")
                }
              >
                <a.icon className="size-3.5" />
                {a.label}
              </button>
            );
          })}
        </div>

        <TextArea
          rows={2}
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="补充要求（可选）：节奏再快一点 / 多写感官细节"
          className="text-xs"
        />

        <div className="flex items-center gap-2 text-[11px]">
          <label className="flex items-center gap-1 opacity-60">
            候选
            <input
              type="number"
              min={1}
              max={5}
              value={candidates}
              onChange={(e) => setCandidates(Math.max(1, Math.min(5, Number(e.target.value) || 1)))}
              className="tabular w-10 rounded border border-black/10 bg-transparent px-1 py-0.5 text-center dark:border-white/15"
            />
          </label>
          <label className="flex items-center gap-1 opacity-60">
            字数
            <input
              type="number"
              min={200}
              max={3000}
              step={100}
              value={targetWords}
              onChange={(e) => setTargetWords(Math.max(200, Math.min(3000, Number(e.target.value) || 800)))}
              className="tabular w-14 rounded border border-black/10 bg-transparent px-1 py-0.5 text-center dark:border-white/15"
            />
          </label>
          {selection.trim() && (
            <Chip size="sm" color="accent">
              已选 {selection.trim().length} 字
            </Chip>
          )}
        </div>

        <details className="text-[11px]">
          <summary className="cursor-pointer opacity-50 transition hover:opacity-80">描写 / 对话 参数</summary>
          <div className="mt-2 space-y-1.5">
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="描写对象：雨夜的老街 / 她袖口的血渍"
              className="w-full rounded-md border border-black/10 bg-transparent px-2 py-1 text-[11px] outline-none dark:border-white/15"
            />
            <input
              value={participants}
              onChange={(e) => setParticipants(e.target.value)}
              placeholder="对话人物：林远, 沈砚"
              className="w-full rounded-md border border-black/10 bg-transparent px-2 py-1 text-[11px] outline-none dark:border-white/15"
            />
          </div>
        </details>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {results.length === 0 && (
          <div className="grid h-full place-items-center px-6 text-center">
            <div>
              <Sparkles className="mx-auto mb-3 size-6 opacity-20" />
              <p className="text-xs leading-relaxed opacity-50">
                选中正文后点「改写」，或不选中直接点「续写」。
                <br />
                生成结果会保留在这里，可以对照原文反复取用。
              </p>
            </div>
          </div>
        )}
        <div className="space-y-3">
          {results.map((r) => (
            <ResultCard key={r.id} result={r} onInsert={onInsert} directions={directions[r.id]} />
          ))}
        </div>
      </div>

      <div className="shrink-0 border-t border-black/5 px-4 py-2 text-[10px] opacity-40 dark:border-white/5">
        生成时会自动带上人物卡、世界观规则与伏笔状态
      </div>
    </div>
  );
}

function ResultCard({
  result,
  onInsert,
  directions,
}: {
  result: AiResultView;
  onInsert: (text: string, mode: "cursor" | "end" | "replace-selection") => void;
  directions?: { title: string; premise: string; why: string; risk: string; examples: string[] }[];
}) {
  const notify = useAppStore((s) => s.notify);
  const candidate = result.candidates[result.activeIndex];

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notify("success", "已复制到剪贴板");
    } catch {
      notify("danger", "复制失败", "浏览器拒绝了剪贴板访问");
    }
  };

  return (
    <div className="rounded-xl border border-black/8 bg-white/70 p-3 dark:border-white/10 dark:bg-white/[0.03]">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium">{result.label}</span>
          {result.status === "running" && (
            <Chip size="sm" color="accent">
              生成中
            </Chip>
          )}
          {result.status === "error" && (
            <Chip size="sm" color="danger">
              失败
            </Chip>
          )}
          {result.model && <span className="text-[10px] opacity-40">{result.model}</span>}
        </div>
        <div className="flex items-center gap-1">
          {result.status === "running" && (
            <button
              type="button"
              onClick={() => useEditorStore.getState().setRunning(false)}
              className="rounded p-1 opacity-50 hover:opacity-100"
            >
              <X className="size-3" />
            </button>
          )}
          <button
            type="button"
            onClick={() => useEditorStore.getState().removeResult(result.id)}
            className="rounded p-1 opacity-40 hover:opacity-100"
          >
            <Trash2 className="size-3" />
          </button>
        </div>
      </div>

      {result.status === "error" && (
        <p className="rounded-lg bg-rose-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-rose-600 dark:text-rose-300">
          {result.error}
        </p>
      )}

      {result.status === "running" && result.streaming && (
        <p className="manuscript max-h-64 overflow-y-auto whitespace-pre-wrap text-[13px] leading-relaxed opacity-80">
          {result.streaming}
        </p>
      )}

      {directions && directions.length > 0 && (
        <ul className="space-y-2">
          {directions.map((d, i) => (
            <li key={i} className="rounded-lg bg-black/[0.03] p-2.5 dark:bg-white/[0.04]">
              <p className="text-xs font-medium">{d.title}</p>
              <p className="mt-1 text-[11px] leading-relaxed opacity-75">{d.premise}</p>
              {d.why && <p className="mt-1 text-[11px] leading-relaxed opacity-55">为什么好：{d.why}</p>}
              {d.risk && <p className="text-[11px] leading-relaxed opacity-55">风险：{d.risk}</p>}
              {d.examples?.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {d.examples.map((e, j) => (
                    <li key={j} className="text-[11px] opacity-60">
                      · {e}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      {candidate && result.status === "done" && (
        <>
          {result.candidates.length > 1 && (
            <div className="mb-2 flex flex-wrap gap-1">
              {result.candidates.map((c, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => useEditorStore.getState().updateResult(result.id, { activeIndex: i })}
                  className={
                    "rounded-md px-2 py-0.5 text-[10px] transition " +
                    (i === result.activeIndex
                      ? "bg-violet-500/15 text-violet-600 dark:text-violet-300"
                      : "opacity-50 hover:opacity-90")
                  }
                >
                  候选 {i + 1}
                  {c.words > 0 ? " · " + c.words + " 字" : ""}
                </button>
              ))}
            </div>
          )}
          <p className="manuscript max-h-72 overflow-y-auto whitespace-pre-wrap text-[13px] leading-relaxed">
            {candidate.content}
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <Button size="sm" variant="primary" onPress={() => onInsert(candidate.content, "replace-selection")}>
              <Check className="size-3.5" />
              替换选中
            </Button>
            <Button size="sm" variant="outline" onPress={() => onInsert(candidate.content, "cursor")}>
              插入光标处
            </Button>
            <Button size="sm" variant="ghost" onPress={() => onInsert(candidate.content, "end")}>
              追加章末
            </Button>
            <Button size="sm" variant="ghost" isIconOnly onPress={() => void copy(candidate.content)}>
              <ClipboardCopy className="size-3.5" />
            </Button>
          </div>
        </>
      )}

      {(result.usage || result.contextSources?.length) && result.status === "done" && (
        <details className="mt-2 text-[10px] opacity-50">
          <summary className="cursor-pointer">
            {result.usage ? "本 " + formatTokens(result.usage.total) + " tokens" : "上下文"}
            {result.contextTokens ? " · 上下文 " + formatTokens(result.contextTokens) : ""}
          </summary>
          <ul className="mt-1 space-y-0.5">
            {result.usage && (
              <li>
                输入 {formatTokens(result.usage.prompt)} / 输出 {formatTokens(result.usage.completion)}
              </li>
            )}
            {result.contextSources?.map((s, i) => (
              <li key={i}>
                {s.label} · {formatTokens(s.tokens)}
                {s.trimmed ? "（已裁剪）" : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
