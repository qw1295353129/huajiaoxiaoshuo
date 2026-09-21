import { useEffect, useMemo, useState } from "react";
import { Button, Chip, Modal } from "@heroui/react";
import { Check, Info, MapPin, Save } from "lucide-react";
import type { Arc, Chapter, Character, ID, TimelineEvent, WorldEntry } from "@/core";
import { upsertTimelineEvent } from "@/db/repo/story";
import { useAppStore } from "@/app/store";
import { WORLD_CATEGORY_LABELS } from "@/db/defaults";
import {
  IMPORTANCE_LABELS,
  chapterLabel,
  parseStoryTime,
  sortedChapters,
} from "./timelineMeta";
import { DIVIDER_CLASS, FIELD_CLASS, LABEL_CLASS, SELECT_CLASS } from "./styles";

interface FormState {
  title: string;
  description: string;
  inWorldTime: string;
  orderKey: string;
  durationDays: string;
  importance: number;
  chapterIds: ID[];
  participantIds: ID[];
  locationId: string;
  arcId: string;
}

const EMPTY_FORM: FormState = {
  title: "",
  description: "",
  inWorldTime: "",
  orderKey: "",
  durationDays: "",
  importance: 3,
  chapterIds: [],
  participantIds: [],
  locationId: "",
  arcId: "",
};

function toForm(event: TimelineEvent): FormState {
  return {
    title: event.title,
    description: event.description ?? "",
    inWorldTime: event.inWorldTime ?? "",
    orderKey: String(event.orderKey),
    durationDays: event.durationDays === undefined ? "" : String(event.durationDays),
    importance: event.importance,
    chapterIds: event.chapterIds ?? [],
    participantIds: event.participantIds ?? [],
    locationId: event.locationId ?? "",
    arcId: event.arcId ?? "",
  };
}

/** 时间线事件的新建 / 编辑弹窗。 */
export function TimelineEventModal({
  projectId,
  open,
  onOpenChange,
  event,
  chapters,
  characters,
  worldEntries,
  arcs,
  suggestedChapterId,
  suggestedOrderKey,
  onSaved,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: TimelineEvent | null;
  chapters: Chapter[];
  characters: Character[];
  worldEntries: WorldEntry[];
  arcs: Arc[];
  suggestedChapterId?: ID;
  suggestedOrderKey?: number;
  onSaved: () => void;
}) {
  const notify = useAppStore((s) => s.notify);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const editingId = event?.id;
  useEffect(() => {
    if (!open) return;
    const current = event;
    if (current) setForm(toForm(current));
    else
      setForm({
        ...EMPTY_FORM,
        chapterIds: suggestedChapterId ? [suggestedChapterId] : [],
        orderKey: suggestedOrderKey === undefined ? "" : String(suggestedOrderKey),
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editingId, suggestedChapterId, suggestedOrderKey]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const chapterOptions = useMemo(() => sortedChapters(chapters), [chapters]);
  const geography = useMemo(
    () => worldEntries.filter((w) => w.category === "geography").sort((a, b) => a.title.localeCompare(b.title, "zh")),
    [worldEntries],
  );

  const parsed = parseStoryTime(form.inWorldTime);
  const parsedHint = form.inWorldTime.trim()
    ? parsed
      ? "识别为：" + parsed.label
      : "未能识别出「年 / 月 / 日 / 季节」，该事件将不参与时间先后比对"
    : "示例：第三年·春、景和十二年三月、开战前夜";

  const toggle = (key: "chapterIds" | "participantIds", id: ID) => {
    const list = form[key];
    set(key, list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  };

  const save = async () => {
    const title = form.title.trim();
    if (!title) {
      notify("warning", "请先填写事件标题");
      return;
    }
    const orderKey = Number(form.orderKey);
    setSaving(true);
    try {
      const duration = form.durationDays.trim() === "" ? undefined : Number(form.durationDays);
      const patch: Partial<TimelineEvent> & { title: string } = {
        title,
        description: form.description.trim() || undefined,
        inWorldTime: form.inWorldTime.trim(),
        orderKey: Number.isFinite(orderKey) && form.orderKey.trim() !== "" ? orderKey : Date.now(),
        durationDays: duration !== undefined && Number.isFinite(duration) ? duration : undefined,
        importance: Math.min(5, Math.max(1, Math.round(form.importance))) as TimelineEvent["importance"],
        chapterIds: form.chapterIds,
        participantIds: form.participantIds,
        locationId: form.locationId || undefined,
        arcId: form.arcId || undefined,
      };
      if (event) patch.id = event.id;
      await upsertTimelineEvent(projectId, patch);
      notify("success", event ? "事件已更新" : "事件已创建", title);
      onSaved();
      onOpenChange(false);
    } catch (e) {
      notify("danger", "保存失败", e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={open} onOpenChange={onOpenChange}>
      <Modal.Backdrop>
        <Modal.Container size="lg">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>{event ? "编辑时间线事件" : "新建时间线事件"}</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <div className="space-y-4">
                <div>
                  <label className={LABEL_CLASS}>事件标题 *</label>
                  <input
                    className={FIELD_CLASS}
                    value={form.title}
                    autoFocus
                    placeholder="例如：林远在雨夜第一次见到师父"
                    onChange={(e) => set("title", e.target.value)}
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <label className={LABEL_CLASS}>剧情内时间</label>
                    <input
                      className={FIELD_CLASS}
                      value={form.inWorldTime}
                      placeholder="第三年·春"
                      onChange={(e) => set("inWorldTime", e.target.value)}
                    />
                    <p className={"mt-1 text-[11px] leading-relaxed " + (form.inWorldTime.trim() && !parsed ? "text-amber-500" : "opacity-45")}>
                      {parsedHint}
                    </p>
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>持续天数</label>
                    <input
                      className={FIELD_CLASS}
                      value={form.durationDays}
                      inputMode="numeric"
                      placeholder="0 表示瞬时事件"
                      onChange={(e) => set("durationDays", e.target.value)}
                    />
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>排序键</label>
                    <input
                      className={FIELD_CLASS}
                      value={form.orderKey}
                      inputMode="numeric"
                      placeholder="留空自动生成"
                      onChange={(e) => set("orderKey", e.target.value)}
                    />
                    <p className="mt-1 text-[11px] opacity-45">数字越小越靠前，用于同一时间点内的先后</p>
                  </div>
                </div>

                <div>
                  <label className={LABEL_CLASS}>重要性</label>
                  <div className="flex flex-wrap gap-1.5">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button key={n} type="button" className="transition active:scale-95" onClick={() => set("importance", n)}>
                        <Chip size="sm" color={form.importance === n ? "accent" : "default"}>
                          {form.importance === n && <Check className="mr-0.5 inline size-3" />}
                          {n} · {IMPORTANCE_LABELS[n]}
                        </Chip>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className={LABEL_CLASS}>关联章节（可多选）</label>
                  {chapterOptions.length === 0 ? (
                    <p className="text-xs opacity-50">项目里还没有章节，可以先去「大纲」页建立章节。</p>
                  ) : (
                    <>
                      <div className={"max-h-40 overflow-y-auto rounded-lg border p-1.5 " + DIVIDER_CLASS}>
                        <div className="flex flex-wrap gap-1.5">
                          {chapterOptions.map((c) => {
                            const active = form.chapterIds.includes(c.id);
                            return (
                              <button key={c.id} type="button" className="transition active:scale-95" onClick={() => toggle("chapterIds", c.id)}>
                                <Chip size="sm" color={active ? "accent" : "default"}>
                                  {chapterLabel(chapters, c.id)}
                                </Chip>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div className="mt-1.5 flex items-center gap-3 text-[11px] opacity-50">
                        <span>已选 {form.chapterIds.length} 章</span>
                        {form.chapterIds.length > 0 && (
                          <button type="button" className="underline-offset-2 hover:underline" onClick={() => set("chapterIds", [])}>
                            清空
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className={LABEL_CLASS}>参与人物</label>
                    {characters.length === 0 ? (
                      <p className="text-xs opacity-50">还没有人物，先去「人物」页建立角色。</p>
                    ) : (
                      <div className={"max-h-36 overflow-y-auto rounded-lg border p-1.5 " + DIVIDER_CLASS}>
                        <div className="flex flex-wrap gap-1.5">
                          {characters.map((c) => {
                            const active = form.participantIds.includes(c.id);
                            return (
                              <button key={c.id} type="button" className="transition active:scale-95" onClick={() => toggle("participantIds", c.id)}>
                                <Chip size="sm" color={active ? "accent" : "default"}>
                                  {c.avatarEmoji ? c.avatarEmoji + " " : ""}
                                  {c.name}
                                </Chip>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="space-y-4">
                    <div>
                      <label className={LABEL_CLASS}>地点</label>
                      <select className={SELECT_CLASS} value={form.locationId} onChange={(e) => set("locationId", e.target.value)}>
                        <option value="">未指定</option>
                        {geography.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.title}
                            {" · " + (WORLD_CATEGORY_LABELS[w.category] ?? w.category)}
                          </option>
                        ))}
                      </select>
                      {geography.length === 0 && (
                        <p className="mt-1 flex items-center gap-1 text-[11px] opacity-45">
                          <MapPin className="size-3" />
                          世界观里还没有「地理」类条目
                        </p>
                      )}
                    </div>
                    <div>
                      <label className={LABEL_CLASS}>所属卷 / 幕</label>
                      <select className={SELECT_CLASS} value={form.arcId} onChange={(e) => set("arcId", e.target.value)}>
                        <option value="">未指定</option>
                        {arcs.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.title}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                <div>
                  <label className={LABEL_CLASS}>事件描述</label>
                  <textarea
                    className={FIELD_CLASS}
                    rows={3}
                    value={form.description}
                    placeholder="这段时间里发生了什么、谁在场、造成了什么后果"
                    onChange={(e) => set("description", e.target.value)}
                  />
                </div>

                <p className="flex items-start gap-1.5 rounded-lg bg-black/[0.05] p-2.5 text-[11px] leading-relaxed opacity-70">
                  <Info className="mt-0.5 size-3.5 shrink-0 text-neutral-700" />
                  剧情内时间是自由文本，只要写清「年 / 月 / 日 / 季节」就能参与先后比对；
                  写「三年后」这类相对时间不会被比对，以免误报。
                </p>
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="ghost" onPress={() => onOpenChange(false)}>
                取消
              </Button>
              <Button variant="primary" isPending={saving} onPress={save}>
                <Save className="size-4" />
                {event ? "保存修改" : "创建事件"}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
