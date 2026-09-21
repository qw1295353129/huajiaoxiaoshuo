import { useEffect, useMemo, useState } from "react";
import { Button, Card, Chip, Modal } from "@heroui/react";
import { Check, RefreshCw, Sparkles, TriangleAlert, Wand2 } from "lucide-react";
import type { Chapter, Character, TimelineEvent, WorldEntry } from "@/core";
import { extractFromChapter } from "@/ai/extract";
import { upsertTimelineEvent } from "@/db/repo/story";
import { Loading } from "@/components/common/ui";
import { useAppStore } from "@/app/store";
import { IMPORTANCE_LABELS, chapterLabel, sortedChapters } from "./timelineMeta";
import { DIVIDER_CLASS, FIELD_CLASS, LABEL_CLASS, SELECT_CLASS } from "./styles";

interface DraftEvent {
  key: string;
  checked: boolean;
  title: string;
  inWorldTime: string;
  importance: number;
  participants: string[];
  location: string;
  /** 已经匹配到的人物 / 地点 */
  matchedCharacterIds: string[];
  matchedLocationId?: string;
}

type Phase =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "preview"; model?: string };

/** AI 抽取时间线：对选中章节调用 extractFromChapter，只取时间线部分，预览后落库。 */
export function TimelineExtractModal({
  projectId,
  open,
  onOpenChange,
  chapters,
  characters,
  worldEntries,
  existingEvents,
  onSaved,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chapters: Chapter[];
  characters: Character[];
  worldEntries: WorldEntry[];
  existingEvents: TimelineEvent[];
  onSaved: () => void;
}) {
  const notify = useAppStore((s) => s.notify);
  const chapterOptions = useMemo(() => sortedChapters(chapters), [chapters]);
  const [chapterId, setChapterId] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [drafts, setDrafts] = useState<DraftEvent[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setPhase({ kind: "idle" });
      setDrafts([]);
      return;
    }
    if (!chapterId && chapterOptions.length > 0) setChapterId(chapterOptions[0].id);
  }, [open, chapterId, chapterOptions]);

  const geography = useMemo(() => worldEntries.filter((w) => w.category === "geography"), [worldEntries]);

  /** 按名字（含别名）把 AI 给出的人名/地名对回库里的实体 */
  const matchCharacters = (names: string[]): string[] => {
    const ids: string[] = [];
    for (const raw of names) {
      const name = raw.trim();
      if (!name) continue;
      const hit = characters.find((c) => c.name === name || c.aliases.includes(name) || c.name.includes(name));
      if (hit && !ids.includes(hit.id)) ids.push(hit.id);
    }
    return ids;
  };

  const matchLocation = (name: string): string | undefined => {
    const target = name.trim();
    if (!target) return undefined;
    return geography.find((w) => w.title === target || w.aliases.includes(target) || w.title.includes(target))?.id;
  };

  const run = async () => {
    if (!chapterId) {
      notify("warning", "请先选择要抽取的章节");
      return;
    }
    setPhase({ kind: "loading" });
    try {
      const res = await extractFromChapter(projectId, chapterId);
      if (!res.ok || !res.bundle) {
        setPhase({ kind: "error", message: res.error ?? "抽取失败" });
        return;
      }
      const timeline = res.bundle.timeline ?? [];
      const next: DraftEvent[] = timeline.map((item, index) => ({
        key: "draft-" + index,
        checked: true,
        title: item.title || "未命名事件",
        inWorldTime: item.inWorldTime ?? "",
        importance: Math.min(5, Math.max(1, Math.round(item.importance || 3))),
        participants: item.participants ?? [],
        location: item.location ?? "",
        matchedCharacterIds: matchCharacters(item.participants ?? []),
        matchedLocationId: matchLocation(item.location ?? ""),
      }));
      setDrafts(next);
      setPhase({ kind: "preview", model: res.model });
      if (next.length === 0) notify("info", "这一章没有抽取到时间线事件");
    } catch (e) {
      setPhase({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  const duplicateKeys = useMemo(() => {
    const set = new Set<string>();
    for (const draft of drafts) {
      const dup = existingEvents.some(
        (e) => e.chapterIds.includes(chapterId) && e.title.trim() === draft.title.trim(),
      );
      if (dup) set.add(draft.key);
    }
    return set;
  }, [drafts, existingEvents, chapterId]);

  const save = async () => {
    const picked = drafts.filter((d) => d.checked && !duplicateKeys.has(d.key));
    if (picked.length === 0) {
      notify("warning", "没有可写入的事件", "勾选至少一条，或先处理重复项");
      return;
    }
    setSaving(true);
    try {
      const base = Date.now();
      let index = 0;
      for (const draft of picked) {
        await upsertTimelineEvent(projectId, {
          title: draft.title.trim() || "未命名事件",
          inWorldTime: draft.inWorldTime.trim(),
          orderKey: base + index,
          importance: Math.min(5, Math.max(1, Math.round(draft.importance))) as TimelineEvent["importance"],
          chapterIds: chapterId ? [chapterId] : [],
          participantIds: draft.matchedCharacterIds,
          locationId: draft.matchedLocationId,
        });
        index += 1;
      }
      notify("success", "已写入 " + picked.length + " 条时间线事件", chapterLabel(chapters, chapterId));
      onSaved();
      onOpenChange(false);
    } catch (e) {
      notify("danger", "写入失败", e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const checkedCount = drafts.filter((d) => d.checked && !duplicateKeys.has(d.key)).length;

  return (
    <Modal isOpen={open} onOpenChange={onOpenChange}>
      <Modal.Backdrop>
        <Modal.Container size="lg">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>AI 抽取时间线</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <div className="space-y-4">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="min-w-[220px] flex-1">
                    <label className={LABEL_CLASS}>选择章节</label>
                    <select className={SELECT_CLASS} value={chapterId} onChange={(e) => setChapterId(e.target.value)}>
                      <option value="">请选择章节</option>
                      {chapterOptions.map((c) => (
                        <option key={c.id} value={c.id}>
                          {chapterLabel(chapters, c.id)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Button
                    variant="primary"
                    isPending={phase.kind === "loading"}
                    isDisabled={chapterOptions.length === 0}
                    onPress={run}
                  >
                    {phase.kind === "preview" ? <RefreshCw className="size-4" /> : <Wand2 className="size-4" />}
                    {phase.kind === "preview" ? "重新抽取" : "开始抽取"}
                  </Button>
                </div>

                <p className="flex items-start gap-1.5 rounded-lg bg-violet-500/[0.07] p-2.5 text-[11px] leading-relaxed opacity-70">
                  <Sparkles className="mt-0.5 size-3.5 shrink-0 text-violet-500" />
                  只使用正文里真实描写过的事件与时间，模型不会凭空推断。抽取结果需要你确认后才会写入数据库。
                </p>

                {chapterOptions.length === 0 && (
                  <p className="text-xs opacity-55">项目里还没有章节，先去「大纲」页建立章节并写点正文。</p>
                )}

                {phase.kind === "loading" && <Loading label="正在阅读本章并抽取时间线…" />}

                {phase.kind === "error" && (
                  <div className="rounded-lg bg-rose-500/[0.08] p-4">
                    <p className="flex items-center gap-2 text-sm font-medium text-rose-600 dark:text-rose-300">
                      <TriangleAlert className="size-4" />
                      抽取失败
                    </p>
                    <p className="mt-2 text-xs leading-relaxed opacity-70">{phase.message}</p>
                    <p className="mt-2 text-[11px] leading-relaxed opacity-50">
                      常见原因：本章正文少于 100 字、还没有配置可用的模型，或网络请求失败。
                    </p>
                  </div>
                )}

                {phase.kind === "preview" && drafts.length === 0 && (
                  <Card className="p-4 text-center text-xs opacity-60">
                    模型没有从这一章里找到明确的时间线事件。可以在正文里补上时间线索后重试。
                  </Card>
                )}

                {phase.kind === "preview" && drafts.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs opacity-60">
                        抽取到 {drafts.length} 条，已勾选 {checkedCount} 条
                        {phase.model ? " · 模型 " + phase.model : ""}
                      </p>
                      <div className="flex items-center gap-2 text-[11px]">
                        <button
                          type="button"
                          className="underline-offset-2 hover:underline"
                          onClick={() => setDrafts((prev) => prev.map((d) => ({ ...d, checked: true })))}
                        >
                          全选
                        </button>
                        <button
                          type="button"
                          className="underline-offset-2 hover:underline"
                          onClick={() => setDrafts((prev) => prev.map((d) => ({ ...d, checked: false })))}
                        >
                          全不选
                        </button>
                      </div>
                    </div>

                    <div className="max-h-[46vh] space-y-2 overflow-y-auto pr-1">
                      {drafts.map((draft) => {
                        const duplicated = duplicateKeys.has(draft.key);
                        return (
                          <Card key={draft.key} className="p-3">
                            <div className="flex items-start gap-2">
                              <input
                                type="checkbox"
                                className="mt-1 size-4 shrink-0 accent-violet-500"
                                checked={draft.checked}
                                onChange={(e) =>
                                  setDrafts((prev) =>
                                    prev.map((d) => (d.key === draft.key ? { ...d, checked: e.target.checked } : d)),
                                  )
                                }
                              />
                              <div className="min-w-0 flex-1 space-y-2">
                                <input
                                  className={FIELD_CLASS}
                                  value={draft.title}
                                  onChange={(e) =>
                                    setDrafts((prev) =>
                                      prev.map((d) => (d.key === draft.key ? { ...d, title: e.target.value } : d)),
                                    )
                                  }
                                />
                                <div className="flex flex-wrap items-center gap-2">
                                  <input
                                    className={FIELD_CLASS + " max-w-[180px]"}
                                    value={draft.inWorldTime}
                                    placeholder="剧情内时间"
                                    onChange={(e) =>
                                      setDrafts((prev) =>
                                        prev.map((d) => (d.key === draft.key ? { ...d, inWorldTime: e.target.value } : d)),
                                      )
                                    }
                                  />
                                  <div className="flex items-center gap-1">
                                    {[1, 2, 3, 4, 5].map((n) => (
                                      <button
                                        key={n}
                                        type="button"
                                        className="transition active:scale-95"
                                        onClick={() =>
                                          setDrafts((prev) => prev.map((d) => (d.key === draft.key ? { ...d, importance: n } : d)))
                                        }
                                      >
                                        <Chip size="sm" color={draft.importance === n ? "accent" : "default"}>
                                          {n}
                                        </Chip>
                                      </button>
                                    ))}
                                    <span className="ml-1 text-[11px] opacity-45">{IMPORTANCE_LABELS[draft.importance]}</span>
                                  </div>
                                </div>

                                <div className={"flex flex-wrap items-center gap-2 border-t pt-2 text-[11px] " + DIVIDER_CLASS}>
                                  {draft.participants.length > 0 && (
                                    <span className="opacity-60">
                                      人物：
                                      {draft.participants.map((p) => {
                                        const matched = matchCharacters([p]).length > 0;
                                        return (
                                          <Chip key={p} size="sm" color={matched ? "success" : "default"}>
                                            {p}
                                            {matched ? "" : "（未匹配）"}
                                          </Chip>
                                        );
                                      })}
                                    </span>
                                  )}
                                  {draft.location && (
                                    <span className="flex items-center gap-1 opacity-60">
                                      地点：
                                      <Chip size="sm" color={draft.matchedLocationId ? "success" : "default"}>
                                        {draft.location}
                                        {draft.matchedLocationId ? "" : "（未匹配）"}
                                      </Chip>
                                    </span>
                                  )}
                                  {duplicated && <Chip size="sm" color="warning">同章已有同名事件，将跳过</Chip>}
                                </div>
                              </div>
                            </div>
                          </Card>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="ghost" onPress={() => onOpenChange(false)}>
                取消
              </Button>
              <Button
                variant="primary"
                isDisabled={phase.kind !== "preview" || checkedCount === 0}
                isPending={saving}
                onPress={save}
              >
                <Check className="size-4" />
                写入 {checkedCount} 条
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
