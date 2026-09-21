import { useState } from "react";
import type { ID } from "@/core";
import { Button, Chip, Input, Label, Modal, TextArea, TextField } from "@heroui/react";
import { AlertTriangle, Loader2, RefreshCw, Sparkles, Wand2 } from "lucide-react";
import { useAppStore } from "@/app/store";
import { errorText, tensionText } from "./outlineMeta";
import { generateOutlineDraft, writeOutlineDraft, type OutlineDraft } from "./outlineAi";

interface Props {
  projectId: ID;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 写入成功后的回调：带上第一个新章节 id，便于自动选中 */
  onWritten: (firstChapterId?: ID) => void;
}

function clampInt(text: string, fallback: number, min: number, max: number): number {
  const n = Number(text.replace(/[^\d]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

/** AI 生成整卷大纲：先生成草稿，弹窗预览卷章结构，确认后再落库 */
export function OutlineGenModal({ projectId, open, onOpenChange, onWritten }: Props) {
  const notify = useAppStore((s) => s.notify);

  const [step, setStep] = useState<"setup" | "preview">("setup");
  const [volumeText, setVolumeText] = useState("3");
  const [chapterText, setChapterText] = useState("12");
  const [requirement, setRequirement] = useState("");
  const [draft, setDraft] = useState<OutlineDraft>();
  const [busy, setBusy] = useState(false);
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState<string>();

  const volumeCount = clampInt(volumeText, 3, 1, 12);
  const chaptersPerVolume = clampInt(chapterText, 12, 1, 80);
  const totalChapters = draft ? draft.arcs.reduce((n, a) => n + a.chapters.length, 0) : 0;

  const close = (next: boolean) => {
    if (!next) {
      setStep("setup");
      setDraft(undefined);
      setError(undefined);
    }
    onOpenChange(next);
  };

  const run = async () => {
    setBusy(true);
    setError(undefined);
    const res = await generateOutlineDraft(projectId, { volumeCount, chaptersPerVolume, requirement });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setDraft(res.draft);
    setStep("preview");
  };

  const confirm = async () => {
    if (!draft) return;
    setWriting(true);
    setError(undefined);
    try {
      const result = await writeOutlineDraft(projectId, draft);
      notify("success", "大纲已写入", result.arcs + " 卷 · " + result.chapters + " 章");
      onWritten(result.firstChapterId);
      close(false);
    } catch (e) {
      setError(errorText(e));
      notify("danger", "写入大纲失败", errorText(e));
    } finally {
      setWriting(false);
    }
  };

  return (
    <Modal isOpen={open} onOpenChange={close}>
      <Modal.Backdrop>
        <Modal.Container size="lg">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>AI 生成整卷大纲</Modal.Heading>
            </Modal.Header>
            <Modal.Body className="max-h-[60vh] overflow-y-auto">
              {step === "setup" ? (
                <div className="space-y-4">
                  <p className="text-xs leading-relaxed opacity-60">
                    AI 会结合作品档案、人物与世界观，先给出「卷 → 章」的完整结构草稿；你确认后才会写入数据库，不会覆盖已有内容。
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <TextField value={volumeText} onChange={setVolumeText}>
                      <Label>卷数</Label>
                      <Input inputMode="numeric" placeholder="3" />
                    </TextField>
                    <TextField value={chapterText} onChange={setChapterText}>
                      <Label>每卷章数</Label>
                      <Input inputMode="numeric" placeholder="12" />
                    </TextField>
                  </div>
                  <TextField value={requirement} onChange={setRequirement}>
                    <Label>补充要求（可留空）</Label>
                    <TextArea rows={3} placeholder="例如：第一卷要在第 5 章前完成主角的觉醒；不要出现穿越设定。" />
                  </TextField>
                  <p className="text-[11px] opacity-45">
                    将生成约 {volumeCount} 卷 · {volumeCount * chaptersPerVolume} 章，耗时取决于所选模型。
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs opacity-60">
                    <Chip size="sm" color="accent">
                      {draft?.arcs.length ?? 0} 卷
                    </Chip>
                    <Chip size="sm" color="accent">
                      {totalChapters} 章
                    </Chip>
                    {draft?.model && <span className="opacity-70">模型：{draft.model}</span>}
                    {draft?.logline && <span className="line-clamp-1">· {draft.logline}</span>}
                  </div>
                  <div className="space-y-2">
                    {(draft?.arcs ?? []).map((arc, ai) => (
                      <div key={arc.title + ai} className="rounded-xl border border-black/5 p-3 dark:border-white/5">
                        <p className="text-sm font-medium">
                          {ai + 1}. {arc.title}
                          <span className="ml-2 text-[11px] font-normal opacity-45">{arc.chapters.length} 章</span>
                        </p>
                        {arc.summary && <p className="mt-1 text-xs leading-relaxed opacity-65">{arc.summary}</p>}
                        {(arc.goal || arc.conflict) && (
                          <p className="mt-1 text-[11px] leading-relaxed opacity-50">
                            {[arc.goal ? "目标：" + arc.goal : "", arc.conflict ? "冲突：" + arc.conflict : ""].filter(Boolean).join(" · ")}
                          </p>
                        )}
                        <ul className="mt-2 space-y-1">
                          {arc.chapters.map((chapter, ci) => (
                            <li key={chapter.title + ci} className="flex items-start gap-2 text-xs">
                              <span className="tabular w-6 shrink-0 text-right opacity-40">{ci + 1}</span>
                              <span className="min-w-0 flex-1">
                                <span className="font-medium">{chapter.title}</span>
                                {chapter.summary && <span className="ml-1 opacity-60">— {chapter.summary}</span>}
                              </span>
                              <span className="tabular shrink-0 text-[11px] text-neutral-700">{tensionText(chapter.tension)}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {error && (
                <div className="mt-4 flex items-start gap-2 rounded-xl border border-rose-500/25 bg-rose-500/[0.06] px-3 py-2 text-xs text-rose-600 dark:text-rose-400">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  <span className="leading-relaxed">{error}</span>
                </div>
              )}
            </Modal.Body>
            <Modal.Footer>
              {step === "setup" ? (
                <>
                  <Button variant="ghost" onPress={() => close(false)}>
                    取消
                  </Button>
                  <Button variant="primary" isPending={busy} onPress={() => void run()}>
                    {busy ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
                    开始生成
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="ghost" onPress={() => setStep("setup")}>
                    返回修改
                  </Button>
                  <Button variant="outline" isPending={busy} onPress={() => void run()}>
                    <RefreshCw className="size-4" />
                    重新生成
                  </Button>
                  <Button variant="primary" isPending={writing} onPress={() => void confirm()}>
                    <Sparkles className="size-4" />
                    确认写入 {(draft?.arcs.length ?? 0)} 卷 / {totalChapters} 章
                  </Button>
                </>
              )}
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
