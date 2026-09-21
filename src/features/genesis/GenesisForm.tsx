import { useState } from "react";
import { Button, Card, Chip, Input, Label, TextArea, TextField } from "@heroui/react";
import { AlertTriangle, Check, Plus, Settings2, Sparkles, X } from "lucide-react";
import type { GenesisConstraints, LengthClass, PovStyle } from "@/core";
import { lengthProfile } from "@/core";
import type { GenesisOptions } from "@/ai/genesis";
import { GENRES } from "@/db/defaults";

export type UntilStage = NonNullable<GenesisOptions["until"]>;

// 篇幅的说明文字统一从 LENGTH_PROFILES 取，避免两处各写一份而慢慢对不上
const LENGTH_OPTIONS: { value: LengthClass; label: string; hint: string }[] = [
  { value: "short", label: "短篇", hint: lengthProfile("short").hint },
  { value: "novella", label: "中篇", hint: lengthProfile("novella").hint },
  { value: "novel", label: "长篇", hint: lengthProfile("novel").hint },
  { value: "epic", label: "超长篇", hint: lengthProfile("epic").hint },
  { value: "webnovel", label: "网文连载", hint: lengthProfile("webnovel").hint },
];

const POV_OPTIONS: { value: PovStyle; label: string }[] = [
  { value: "third-limited", label: "第三人称限知" },
  { value: "first", label: "第一人称" },
  { value: "third-omniscient", label: "第三人称全知" },
  { value: "second", label: "第二人称" },
  { value: "mixed", label: "多视角切换" },
];

const UNTIL_OPTIONS: { value: UntilStage; label: string }[] = [
  { value: "premise", label: "只出核心设定" },
  { value: "world", label: "到人物 + 世界观" },
  { value: "structure", label: "到分卷结构" },
  { value: "outline", label: "全部五阶段（推荐）" },
];

interface Props {
  seed: string;
  onSeedChange: (value: string) => void;
  constraints: GenesisConstraints;
  onConstraintsChange: (patch: Partial<GenesisConstraints>) => void;
  chaptersPerVolume: number;
  onChaptersPerVolumeChange: (value: number) => void;
  until: UntilStage;
  onUntilChange: (value: UntilStage) => void;
  modelReady: boolean;
  onOpenSettings: () => void;
  busy: boolean;
  onStart: () => void;
  onCancel: () => void;
}

/** 灵感输入 + 约束表单 */
export function GenesisForm({
  seed,
  onSeedChange,
  constraints,
  onConstraintsChange,
  chaptersPerVolume,
  onChaptersPerVolumeChange,
  until,
  onUntilChange,
  modelReady,
  onOpenSettings,
  busy,
  onStart,
  onCancel,
}: Props) {
  const [toneDraft, setToneDraft] = useState("");
  const [references, setReferences] = useState("");
  const [avoid, setAvoid] = useState("");

  const toggleGenre = (genre: string) => {
    const next = constraints.genres.includes(genre)
      ? constraints.genres.filter((g) => g !== genre)
      : constraints.genres.length >= 3
        ? constraints.genres
        : [...constraints.genres, genre];
    onConstraintsChange({ genres: next });
  };

  const addTone = () => {
    const value = toneDraft.trim();
    if (!value) return;
    if (!constraints.toneKeywords.includes(value)) {
      onConstraintsChange({ toneKeywords: [...constraints.toneKeywords, value] });
    }
    setToneDraft("");
  };

  const toLines = (text: string) =>
    text
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

  return (
    <Card className="space-y-5 p-5">
      <div>
        <div className="mb-2 flex items-center gap-2">
          <Sparkles className="size-4 text-neutral-700" />
          <p className="text-sm font-semibold tracking-tight">一句话灵感</p>
        </div>
        <TextField value={seed} onChange={onSeedChange} fullWidth>
          <TextArea
            rows={3}
            placeholder="例如：一个能听见死者遗言的验尸官，发现自己的名字出现在下一具尸体上。"
          />
          <Label className="sr-only">灵感</Label>
        </TextField>
        <p className="mt-1.5 text-[11px] opacity-50">
          越具体越好：谁、想要什么、被什么挡住。只写一个词也能跑，但结果会更泛。
        </p>
      </div>

      <div>
        <Label className="mb-2 block">体裁（最多 3 个）</Label>
        <div className="flex flex-wrap gap-1.5">
          {GENRES.map((genre) => {
            const picked = constraints.genres.includes(genre);
            return (
              <button key={genre} type="button" onClick={() => toggleGenre(genre)} className="transition active:scale-95">
                <Chip color={picked ? "accent" : "default"} size="sm">
                  {picked && <Check className="mr-0.5 inline size-3" />}
                  {genre}
                </Chip>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label className="mb-2 block">目标篇幅</Label>
          <div className="flex flex-wrap gap-1.5">
            {LENGTH_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => onConstraintsChange({ lengthClass: option.value })}
                className={
                  "rounded-lg border px-2.5 py-1.5 text-left text-xs transition " +
                  (constraints.lengthClass === option.value
                    ? "border-black/40 bg-black/[0.04]"
                    : "border-black/8 hover:border-black/20 dark:border-white/10 dark:hover:border-white/25")
                }
              >
                <span className="font-medium">{option.label}</span>
                <span className="ml-1 opacity-50">{option.hint}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <Label className="mb-2 block">叙事视角</Label>
          <div className="flex flex-wrap gap-1.5">
            {POV_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => onConstraintsChange({ pov: option.value })}
                className={
                  "rounded-lg border px-2.5 py-1.5 text-xs transition " +
                  (constraints.pov === option.value
                    ? "border-black/40 bg-black/[0.04] font-medium"
                    : "border-black/8 hover:border-black/20 dark:border-white/10 dark:hover:border-white/25")
                }
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div>
        <Label className="mb-2 block">基调关键词</Label>
        <div className="flex flex-wrap items-center gap-1.5">
          {constraints.toneKeywords.map((word) => (
            <span key={word} className="inline-flex items-center gap-1">
              <Chip size="sm" color="accent">
                {word}
                <button
                  type="button"
                  aria-label={"移除 " + word}
                  onClick={() =>
                    onConstraintsChange({ toneKeywords: constraints.toneKeywords.filter((w) => w !== word) })
                  }
                  className="ml-1 opacity-60 transition hover:opacity-100"
                >
                  <X className="size-3" />
                </button>
              </Chip>
            </span>
          ))}
          <span className="inline-flex items-center gap-1">
            <input
              value={toneDraft}
              onChange={(e) => setToneDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTone();
                }
              }}
              placeholder="输入后回车，如：冷峻、宿命感"
              className="w-44 rounded-lg border border-black/8 bg-transparent px-2 py-1 text-xs outline-none placeholder:opacity-40 focus:border-black/30 dark:border-white/10"
            />
            <Button size="sm" variant="ghost" isIconOnly aria-label="添加基调关键词" onPress={addTone}>
              <Plus className="size-3.5" />
            </Button>
          </span>
        </div>
      </div>

      <div className="grid gap-4">
        <TextField
          value={references}
          onChange={(value) => {
            setReferences(value);
            onConstraintsChange({ references: toLines(value) });
          }}
          fullWidth
        >
          <Label>参考气质（只借鉴风格，不抄情节）</Label>
          <TextArea rows={2} placeholder="一行一个，例如：冷冽的留白 / 硬派刑侦的冷感" />
        </TextField>

        <TextField
          value={avoid}
          onChange={(value) => {
            setAvoid(value);
            onConstraintsChange({ avoid: toLines(value) });
          }}
          fullWidth
        >
          <Label>必须避开</Label>
          <TextArea rows={2} placeholder="一行一个，例如：失忆梗 / 无意义的打斗 / 说教式结尾" />
        </TextField>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label className="mb-2 block">生成到哪一步</Label>
          <select
            value={until}
            onChange={(e) => onUntilChange(e.target.value as UntilStage)}
            className="w-full rounded-lg border border-black/8 bg-white/60 px-2.5 py-2 text-sm outline-none focus:border-black/30 dark:border-white/10 dark:bg-white/5"
          >
            {UNTIL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label className="mb-2 block">每卷章节数</Label>
          <Input
            type="number"
            value={String(chaptersPerVolume)}
            onChange={(e) => {
              const next = Number(e.target.value.replace(/[^0-9]/g, ""));
              // 兜底给当前篇幅的建议值，而不是写死 12
              onChaptersPerVolumeChange(
                Number.isFinite(next) && next > 0 ? Math.min(80, next) : lengthProfile(constraints.lengthClass).chaptersPerVolume,
              );
            }}
          />
          <p className="mt-1.5 text-[11px] leading-relaxed opacity-50">
            换篇幅会自动带出对应建议值（{LENGTH_OPTIONS.find((o) => o.value === constraints.lengthClass)?.label}：
            {lengthProfile(constraints.lengthClass).chaptersPerVolume} 章 / 卷，共 {lengthProfile(constraints.lengthClass).volumes} 卷，
            单章约 {lengthProfile(constraints.lengthClass).chapterWords} 字）。手动改过之后就不再自动覆盖。
          </p>
        </div>
      </div>

      {!modelReady && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium">还没有可用的模型</p>
            <p className="mt-0.5 text-[11px] leading-relaxed opacity-70">
              生成需要调用模型。请到「设置 → 模型与 AI」添加供应商、填写 API Key 并选定当前模型（本地 Ollama / LM Studio
              无需 Key）。
            </p>
          </div>
          <Button size="sm" variant="outline" onPress={onOpenSettings}>
            <Settings2 className="size-3.5" />
            去设置
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {busy ? (
          <Button variant="danger-soft" onPress={onCancel}>
            取消生成
          </Button>
        ) : (
          <Button variant="primary" isDisabled={!seed.trim() || !modelReady} onPress={onStart}>
            <Sparkles className="size-4" />
            开始生成故事圣经
          </Button>
        )}
        <span className="text-[11px] opacity-50">
          {busy ? "已经完成的阶段会保留，取消不会丢结果。" : "五个阶段串行执行，通常需要 1~3 分钟。"}
        </span>
      </div>
    </Card>
  );
}
