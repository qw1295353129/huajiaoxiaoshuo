import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Card, Chip, Input, Label, TextArea, TextField } from "@heroui/react";
import { ArrowLeft, ArrowRight, Check, Wand2 } from "lucide-react";
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

// 篇幅的字数与说明统一从 LENGTH_PROFILES 取。
// 之前这里自己维护了一份（长篇 25 万 vs 档案里的 30 万），
// 和一句话成书对不上 —— 同一件事有两份真相，迟早不一致。
const LENGTH_OPTIONS: { value: LengthClass; label: string; words: number; hint: string }[] = [
  { value: "short", label: "短篇", words: lengthProfile("short").targetWords, hint: lengthProfile("short").hint },
  { value: "novella", label: "中篇", words: lengthProfile("novella").targetWords, hint: lengthProfile("novella").hint },
  { value: "novel", label: "长篇", words: lengthProfile("novel").targetWords, hint: lengthProfile("novel").hint },
  { value: "epic", label: "超长篇", words: lengthProfile("epic").targetWords, hint: lengthProfile("epic").hint },
  { value: "webnovel", label: "网文连载", words: lengthProfile("webnovel").targetWords, hint: lengthProfile("webnovel").hint },
];

export function NewProject() {
  const navigate = useNavigate();
  const setProject = useAppStore((s) => s.setProject);
  const [title, setTitle] = useState("");
  const [logline, setLogline] = useState("");
  const [genres, setGenres] = useState<string[]>([]);
  const [pov, setPov] = useState<PovStyle>("third-limited");
  const [lengthClass, setLengthClass] = useState<LengthClass>("novel");
  const [author, setAuthor] = useState("");
  const [busy, setBusy] = useState(false);
  const [template, setTemplate] = useState<NovelTemplate | null>(null);

  const toggleGenre = (g: string) => {
    setGenres((prev) => (prev.includes(g) ? prev.filter((x) => x !== g) : prev.length >= 3 ? prev : [...prev, g]));
  };

  /** 选模板：带出故事种子 / 体裁 / 篇幅 / 视角；书名留空让用户自己起 */
  const applyTemplate = (t: NovelTemplate | null) => {
    setTemplate(t);
    if (!t) return;
    // genesis 用 project.logline 当种子，优先用更展开的 seed
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
        genres,
        pov,
        lengthClass,
        targetWords: target,
        author,
        themes: template?.toneKeywords ?? [],
      });
      await setProject(project);
      navigate(goGenesis ? ROUTES.genesis(project.id) : ROUTES.overview(project.id));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh bg-neutral-50 dark:bg-neutral-950">
      <div className="mx-auto max-w-2xl px-6 py-12">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="mb-6 inline-flex items-center gap-1.5 text-sm opacity-60 transition hover:opacity-100"
        >
          <ArrowLeft className="size-4" />
          返回
        </button>

        <h1 className="text-2xl font-semibold tracking-tight">创建新作品</h1>
        <p className="mt-2 text-sm opacity-60">选个模板当起点，或只填最少的信息交给「一句话成书」。</p>

        <Card className="mt-6 space-y-5 p-6">
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
        </Card>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button variant="primary" isDisabled={!title.trim() || busy} onPress={() => submit(true)}>
            <Wand2 className="size-4" />
            创建并用 AI 建档
          </Button>
          <Button variant="outline" isDisabled={!title.trim() || busy} onPress={() => submit(false)}>
            先创建空白项目
            <ArrowRight className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
