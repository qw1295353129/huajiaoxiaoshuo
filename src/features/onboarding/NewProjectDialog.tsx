import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Chip, Input, Label, Modal, TextArea, TextField } from "@heroui/react";
import { ArrowRight, Check, Wand2 } from "lucide-react";
import { ROUTES } from "@/app/routes";
import { GENRES } from "@/db/defaults";
import { createProject } from "@/db/repo/projects";
import { useAppStore } from "@/app/store";
import type { LengthClass, NovelTemplate, PovStyle } from "@/core";
import { lengthProfile } from "@/core";
import { TemplatePicker } from "./TemplatePicker";

const POV_OPTIONS: { value: PovStyle; label: string; hint: string }[] = [
  { value: "third-limited", label: "第三人称限知", hint: "最常见，读者跟着主角的认知走" },
  { value: "first", label: "第一人称", hint: "代入感强，适合悬疑与情感" },
  { value: "third-omniscient", label: "第三人称全知", hint: "史诗感，适合群像" },
  { value: "second", label: "第二人称", hint: "实验性，慎用" },
  { value: "mixed", label: "多视角切换", hint: "按章节/分卷切换视角人物" },
];

const LENGTH_OPTIONS: { value: LengthClass; label: string; words: number }[] = [
  { value: "short", label: "短篇", words: lengthProfile("short").targetWords },
  { value: "novella", label: "中篇", words: lengthProfile("novella").targetWords },
  { value: "novel", label: "长篇", words: lengthProfile("novel").targetWords },
  { value: "epic", label: "超长篇", words: lengthProfile("epic").targetWords },
  { value: "webnovel", label: "网文连载", words: lengthProfile("webnovel").targetWords },
];

/**
 * 新建作品弹窗（全局）。
 * 打开时重置表单；创建成功后跳转总览或一句话成书并关闭。
 */
export function NewProjectDialog() {
  const navigate = useNavigate();
  const open = useAppStore((s) => s.newProjectOpen);
  const setOpen = useAppStore((s) => s.setNewProjectOpen);
  const setProject = useAppStore((s) => s.setProject);

  const [title, setTitle] = useState("");
  const [logline, setLogline] = useState("");
  const [synopsis, setSynopsis] = useState("");
  const [genres, setGenres] = useState<string[]>([]);
  const [pov, setPov] = useState<PovStyle>("third-limited");
  const [lengthClass, setLengthClass] = useState<LengthClass>("novel");
  const [author, setAuthor] = useState("");
  const [busy, setBusy] = useState(false);
  const [template, setTemplate] = useState<NovelTemplate | null>(null);

  // 每次打开清空，避免上次残留
  useEffect(() => {
    if (!open) return;
    setTitle("");
    setLogline("");
    setSynopsis("");
    setGenres([]);
    setPov("third-limited");
    setLengthClass("novel");
    setAuthor("");
    setTemplate(null);
    setBusy(false);
  }, [open]);

  const toggleGenre = (g: string) => {
    setGenres((prev) => (prev.includes(g) ? prev.filter((x) => x !== g) : prev.length >= 3 ? prev : [...prev, g]));
  };

  const applyTemplate = (t: NovelTemplate | null) => {
    setTemplate(t);
    if (!t) return;
    setLogline(t.seed || t.logline);
    setGenres(t.genres.slice(0, 3));
    setPov(t.pov);
    setLengthClass(t.lengthClass);
    if (!title.trim()) setTitle(t.name.split("·")[0] ?? "");
  };

  const submit = async (goGenesis: boolean) => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      const target = lengthProfile(lengthClass).targetWords;
      const project = await createProject({
        title,
        logline,
        synopsis,
        genres,
        pov,
        lengthClass,
        targetWords: target,
        author,
        themes: template?.toneKeywords ?? [],
      });
      await setProject(project);
      setOpen(false);
      navigate(goGenesis ? ROUTES.genesis(project.id) : ROUTES.overview(project.id));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={open} onOpenChange={setOpen}>
      <Modal.Backdrop>
        <Modal.Container size="lg" scroll="inside">
          <Modal.Dialog aria-label="新建作品">
            <Modal.Header>
              <Modal.Heading>新建作品</Modal.Heading>
              <p className="mt-1 text-xs leading-relaxed opacity-55">
                选个模板当起点，或只填最少的信息交给「一句话成书」。
              </p>
            </Modal.Header>

            <Modal.Body>
              <div className="space-y-5">
                <TemplatePicker selectedId={template?.id} onChange={applyTemplate} />

                <div className="h-px bg-black/5 dark:bg-white/10" />

                <TextField value={title} onChange={setTitle} isRequired>
                  <Label>书名</Label>
                  <Input placeholder="例如：长夜将至" />
                </TextField>

                <TextField value={logline} onChange={setLogline}>
                  <Label>一句话故事（可留空，AI 可以帮你补）</Label>
                  <TextArea rows={2} placeholder="例如：一个能听见死者遗言的验尸官，发现自己的名字出现在下一具尸体上。" />
                </TextField>

                <TextField value={synopsis} onChange={setSynopsis}>
                  <Label>故事简介（可留空）</Label>
                  <TextArea
                    rows={4}
                    placeholder="几段话概括主线：主角是谁、要解决什么、阻力从哪来、大致走向如何。会进入 AI 上下文。"
                  />
                </TextField>

                <div>
                  <Label className="mb-2 block">体裁（最多选 3 个）</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {GENRES.map((g) => (
                      <button key={g} type="button" onClick={() => toggleGenre(g)} className="transition active:scale-95">
                        <Chip color={genres.includes(g) ? "accent" : "default"} size="sm">
                          {genres.includes(g) && <Check className="mr-0.5 inline size-3" />}
                          {g}
                        </Chip>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <Label className="mb-2 block">叙事视角</Label>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {POV_OPTIONS.map((o) => (
                      <button
                        key={o.value}
                        type="button"
                        onClick={() => setPov(o.value)}
                        className={
                          "rounded-xl border p-3 text-left transition " +
                          (pov === o.value
                            ? "border-black/40 bg-black/[0.04]"
                            : "border-black/8 hover:border-black/20 dark:border-white/10 dark:hover:border-white/25")
                        }
                      >
                        <p className="text-sm font-medium">{o.label}</p>
                        <p className="mt-0.5 text-xs opacity-60">{o.hint}</p>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <Label className="mb-2 block">目标篇幅</Label>
                  <div className="flex flex-wrap gap-2">
                    {LENGTH_OPTIONS.map((o) => (
                      <button
                        key={o.value}
                        type="button"
                        onClick={() => setLengthClass(o.value)}
                        className={
                          "rounded-lg border px-3 py-1.5 text-sm transition " +
                          (lengthClass === o.value
                            ? "border-black/40 bg-black/[0.04] font-medium"
                            : "border-black/8 hover:border-black/20 dark:border-white/10 dark:hover:border-white/25")
                        }
                      >
                        {o.label}
                        <span className="ml-1.5 text-xs opacity-50">{(o.words / 10000).toFixed(0)}万字</span>
                      </button>
                    ))}
                  </div>
                </div>

                <TextField value={author} onChange={setAuthor}>
                  <Label>作者署名（可留空）</Label>
                  <Input placeholder="笔名" />
                </TextField>
              </div>
            </Modal.Body>

            <Modal.Footer>
              <Button size="sm" variant="ghost" isDisabled={busy} onPress={() => setOpen(false)}>
                取消
              </Button>
              <Button size="sm" variant="outline" isDisabled={!title.trim() || busy} onPress={() => void submit(false)}>
                先创建空白项目
                <ArrowRight className="size-3.5" />
              </Button>
              <Button size="sm" variant="primary" isDisabled={!title.trim() || busy} onPress={() => void submit(true)}>
                <Wand2 className="size-3.5" />
                创建并用 AI 建档
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
