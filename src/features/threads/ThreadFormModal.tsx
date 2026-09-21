import { useEffect, useMemo, useState } from "react";
import { Button, Chip, Modal } from "@heroui/react";
import { Check, Save, Sparkles } from "lucide-react";
import type { Chapter, Character, ID, PlotThread } from "@/core";
import { upsertThread } from "@/db/repo/story";
import { useAppStore } from "@/app/store";
import { truncate } from "@/utils/text";
import {
  THREAD_KIND_HINTS,
  THREAD_KIND_LABELS,
  THREAD_KINDS,
  THREAD_PRIORITIES,
  THREAD_PRIORITY_LABELS,
  THREAD_STATUSES,
  THREAD_STATUS_LABELS,
  chapterLabel,
  chapterOrder,
} from "./threadMeta";
import { FIELD_CLASS, DIVIDER_CLASS, LABEL_CLASS, SELECT_CLASS } from "./styles";

interface FormState {
  title: string;
  kind: PlotThread["kind"];
  priority: PlotThread["priority"];
  status: PlotThread["status"];
  description: string;
  plantedChapterId: string;
  plannedPayoffChapterId: string;
  payoffChapterId: string;
  plantQuote: string;
  payoffQuote: string;
  notes: string;
  characterIds: ID[];
}

const EMPTY_FORM: FormState = {
  title: "",
  kind: "foreshadow",
  priority: "major",
  status: "planned",
  description: "",
  plantedChapterId: "",
  plannedPayoffChapterId: "",
  payoffChapterId: "",
  plantQuote: "",
  payoffQuote: "",
  notes: "",
  characterIds: [],
};

function toForm(thread: PlotThread): FormState {
  return {
    title: thread.title,
    kind: thread.kind,
    priority: thread.priority,
    status: thread.status,
    description: thread.description ?? "",
    plantedChapterId: thread.plantedChapterId ?? "",
    plannedPayoffChapterId: thread.plannedPayoffChapterId ?? "",
    payoffChapterId: thread.payoffChapterId ?? "",
    plantQuote: thread.plantQuote ?? "",
    payoffQuote: thread.payoffQuote ?? "",
    notes: thread.notes ?? "",
    characterIds: thread.characterIds ?? [],
  };
}

/** 新建 / 编辑伏笔的表单弹窗。 */
export function ThreadFormModal({
  projectId,
  open,
  onOpenChange,
  thread,
  chapters,
  characters,
  suggestedChapterId,
  onSaved,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  thread: PlotThread | null;
  chapters: Chapter[];
  characters: Character[];
  /** 从热力图 / 看板点进来时预填的章节 */
  suggestedChapterId?: ID;
  onSaved: () => void;
}) {
  const notify = useAppStore((s) => s.notify);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // 每次打开时按当前编辑对象重置表单
  useEffect(() => {
    if (!open) return;
    if (thread) setForm(toForm(thread));
    else setForm(EMPTY_FORM);
  }, [open, thread]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const plantedOrder = chapterOrder(chapters, form.plantedChapterId || undefined);
  const plannedOrder = chapterOrder(chapters, form.plannedPayoffChapterId || undefined);

  /** 章节下拉：按 order 升序 */
  const sortedChapters = useMemo(() => [...chapters].sort((a, b) => a.order - b.order), [chapters]);

  /** 简明的表单校验提示 */
  const warnings = useMemo(() => {
    const list: string[] = [];
    if (plantedOrder !== undefined && plannedOrder !== undefined && plannedOrder < plantedOrder) {
      list.push("计划回收章在埋设章之前，回收顺序不合理");
    }
    const payoffOrder = chapterOrder(chapters, form.payoffChapterId || undefined);
    if (payoffOrder !== undefined && plantedOrder !== undefined && payoffOrder < plantedOrder) {
      list.push("实际回收章早于埋设章");
    }
    if (form.status === "resolved" && !form.payoffChapterId) {
      list.push("状态是「已回收」，建议补上实际回收章");
    }
    if (form.plantedChapterId && form.status === "planned") {
      list.push("已选埋设章，状态可以改成「已埋设」");
    }
    return list;
  }, [chapters, form.payoffChapterId, form.plannedPayoffChapterId, form.plantedChapterId, form.status, plantedOrder, plannedOrder]);

  const save = async () => {
    const title = form.title.trim();
    if (!title) {
      notify("warning", "请先填写伏笔标题");
      return;
    }
    setSaving(true);
    try {
      const patch: Partial<PlotThread> & { title: string } = {
        title,
        kind: form.kind,
        priority: form.priority,
        status: form.status,
        description: form.description.trim() || undefined,
        plantedChapterId: form.plantedChapterId || undefined,
        plannedPayoffChapterId: form.plannedPayoffChapterId || undefined,
        payoffChapterId: form.payoffChapterId || undefined,
        plantQuote: form.plantQuote.trim() || undefined,
        payoffQuote: form.payoffQuote.trim() || undefined,
        notes: form.notes.trim() || undefined,
        characterIds: form.characterIds,
      };
      if (thread) patch.id = thread.id;
      await upsertThread(projectId, patch);
      notify("success", thread ? "伏笔已更新" : "伏笔已创建", title);
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
              <Modal.Heading>{thread ? "编辑伏笔" : "新建伏笔"}</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <div className="space-y-4">
                <div>
                  <label className={LABEL_CLASS}>标题 *</label>
                  <input
                    className={FIELD_CLASS}
                    value={form.title}
                    autoFocus
                    placeholder="例如：老张临终前塞给主角的半块玉佩"
                    onChange={(e) => set("title", e.target.value)}
                  />
                </div>

                <div>
                  <label className={LABEL_CLASS}>类型</label>
                  <div className="flex flex-wrap gap-1.5">
                    {THREAD_KINDS.map((kind) => (
                      <button key={kind} type="button" className="transition active:scale-95" onClick={() => set("kind", kind)}>
                        <Chip size="sm" color={form.kind === kind ? "accent" : "default"}>
                          {form.kind === kind && <Check className="mr-0.5 inline size-3" />}
                          {THREAD_KIND_LABELS[kind]}
                        </Chip>
                      </button>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[11px] leading-relaxed opacity-45">{THREAD_KIND_HINTS[form.kind]}</p>
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <label className={LABEL_CLASS}>优先级</label>
                    <select className={SELECT_CLASS} value={form.priority} onChange={(e) => set("priority", e.target.value as PlotThread["priority"])}>
                      {THREAD_PRIORITIES.map((p) => (
                        <option key={p} value={p}>
                          {THREAD_PRIORITY_LABELS[p]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>状态</label>
                    <select className={SELECT_CLASS} value={form.status} onChange={(e) => set("status", e.target.value as PlotThread["status"])}>
                      {THREAD_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {THREAD_STATUS_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>关联章节数</label>
                    <div className={"rounded-lg border px-3 py-2 text-sm opacity-70 " + DIVIDER_CLASS}>
                      {[form.plantedChapterId, form.plannedPayoffChapterId, form.payoffChapterId].filter(Boolean).length} / 3 已指定
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <label className={LABEL_CLASS}>埋设章</label>
                    <select
                      className={SELECT_CLASS}
                      value={form.plantedChapterId}
                      onChange={(e) => {
                        const value = e.target.value;
                        set("plantedChapterId", value);
                        if (value && form.status === "planned") set("status", "planted");
                      }}
                    >
                      <option value="">未指定</option>
                      {sortedChapters.map((c) => (
                        <option key={c.id} value={c.id}>
                          {chapterLabel(chapters, c.id)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>计划回收章</label>
                    <select className={SELECT_CLASS} value={form.plannedPayoffChapterId} onChange={(e) => set("plannedPayoffChapterId", e.target.value)}>
                      <option value="">未指定</option>
                      {sortedChapters.map((c) => (
                        <option key={c.id} value={c.id}>
                          {chapterLabel(chapters, c.id)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>实际回收章</label>
                    <select
                      className={SELECT_CLASS}
                      value={form.payoffChapterId}
                      onChange={(e) => {
                        const value = e.target.value;
                        set("payoffChapterId", value);
                        if (value && form.status !== "resolved") set("status", "resolved");
                      }}
                    >
                      <option value="">未指定</option>
                      {sortedChapters.map((c) => (
                        <option key={c.id} value={c.id}>
                          {chapterLabel(chapters, c.id)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {suggestedChapterId && !form.plantedChapterId && (
                  <button
                    type="button"
                    className="text-xs text-violet-500 underline-offset-2 hover:underline"
                    onClick={() => set("plantedChapterId", suggestedChapterId)}
                  >
                    用当前定位的章节（{chapterLabel(chapters, suggestedChapterId)}）作为埋设章
                  </button>
                )}

                <div>
                  <label className={LABEL_CLASS}>描述</label>
                  <textarea
                    className={FIELD_CLASS}
                    rows={3}
                    value={form.description}
                    placeholder="这条伏笔埋的是什么、打算怎么回收、读者应该在什么时候意识到它"
                    onChange={(e) => set("description", e.target.value)}
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className={LABEL_CLASS}>埋设原文片段</label>
                    <textarea
                      className={FIELD_CLASS}
                      rows={3}
                      value={form.plantQuote}
                      placeholder="把正文里埋设的那几句话贴进来"
                      onChange={(e) => set("plantQuote", e.target.value)}
                    />
                  </div>
                  <div>
                    <label className={LABEL_CLASS}>回收原文片段</label>
                    <textarea
                      className={FIELD_CLASS}
                      rows={3}
                      value={form.payoffQuote}
                      placeholder="回收时的那几句话"
                      onChange={(e) => set("payoffQuote", e.target.value)}
                    />
                  </div>
                </div>

                <div>
                  <label className={LABEL_CLASS}>关联人物（可选）</label>
                  {characters.length === 0 ? (
                    <p className="text-xs opacity-50">项目里还没有人物，可以先去「人物」页建立角色。</p>
                  ) : (
                    <div className={"max-h-40 overflow-y-auto rounded-lg border p-1.5 " + DIVIDER_CLASS}>
                      <div className="flex flex-wrap gap-1.5">
                        {characters.map((c) => {
                          const active = form.characterIds.includes(c.id);
                          return (
                            <button
                              key={c.id}
                              type="button"
                              className="transition active:scale-95"
                              onClick={() =>
                                set(
                                  "characterIds",
                                  active ? form.characterIds.filter((id) => id !== c.id) : [...form.characterIds, c.id],
                                )
                              }
                            >
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

                <div>
                  <label className={LABEL_CLASS}>备注</label>
                  <textarea
                    className={FIELD_CLASS}
                    rows={2}
                    value={form.notes}
                    placeholder="给自己看的提醒，例如「回收时要和第三章的雨夜呼应」"
                    onChange={(e) => set("notes", e.target.value)}
                  />
                </div>

                {warnings.length > 0 && (
                  <div className="rounded-lg bg-amber-500/[0.08] p-3">
                    <p className="flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-300">
                      <Sparkles className="size-3.5" />
                      建议检查
                    </p>
                    <ul className="mt-1.5 space-y-1">
                      {warnings.map((w) => (
                        <li key={w} className="text-[11px] leading-relaxed opacity-70">
                          · {w}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {form.description.length > 0 && (
                  <p className="text-[11px] opacity-40">描述预览：{truncate(form.description, 60)}</p>
                )}
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="ghost" onPress={() => onOpenChange(false)}>
                取消
              </Button>
              <Button variant="primary" isPending={saving} onPress={save}>
                <Save className="size-4" />
                {thread ? "保存修改" : "创建伏笔"}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
