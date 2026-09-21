import { useState } from "react";
import { Button, Chip, Input, Label, TextArea, TextField } from "@heroui/react";
import { X } from "lucide-react";
import type { Chapter, ChapterStatus, ID } from "@/core";
import { CHAPTER_STATUS_LABEL } from "@/app/theme";
import { useAppStore } from "@/app/store";
import { useCharacters, useWorldEntries, useThreads } from "@/app/hooks";
import { updateChapter } from "@/db/repo/outline";

const STATUSES: ChapterStatus[] = ["idea", "outlined", "drafting", "drafted", "revising", "done", "cut"];

/** 章节属性面板：目标、出场人物、地点、钩子、埋设/回收的伏笔 */
export function ChapterSettings({
  chapter,
  projectId,
  onClose,
  onSaved,
}: {
  chapter: Chapter;
  projectId: ID;
  onClose: () => void;
  onSaved: () => void;
}) {
  const notify = useAppStore((s) => s.notify);
  const characters = useCharacters(projectId);
  const world = useWorldEntries(projectId);
  const threads = useThreads(projectId);

  const [title, setTitle] = useState(chapter.title);
  const [summary, setSummary] = useState(chapter.summary ?? "");
  const [goals, setGoals] = useState(chapter.goals.join("\n"));
  const [hook, setHook] = useState(chapter.hook ?? "");
  const [cliffhanger, setCliffhanger] = useState(chapter.cliffhanger ?? "");
  const [storyTime, setStoryTime] = useState(chapter.storyTime ?? "");
  const [status, setStatus] = useState<ChapterStatus>(chapter.status);
  const [tension, setTension] = useState(chapter.tension);
  const [characterIds, setCharacterIds] = useState<string[]>(chapter.characterIds);
  const [locationIds, setLocationIds] = useState<string[]>(chapter.locationIds);
  const [plants, setPlants] = useState<string[]>(chapter.plantsThreadIds);
  const [pays, setPays] = useState<string[]>(chapter.paysThreadIds);
  const [saving, setSaving] = useState(false);

  const toggle = (list: string[], setter: (v: string[]) => void, id: string) => {
    setter(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  };

  const save = async () => {
    setSaving(true);
    try {
      await updateChapter(chapter.id, {
        title: title.trim() || chapter.title,
        summary: summary.trim() || undefined,
        goals: goals
          .split(String.fromCharCode(10))
          .map((g) => g.trim())
          .filter(Boolean),
        hook: hook.trim() || undefined,
        cliffhanger: cliffhanger.trim() || undefined,
        storyTime: storyTime.trim() || undefined,
        status,
        tension,
        characterIds,
        locationIds,
        plantsThreadIds: plants,
        paysThreadIds: pays,
      });
      onSaved();
      onClose();
    } catch (e) {
      notify("danger", "保存失败", e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-black/5 px-5 py-3 dark:border-white/5">
          <h3 className="text-sm font-semibold">章节属性</h3>
          <Button isIconOnly size="sm" variant="ghost" onPress={onClose}>
            <X className="size-4" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <TextField value={title} onChange={setTitle}>
            <Label>章节名</Label>
            <Input />
          </TextField>

          <TextField value={summary} onChange={setSummary}>
            <Label>本章梗概（会进入 AI 上下文）</Label>
            <TextArea rows={2} placeholder="本章发生了什么，推进了什么" />
          </TextField>

          <TextField value={goals} onChange={setGoals}>
            <Label>必须完成的推进点（每行一条）</Label>
            <TextArea rows={3} placeholder={"主角第一次见到反派。每行一条，AI 会按这些目标来写。"} />
          </TextField>

          <div className="grid gap-3 sm:grid-cols-2">
            <TextField value={hook} onChange={setHook}>
              <Label>开篇钩子</Label>
              <Input placeholder="第一句就要抓人" />
            </TextField>
            <TextField value={cliffhanger} onChange={setCliffhanger}>
              <Label>结尾悬念</Label>
              <Input placeholder="让读者想翻下一章" />
            </TextField>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label className="mb-1.5 block text-xs">状态</Label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as ChapterStatus)}
                className="w-full rounded-lg border border-black/10 bg-transparent px-2 py-1.5 text-sm dark:border-white/15"
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {CHAPTER_STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>
            <TextField value={storyTime} onChange={setStoryTime}>
              <Label>剧情内时间</Label>
              <Input placeholder="第三年·春" />
            </TextField>
            <div>
              <Label className="mb-1.5 block text-xs">张力 {tension}</Label>
              <input
                type="range"
                min={-5}
                max={5}
                step={1}
                value={tension}
                onChange={(e) => setTension(Number(e.target.value))}
                className="w-full accent-violet-500"
              />
            </div>
          </div>

          <div>
            <Label className="mb-2 block text-xs">出场人物</Label>
            <div className="flex flex-wrap gap-1.5">
              {characters.map((c) => (
                <button key={c.id} type="button" onClick={() => toggle(characterIds, setCharacterIds, c.id)}>
                  <Chip size="sm" color={characterIds.includes(c.id) ? "accent" : "default"}>
                    {c.name}
                  </Chip>
                </button>
              ))}
              {characters.length === 0 && <p className="text-xs opacity-50">还没有人物卡</p>}
            </div>
          </div>

          <div>
            <Label className="mb-2 block text-xs">地点</Label>
            <div className="flex flex-wrap gap-1.5">
              {world
                .filter((w) => w.category === "geography" || w.category === "organization")
                .map((w) => (
                  <button key={w.id} type="button" onClick={() => toggle(locationIds, setLocationIds, w.id)}>
                    <Chip size="sm" color={locationIds.includes(w.id) ? "accent" : "default"}>
                      {w.title}
                    </Chip>
                  </button>
                ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="mb-2 block text-xs">本章埋下的伏笔</Label>
              <div className="space-y-1">
                {threads.map((t) => (
                  <label key={t.id} className="flex cursor-pointer items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={plants.includes(t.id)}
                      onChange={() => toggle(plants, setPlants, t.id)}
                      className="accent-violet-500"
                    />
                    <span className="truncate">{t.title}</span>
                  </label>
                ))}
                {threads.length === 0 && <p className="text-xs opacity-50">还没有伏笔条目</p>}
              </div>
            </div>
            <div>
              <Label className="mb-2 block text-xs">本章回收的伏笔</Label>
              <div className="space-y-1">
                {threads.map((t) => (
                  <label key={t.id} className="flex cursor-pointer items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={pays.includes(t.id)}
                      onChange={() => toggle(pays, setPays, t.id)}
                      className="accent-emerald-500"
                    />
                    <span className="truncate">{t.title}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-black/5 px-5 py-3 dark:border-white/5">
          <Button variant="ghost" onPress={onClose}>
            取消
          </Button>
          <Button variant="primary" isPending={saving} onPress={() => void save()}>
            保存
          </Button>
        </div>
      </div>
    </div>
  );
}
