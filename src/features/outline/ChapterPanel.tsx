import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Chapter, ChapterStatus, ID } from "@/core";
import { Button, Card, Chip, Description, Input, Label, TextArea, TextField } from "@heroui/react";
import { AlertTriangle, Check, Loader2, PenLine, Sparkles, Trash2, Wand2 } from "lucide-react";
import { ROUTES } from "@/app/routes";
import { useAppStore } from "@/app/store";
import { updateChapter } from "@/db/repo/outline";
import { generateChapterBeats } from "@/ai/genesis";
import { suggestScenes } from "@/ai/analysis";
import { formatRelative, formatWords } from "@/utils/format";
import { newId } from "@/utils/id";
import { SectionTitle } from "@/components/common/ui";
import {
  BEAT_KIND_LABEL, CHAPTER_STATUS_ORDER, chapterStatusColor, chapterStatusLabel, clampTension,
  errorText, tensionLabel, tensionText,
} from "./outlineMeta";

/** AI 场景建议（结构对齐 suggestScenes 的返回） */
interface SceneSuggestion {
  title: string;
  where: string;
  who: string[];
  conflict: string;
  turn: string;
  advance: string;
  hook: string;
}

/** 面板草稿：goals 用"每行一条"的文本承载，保存时再切回数组 */
interface Draft {
  title: string;
  summary: string;
  goalsText: string;
  tension: number;
  hook: string;
  cliffhanger: string;
  status: ChapterStatus;
}

function toDraft(chapter: Chapter): Draft {
  return {
    title: chapter.title,
    summary: chapter.summary ?? "",
    goalsText: (chapter.goals ?? []).join("\n"),
    tension: clampTension(chapter.tension ?? 0),
    hook: chapter.hook ?? "",
    cliffhanger: chapter.cliffhanger ?? "",
    status: chapter.status,
  };
}

/** 多行文本 → 目标数组（容忍手写的 - / * / · 前缀） */
function goalList(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.replace(/^\s*[-*·•]\s*/, "").trim())
    .filter(Boolean);
}

/** 比较草稿与库里的差异；无差异返回 undefined（避免无意义的写入） */
function patchOf(draft: Draft, chapter: Chapter): Partial<Chapter> | undefined {
  const patch: Partial<Chapter> = {};
  const title = draft.title.trim();
  const goals = goalList(draft.goalsText);
  if (title && title !== chapter.title) patch.title = title;
  if (draft.summary !== (chapter.summary ?? "")) patch.summary = draft.summary;
  if (goals.join("\n") !== (chapter.goals ?? []).join("\n")) patch.goals = goals;
  if (clampTension(draft.tension) !== (chapter.tension ?? 0)) patch.tension = clampTension(draft.tension);
  if (draft.hook !== (chapter.hook ?? "")) patch.hook = draft.hook;
  if (draft.cliffhanger !== (chapter.cliffhanger ?? "")) patch.cliffhanger = draft.cliffhanger;
  if (draft.status !== chapter.status) patch.status = draft.status;
  return Object.keys(patch).length ? patch : undefined;
}

interface Props {
  projectId: ID;
  chapter: Chapter;
  /** 在全书中的展示序号（从 0 开始） */
  index: number;
}

/** 右侧章节详情面板：基础字段编辑 + AI 细纲 + AI 场景建议 + 场景节拍清单 */
export function ChapterPanel({ projectId, chapter, index }: Props) {
  const navigate = useNavigate();
  const notify = useAppStore((s) => s.notify);

  const [draft, setDraft] = useState<Draft>(() => toDraft(chapter));
  const [boundId, setBoundId] = useState<ID>(chapter.id);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string>();
  const [busy, setBusy] = useState<"beats" | "scenes">();
  const [aiError, setAiError] = useState<string>();
  const [scenes, setScenes] = useState<SceneSuggestion[]>([]);

  // 切换章节时重置草稿（AI 写入后由 applyPatch 主动同步）
  useEffect(() => {
    if (chapter.id === boundId) return;
    setDraft(toDraft(chapter));
    setBoundId(chapter.id);
    setSavedAt(undefined);
    setAiError(undefined);
    setScenes([]);
  }, [chapter, boundId]);

  const dirtyPatch = chapter.id === boundId ? patchOf(draft, chapter) : undefined;

  // 自动保存：停止输入 700ms 后落库
  useEffect(() => {
    if (!dirtyPatch) return;
    const timer = setTimeout(() => {
      setSaving(true);
      updateChapter(chapter.id, dirtyPatch)
        .then(() => setSavedAt(new Date().toISOString()))
        .catch((e: unknown) => notify("danger", "保存章节失败", errorText(e)))
        .finally(() => setSaving(false));
    }, 700);
    return () => clearTimeout(timer);
    // dirtyPatch 每次都重新生成对象，用 JSON 作为依赖更稳定
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(dirtyPatch ?? null), chapter.id]);

  const saveNow = async () => {
    const patch = patchOf(draft, chapter);
    if (!patch) return;
    setSaving(true);
    try {
      await updateChapter(chapter.id, patch);
      setSavedAt(new Date().toISOString());
      notify("success", "已保存", chapter.title);
    } catch (e) {
      notify("danger", "保存章节失败", errorText(e));
    } finally {
      setSaving(false);
    }
  };

  /** 把（AI 或本地产生的）补丁同步进草稿，避免自动保存把它们又写回去 */
  const applyPatch = (patch: Partial<Chapter>) => {
    setDraft((prev) => ({
      ...prev,
      title: patch.title ?? prev.title,
      summary: patch.summary ?? prev.summary,
      goalsText: patch.goals ? patch.goals.join("\n") : prev.goalsText,
      tension: patch.tension === undefined ? prev.tension : clampTension(patch.tension),
      hook: patch.hook ?? prev.hook,
      cliffhanger: patch.cliffhanger ?? prev.cliffhanger,
      status: patch.status ?? prev.status,
    }));
  };

  // ---------------- AI ----------------

  const runBeats = async () => {
    setBusy("beats");
    setAiError(undefined);
    try {
      const res = await generateChapterBeats(projectId, chapter.id);
      if (!res.ok) {
        setAiError(res.error || "AI 细纲生成失败");
        notify("danger", "AI 细纲生成失败", res.error);
        return;
      }
      const patch: Partial<Chapter> = {
        summary: res.summary || chapter.summary,
        goals: res.goals.length ? res.goals : chapter.goals,
        tension: clampTension(res.tension ?? chapter.tension),
        hook: res.hook || chapter.hook,
        cliffhanger: res.cliffhanger || chapter.cliffhanger,
        beats: res.beats.map((b) => ({ ...b, id: newId("beat") })),
        status: chapter.status === "idea" ? "outlined" : chapter.status,
      };
      await updateChapter(chapter.id, patch);
      applyPatch(patch);
      setSavedAt(new Date().toISOString());
      notify("success", "细纲已生成", (patch.beats?.length ?? 0) + " 个场景节拍");
    } catch (e) {
      setAiError(errorText(e));
      notify("danger", "AI 细纲生成失败", errorText(e));
    } finally {
      setBusy(undefined);
    }
  };

  const runScenes = async () => {
    setBusy("scenes");
    setAiError(undefined);
    try {
      const res = await suggestScenes(projectId, chapter.id, 5);
      if (!res.ok) {
        setAiError(res.error || "AI 场景建议生成失败");
        notify("danger", "AI 场景建议失败", res.error);
        return;
      }
      setScenes(res.scenes);
      notify("success", "已生成场景建议", res.scenes.length + " 条");
    } catch (e) {
      setAiError(errorText(e));
      notify("danger", "AI 场景建议失败", errorText(e));
    } finally {
      setBusy(undefined);
    }
  };

  /** 把一条场景建议追加到本章目标（同时保留草稿里未保存的编辑） */
  const insertSceneGoal = async (scene: SceneSuggestion) => {
    const line = scene.advance ? scene.title + "：" + scene.advance : scene.title;
    const goals = [...goalList(draft.goalsText), line];
    try {
      await updateChapter(chapter.id, { goals });
      setDraft((prev) => ({ ...prev, goalsText: goals.join("\n") }));
      setSavedAt(new Date().toISOString());
      notify("success", "已加入章节目标", line);
    } catch (e) {
      notify("danger", "写入目标失败", errorText(e));
    }
  };

  // ---------------- 节拍 ----------------

  const toggleBeat = async (beatId: string) => {
    const beats = (chapter.beats ?? []).map((b) => (b.id === beatId ? { ...b, done: !b.done } : b));
    try {
      await updateChapter(chapter.id, { beats });
    } catch (e) {
      notify("danger", "更新节拍失败", errorText(e));
    }
  };

  const clearBeats = async () => {
    if (!confirm("清除本章的所有场景节拍？")) return;
    try {
      await updateChapter(chapter.id, { beats: [] });
      notify("info", "已清除场景节拍", chapter.title);
    } catch (e) {
      notify("danger", "清除失败", errorText(e));
    }
  };

  const doneBeats = (chapter.beats ?? []).filter((b) => b.done).length;

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="tabular text-[11px] opacity-45">第 {index + 1} 章</span>
            <Chip size="sm" color={chapterStatusColor(chapter.status)}>
              {chapterStatusLabel(chapter.status)}
            </Chip>
            <span className="text-[11px] opacity-45">{formatWords(chapter.wordCount)}</span>
            <span className="text-[11px] opacity-35">更新于 {formatRelative(chapter.updatedAt)}</span>
          </div>
          <h2 className="mt-1 truncate text-base font-semibold tracking-tight">{chapter.title}</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] opacity-45">
            {saving ? "保存中…" : dirtyPatch ? "有未保存修改" : savedAt ? "已保存" : "已同步"}
          </span>
          <Button size="sm" variant="outline" isDisabled={!dirtyPatch} onPress={() => void saveNow()}>
            保存
          </Button>
          <Button size="sm" variant="primary" onPress={() => navigate(ROUTES.write(projectId, chapter.id))}>
            <PenLine className="size-3.5" />
            去写作
          </Button>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="lg:col-span-2">
          <TextField value={draft.title} onChange={(v) => setDraft((prev) => ({ ...prev, title: v }))}>
            <Label>章节标题</Label>
            <Input placeholder="例如：雨夜的来客" />
          </TextField>
        </div>

        <div className="lg:col-span-2">
          <TextField value={draft.summary} onChange={(v) => setDraft((prev) => ({ ...prev, summary: v }))}>
            <Label>本章梗概</Label>
            <TextArea rows={3} placeholder="两三句话写清楚：谁、在哪、想要什么、遇到什么阻碍。" />
          </TextField>
        </div>

        <div className="lg:col-span-2">
          <TextField value={draft.goalsText} onChange={(v) => setDraft((prev) => ({ ...prev, goalsText: v }))}>
            <Label>推进点（每行一条）</Label>
            <TextArea rows={5} placeholder={"交代主角的处境变化\n引出反派的第一次出手\n埋下玉佩的伏笔"} />
            <Description>写作与 AI 续写时会把这里当作本章必须完成的事。</Description>
          </TextField>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <Label>情绪张力</Label>
            <span className="tabular text-xs opacity-60">
              {tensionText(draft.tension)} · {tensionLabel(draft.tension)}
            </span>
          </div>
          <input
            type="range"
            min={-5}
            max={5}
            step={1}
            value={draft.tension}
            onChange={(e) => setDraft((prev) => ({ ...prev, tension: clampTension(Number(e.target.value)) }))}
            className="w-full accent-neutral-900"
          />
          <div className="mt-1 flex justify-between text-[10px] opacity-40">
            <span>-5 低谷</span>
            <span>0 平缓</span>
            <span>+5 高潮</span>
          </div>
        </div>

        <div>
          <Label className="mb-1.5 block">章节状态</Label>
          <select
            value={draft.status}
            onChange={(e) => setDraft((prev) => ({ ...prev, status: e.target.value as ChapterStatus }))}
            className="w-full rounded-lg border border-black/10 bg-white/70 px-3 py-2 text-sm outline-none transition focus:border-neutral-900 dark:border-white/10 dark:bg-neutral-900/60"
          >
            {CHAPTER_STATUS_ORDER.map((status) => (
              <option key={status} value={status}>
                {chapterStatusLabel(status)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <TextField value={draft.hook} onChange={(v) => setDraft((prev) => ({ ...prev, hook: v }))}>
            <Label>开篇钩子</Label>
            <TextArea rows={2} placeholder="场景第一句话想让读者追问什么？" />
          </TextField>
        </div>

        <div>
          <TextField value={draft.cliffhanger} onChange={(v) => setDraft((prev) => ({ ...prev, cliffhanger: v }))}>
            <Label>结尾悬念</Label>
            <TextArea rows={2} placeholder="本章最后一幕留下的问题或反转。" />
          </TextField>
        </div>
      </div>

      <div className="mt-6 border-t border-black/5 pt-4 dark:border-white/5">
        <SectionTitle
          hint="AI 会结合全书设定与本章目标给出可落笔的内容"
          action={
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="secondary" isDisabled={busy !== undefined} onPress={() => void runBeats()}>
                {busy === "beats" ? <Loader2 className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />}
                AI 细纲
              </Button>
              <Button size="sm" variant="outline" isDisabled={busy !== undefined} onPress={() => void runScenes()}>
                {busy === "scenes" ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                AI 场景建议
              </Button>
            </div>
          }
        >
          章节细纲
        </SectionTitle>

        {aiError && (
          <div className="mb-3 flex items-start gap-2 rounded-xl border border-rose-500/25 bg-rose-500/[0.06] px-3 py-2 text-xs text-rose-600 dark:text-rose-400">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span className="leading-relaxed">{aiError}</span>
          </div>
        )}

        {scenes.length > 0 && (
          <div className="mb-4 space-y-2">
            {scenes.map((scene, i) => (
              <div key={scene.title + i} className="rounded-xl border border-black/5 p-3 dark:border-white/5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{scene.title}</p>
                    <p className="mt-0.5 text-[11px] opacity-50">
                      {[scene.where, scene.who.length ? scene.who.join("、") : ""].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <Button size="sm" variant="ghost" onPress={() => void insertSceneGoal(scene)}>
                    插入到章节目标
                  </Button>
                </div>
                <div className="mt-2 space-y-1 text-xs leading-relaxed opacity-75">
                  {scene.conflict && <p>冲突：{scene.conflict}</p>}
                  {scene.turn && <p>转折：{scene.turn}</p>}
                  {scene.advance && <p>推进：{scene.advance}</p>}
                  {scene.hook && <p>悬念：{scene.hook}</p>}
                </div>
              </div>
            ))}
          </div>
        )}

        {(chapter.beats ?? []).length === 0 ? (
          <p className="rounded-xl border border-dashed border-black/10 px-4 py-6 text-center text-xs opacity-55 dark:border-white/10">
            还没有场景节拍，点「AI 细纲」把本章拆成 3~6 个可落笔的节拍。
          </p>
        ) : (
          <>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[11px] opacity-50">
                已完成 {doneBeats} / {(chapter.beats ?? []).length} 个节拍（点一下可勾选）
              </p>
              <Button size="sm" variant="ghost" onPress={() => void clearBeats()}>
                <Trash2 className="size-3.5" />
                清除节拍
              </Button>
            </div>
            <ul className="space-y-1">
              {(chapter.beats ?? []).map((beat) => (
                <li key={beat.id}>
                  <button
                    type="button"
                    onClick={() => void toggleBeat(beat.id)}
                    className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-black/[0.04] dark:hover:bg-white/5"
                  >
                    <span
                      className={
                        "mt-0.5 grid size-4 shrink-0 place-items-center rounded border " +
                        (beat.done ? "border-emerald-500 bg-emerald-500 text-white" : "border-black/20 dark:border-white/25")
                      }
                    >
                      {beat.done && <Check className="size-3" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={"text-[13px] leading-relaxed " + (beat.done ? "opacity-45 line-through" : "")}>{beat.summary}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] opacity-55">
                        <Chip size="sm">{BEAT_KIND_LABEL[beat.kind] ?? beat.kind}</Chip>
                        {typeof beat.tension === "number" && <span className="tabular">张力 {tensionText(beat.tension)}</span>}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Card>
  );
}
