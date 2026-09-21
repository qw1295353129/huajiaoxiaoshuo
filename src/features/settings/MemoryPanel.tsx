import { useMemo, useState } from "react";
import { Button, Chip, Input, TextArea } from "@heroui/react";
import {
  Brain, Check, Lightbulb, Pin, PinOff, Plus, RefreshCw, Sparkles, Trash2,
  EyeOff, Eye, AlertTriangle, BookMarked, Quote,
} from "lucide-react";
import type { MemoryFact, MemoryKind } from "@/core";
import { MEMORY_KIND_LABEL, MEMORY_SOURCE_LABEL } from "@/core";
import { useAppStore } from "@/app/store";
import { useLiveQuery } from "dexie-react-hooks";
import {
  addMemory, clearMemory, deleteMemory, listMemory, toggleMemoryPaused, toggleMemoryPinned, updateMemory,
} from "@/db/repo/memory";
import { extractRuleBasedMemory, suggestPreferences, type PreferenceCandidate } from "@/ai/memory-extract";
import { EmptyHint, Loading, SectionTitle } from "@/components/common/ui";
import { formatRelative } from "@/utils/format";

const KIND_ORDER: MemoryKind[] = ["preference", "lesson", "convention", "fact", "insight"];

/**
 * 写作记忆管理。
 *
 * 这是这套记忆和"向量记忆"最本质的区别：作者能看见每一条、知道它从哪来、能改能删能暂停。
 * 看不见的记忆不会带来信任，只会带来怀疑。
 */
export function MemoryPanel() {
  const project = useAppStore((s) => s.project);
  const notify = useAppStore((s) => s.notify);
  const projectId = project?.id;

  const [busy, setBusy] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<PreferenceCandidate[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftKind, setDraftKind] = useState<MemoryKind>("preference");
  const [draftScope, setDraftScope] = useState<"global" | "project">(projectId ? "project" : "global");
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [filter, setFilter] = useState<MemoryKind | "all">("all");
  const [showPaused, setShowPaused] = useState(false);

  const memories = useLiveQuery(
    () => (projectId ? listMemory({ projectId, includePaused: true }) : listMemory({ includePaused: true })),
    [projectId],
    undefined as MemoryFact[] | undefined,
  );

  const visible = useMemo(() => {
    const list = memories ?? [];
    return list.filter((m) => (showPaused ? true : !m.paused)).filter((m) => (filter === "all" ? true : m.kind === filter));
  }, [memories, filter, showPaused]);

  const grouped = useMemo(() => {
    const map = new Map<MemoryKind, MemoryFact[]>();
    for (const kind of KIND_ORDER) {
      const list = visible.filter((m) => m.kind === kind);
      if (list.length) map.set(kind, list);
    }
    return map;
  }, [visible]);

  const runExtract = async () => {
    if (!projectId) return;
    setBusy("extract");
    try {
      const res = await extractRuleBasedMemory({ projectId });
      const parts: string[] = [];
      if (res.created.length) parts.push("新增 " + res.created.length + " 条");
      if (res.reinforced.length) parts.push("补充证据 " + res.reinforced.length + " 条");
      if (!parts.length) parts.push("没有新发现");
      notify(
        res.created.length ? "success" : "info",
        "记忆提取完成：" + parts.join("，"),
        "扫描了 " + res.scanned.feedback + " 条反馈、" + res.scanned.issues + " 个问题、" + res.scanned.sessions + " 次写作会话",
      );
    } catch (e) {
      notify("danger", "提取失败", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const runSuggest = async () => {
    if (!projectId) return;
    setBusy("suggest");
    try {
      const res = await suggestPreferences({ projectId });
      if (!res.ok) {
        notify("danger", "归纳失败", res.error);
        return;
      }
      if (!res.candidates.length) {
        notify("info", "样本还不够", "只找到 " + res.scanned + " 条采纳/拒绝记录，至少需要 4 条才能归纳出偏好");
        return;
      }
      setCandidates(res.candidates);
      setSelected(res.candidates.map((c) => c.text));
    } finally {
      setBusy(null);
    }
  };

  const acceptCandidates = async () => {
    if (!projectId) return;
    setBusy("accept");
    try {
      let n = 0;
      for (const c of candidates) {
        if (!selected.includes(c.text)) continue;
        await addMemory({
          scope: draftScope,
          projectId,
          kind: c.kind,
          text: c.text,
          note: c.why ? "依据：" + c.why : undefined,
          source: "suggestion",
          evidence: c.samples.slice(0, 3).map((q) => ({
            kind: "suggestion" as const,
            quote: q.slice(0, 120),
            at: new Date().toISOString(),
          })),
        });
        n += 1;
      }
      setCandidates([]);
      setSelected([]);
      notify("success", "已写入 " + n + " 条写作偏好", "之后每次生成都会遵守");
    } finally {
      setBusy(null);
    }
  };

  const doAdd = async () => {
    const text = draft.trim();
    if (!text || !projectId) return;
    await addMemory({
      scope: draftScope,
      projectId: draftScope === "project" ? projectId : undefined,
      kind: draftKind,
      text,
      source: "user",
    });
    setDraft("");
    setAdding(false);
    notify("success", "已添加记忆", "下次生成即生效");
  };

  if (memories === undefined) return <Loading label="正在读取记忆…" />;

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-black/8 p-4 dark:border-white/10">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-2xl">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold">
              <Brain className="size-4 opacity-60" />
              写作记忆
            </h2>
            <p className="mt-1 text-xs leading-relaxed opacity-65">
              系统从你的使用痕迹里积累「你希望 AI 怎么写」。
              <span className="opacity-80">偏好与教训会直接进入每次生成的 system prompt</span>
              ，设定事实与名词约定会进入上下文。每条都能看见出处、能改、能暂停，不做黑箱记忆。
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button size="sm" variant="outline" isPending={busy === "extract"} onPress={() => void runExtract()}>
              <RefreshCw className="size-3.5" />
              从使用记录提取
            </Button>
            <Button size="sm" variant="primary" isPending={busy === "suggest"} onPress={() => void runSuggest()}>
              <Sparkles className="size-3.5" />
              AI 归纳写作偏好
            </Button>
          </div>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed opacity-50">
          「从使用记录提取」是纯规则的，不消耗 token；「AI 归纳」会读你的采纳与拒绝记录，只生成候选，需要你确认后才生效。
        </p>
      </section>

      {candidates.length > 0 && (
        <section className="rounded-xl border border-violet-500/40 bg-violet-500/[0.04] p-4">
          <SectionTitle hint="勾选后写入记忆；不选就丢弃，不会自动生效">
            AI 归纳出 {candidates.length} 条候选偏好
          </SectionTitle>
          <div className="space-y-2">
            {candidates.map((c) => (
              <label key={c.text} className="flex cursor-pointer items-start gap-2 rounded-lg bg-white/70 px-3 py-2 dark:bg-white/[0.04]">
                <input
                  type="checkbox"
                  checked={selected.includes(c.text)}
                  onChange={() => setSelected((s) => (s.includes(c.text) ? s.filter((x) => x !== c.text) : [...s, c.text]))}
                  className="mt-0.5 accent-violet-500"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium">{c.text}</p>
                  {c.why && <p className="mt-0.5 text-[11px] leading-relaxed opacity-60">依据：{c.why}</p>}
                  {c.samples.length > 0 && (
                    <p className="mt-0.5 truncate text-[10px] opacity-40">样本：{c.samples.join(" / ").slice(0, 90)}</p>
                  )}
                </div>
                <Chip size="sm" color={c.kind === "lesson" ? "warning" : "accent"}>
                  {MEMORY_KIND_LABEL[c.kind]}
                </Chip>
              </label>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select
              value={draftScope}
              onChange={(e) => setDraftScope(e.target.value as "global" | "project")}
              className="rounded-lg border border-black/10 bg-transparent px-2 py-1 text-xs dark:border-white/15"
            >
              <option value="project">仅本书</option>
              <option value="global">全书通用</option>
            </select>
            <Button size="sm" variant="primary" isPending={busy === "accept"} onPress={() => void acceptCandidates()}>
              <Check className="size-3.5" />
              写入选中的 {selected.length} 条
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onPress={() => {
                setCandidates([]);
                setSelected([]);
              }}
            >
              全部丢弃
            </Button>
          </div>
        </section>
      )}

      <section>
        <SectionTitle hint={"共 " + memories.length + " 条，其中 " + memories.filter((m) => !m.paused).length + " 条生效中"}>
          已记住的内容
        </SectionTitle>
        <div className="mt-2 mb-3 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setFilter("all")}
            className={
              "rounded-md px-2 py-1 text-[11px] transition " +
              (filter === "all" ? "bg-black/[0.07] font-medium dark:bg-white/10" : "opacity-55 hover:opacity-100")
            }
          >
            全部 {memories.filter((m) => showPaused || !m.paused).length}
          </button>
          {KIND_ORDER.map((k) => {
            const n = memories.filter((m) => m.kind === k && (showPaused || !m.paused)).length;
            if (!n) return null;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setFilter(k)}
                className={
                  "rounded-md px-2 py-1 text-[11px] transition " +
                  (filter === k ? "bg-black/[0.07] font-medium dark:bg-white/10" : "opacity-55 hover:opacity-100")
                }
              >
                {MEMORY_KIND_LABEL[k]} {n}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setShowPaused((v) => !v)}
            className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-[11px] opacity-55 transition hover:opacity-100"
          >
            {showPaused ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
            {showPaused ? "隐藏已暂停" : "显示已暂停"}
          </button>
          <Button size="sm" variant="ghost" onPress={() => setAdding((v) => !v)}>
            <Plus className="size-3.5" />
            手动添加
          </Button>
        </div>

        {adding && (
          <div className="mb-3 space-y-2 rounded-xl border border-black/8 p-3 dark:border-white/10">
            <TextArea
              rows={2}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="写一条你希望 AI 永远遵守的规则，例如：对话里不要出现解释性台词"
            />
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={draftKind}
                onChange={(e) => setDraftKind(e.target.value as MemoryKind)}
                className="rounded-lg border border-black/10 bg-transparent px-2 py-1 text-xs dark:border-white/15"
              >
                {KIND_ORDER.map((k) => (
                  <option key={k} value={k}>
                    {MEMORY_KIND_LABEL[k]}
                  </option>
                ))}
              </select>
              <select
                value={draftScope}
                onChange={(e) => setDraftScope(e.target.value as "global" | "project")}
                className="rounded-lg border border-black/10 bg-transparent px-2 py-1 text-xs dark:border-white/15"
              >
                <option value="project">仅本书</option>
                <option value="global">全书通用</option>
              </select>
              <Button size="sm" variant="primary" isDisabled={!draft.trim()} onPress={() => void doAdd()}>
                保存
              </Button>
              <Button size="sm" variant="ghost" onPress={() => setAdding(false)}>
                取消
              </Button>
            </div>
          </div>
        )}

        {visible.length === 0 ? (
          <EmptyHint
            icon={<Lightbulb className="size-7" />}
            title="还没有记忆"
            description="点上面的「从使用记录提取」把已有反馈与问题转成记忆；或者直接手动写一条。用久了它会自己长起来。"
          />
        ) : (
          <div className="space-y-4">
            {[...grouped.entries()].map(([kind, list]) => (
              <div key={kind}>
                <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium opacity-60">
                  {kind === "insight" ? <BookMarked className="size-3" /> : <Quote className="size-3" />}
                  {MEMORY_KIND_LABEL[kind]}
                  <span className="opacity-50">{list.length}</span>
                  {kind === "insight" && <span className="opacity-50">· 只用于统计，不进模型</span>}
                </p>
                <div className="space-y-1.5">
                  {list.map((m) => (
                    <MemoryRow
                      key={m.id}
                      fact={m}
                      editing={editing === m.id}
                      editText={editText}
                      onEditStart={() => {
                        setEditing(m.id);
                        setEditText(m.text);
                      }}
                      onEditChange={setEditText}
                      onEditCancel={() => setEditing(null)}
                      onEditSave={async () => {
                        await updateMemory(m.id, { text: editText.trim() });
                        setEditing(null);
                        notify("success", "已修改");
                      }}
                      onTogglePin={() => void toggleMemoryPinned(m.id)}
                      onTogglePause={() => void toggleMemoryPaused(m.id)}
                      onDelete={() => void deleteMemory(m.id)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {memories.length > 0 && (
        <section className="rounded-xl border border-rose-500/30 bg-rose-500/[0.04] p-4">
          <p className="flex items-center gap-1.5 text-xs font-medium text-rose-600 dark:text-rose-400">
            <AlertTriangle className="size-3.5" />
            清空记忆
          </p>
          <p className="mt-1 text-[11px] leading-relaxed opacity-70">
            记忆删除后 AI 会回到「不了解你」的状态，但不会影响作品本身。
          </p>
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onPress={async () => {
                if (!confirm("清空本书的记忆？（全书通用的记忆会保留）")) return;
                const n = projectId ? await clearMemory("project", projectId) : 0;
                notify("success", "已清空 " + n + " 条本书记忆");
              }}
            >
              清空本书记忆
            </Button>
            <Button
              size="sm"
              variant="danger"
              onPress={async () => {
                if (!confirm("清空全部记忆？包括全书通用的偏好。此操作不可撤销。")) return;
                const n = await clearMemory();
                notify("success", "已清空 " + n + " 条记忆");
              }}
            >
              清空全部
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}

function MemoryRow({
  fact, editing, editText, onEditStart, onEditChange, onEditCancel, onEditSave,
  onTogglePin, onTogglePause, onDelete,
}: {
  fact: MemoryFact;
  editing: boolean;
  editText: string;
  onEditStart: () => void;
  onEditChange: (v: string) => void;
  onEditCancel: () => void;
  onEditSave: () => void;
  onTogglePin: () => void;
  onTogglePause: () => void;
  onDelete: () => void;
}) {
  const [showEvidence, setShowEvidence] = useState(false);
  const strength = fact.pinned ? 3 : fact.confidence >= 0.7 ? 2 : fact.confidence >= 0.45 ? 1 : 0;
  const strengthLabel = ["弱", "中", "强", "置顶"][strength];

  return (
    <div
      className={
        "rounded-lg border px-3 py-2 " +
        (fact.paused
          ? "border-black/5 opacity-45 dark:border-white/5"
          : fact.pinned
            ? "border-violet-500/40 bg-violet-500/[0.04]"
            : "border-black/8 dark:border-white/10")
      }
    >
      {editing ? (
        <div className="flex items-center gap-2">
          <Input value={editText} onChange={(e) => onEditChange(e.target.value)} />
          <Button size="sm" variant="primary" onPress={onEditSave}>
            保存
          </Button>
          <Button size="sm" variant="ghost" onPress={onEditCancel}>
            取消
          </Button>
        </div>
      ) : (
        <>
          <div className="flex items-start gap-2">
            <button type="button" onClick={onEditStart} className="min-w-0 flex-1 text-left">
              <p className="text-xs leading-relaxed">{fact.text}</p>
              {fact.note && <p className="mt-0.5 text-[10px] opacity-50">{fact.note}</p>}
            </button>
            <div className="flex shrink-0 items-center gap-0.5">
              <Chip size="sm" color={strength >= 2 ? "success" : strength === 1 ? "default" : "warning"}>
                {strengthLabel}
              </Chip>
              <button
                type="button"
                title={fact.pinned ? "取消置顶" : "置顶（永远注入，不被预算裁剪）"}
                onClick={onTogglePin}
                className="rounded p-1 opacity-45 transition hover:opacity-100"
              >
                {fact.pinned ? <PinOff className="size-3" /> : <Pin className="size-3" />}
              </button>
              <button
                type="button"
                title={fact.paused ? "恢复使用" : "暂停使用（保留但不再注入）"}
                onClick={onTogglePause}
                className="rounded p-1 opacity-45 transition hover:opacity-100"
              >
                {fact.paused ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
              </button>
              <button
                type="button"
                title="删除"
                onClick={onDelete}
                className="rounded p-1 opacity-40 transition hover:text-rose-500 hover:opacity-100"
              >
                <Trash2 className="size-3" />
              </button>
            </div>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px] opacity-45">
            <span>{MEMORY_SOURCE_LABEL[fact.source]}</span>
            <span>·</span>
            <span>{fact.scope === "global" ? "全书通用" : "仅本书"}</span>
            {fact.usedCount > 0 && (
              <>
                <span>·</span>
                <span>已使用 {fact.usedCount} 次</span>
              </>
            )}
            <span>·</span>
            <span>{formatRelative(fact.createdAt)}</span>
            {fact.evidence.length > 0 && (
              <button
                type="button"
                onClick={() => setShowEvidence((v) => !v)}
                className="underline decoration-dotted transition hover:opacity-80"
              >
                {fact.evidence.length} 条证据
              </button>
            )}
          </div>
          {showEvidence && (
            <ul className="mt-1.5 space-y-1 border-l-2 border-black/8 pl-2.5 dark:border-white/10">
              {fact.evidence.map((e, i) => (
                <li key={i} className="text-[10px] leading-relaxed opacity-60">
                  「{e.quote.slice(0, 100)}」
                  <span className="ml-1 opacity-60">（{formatRelative(e.at)}）</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

