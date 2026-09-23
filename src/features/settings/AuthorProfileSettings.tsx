import { useEffect, useState } from "react";
import { Button, Chip, Input, Label, TextArea, TextField } from "@heroui/react";
import { Plus, RotateCcw, Sparkles, Trash2, UserRound } from "lucide-react";
import type { PovStyle } from "@/core";
import { useAppStore } from "@/app/store";
import { GENRES } from "@/db/defaults";
import { DEFAULT_SETTINGS } from "@/db/repo/settings";
import { SectionTitle } from "@/components/common/ui";

const POV_OPTIONS: { value: PovStyle; label: string }[] = [
  { value: "first", label: "第一人称" },
  { value: "third-limited", label: "第三人称限知" },
  { value: "third-omniscient", label: "第三人称全知" },
  { value: "second", label: "第二人称" },
  { value: "mixed", label: "多视角切换" },
];

const PRINCIPLE_PRESETS = [
  "少用形容词，多用具体名词和动词。",
  "对话要有潜台词，不要一问一答交换信息。",
  "每段至少推进一件事，不做纯氛围铺陈。",
  "不写总结句，把判断留给读者。",
  "情绪靠动作和生理反应呈现，不直接命名情绪。",
  "比喻宁缺毋滥，一段最多一个。",
];

/**
 * 创作者档案：不是某本书的设置，而是"你这个人怎么写"的长期设定。
 * 这些内容会进入所有 AI 调用的 system prompt，是提升产出可用率最省力的一步。
 */
export function AuthorProfileSettings() {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const notify = useAppStore((s) => s.notify);

  /**
   * 全局禁用表达：编辑期间保留原始字符串。
   * 之前每键 split+join 会吞掉用户刚敲的分隔符（打「、」立刻被规范化），
   * 所以输入过程只改本地草稿，失焦时再解析回数组。
   */
  const [forbiddenDraft, setForbiddenDraft] = useState(() => settings.globalForbidden.join("、"));
  useEffect(() => {
    setForbiddenDraft(settings.globalForbidden.join("、"));
  }, [settings.globalForbidden]);

  const commitForbidden = () => {
    const parsed = forbiddenDraft
      .split(/[、,，\n]/)
      .map((x) => x.trim())
      .filter(Boolean);
    if (parsed.join("、") !== settings.globalForbidden.join("、")) {
      updateSettings({ globalForbidden: parsed });
    } else {
      // 规范化回显（用户输入的空格/逗号统一成顿号）
      setForbiddenDraft(settings.globalForbidden.join("、"));
    }
  };

  const addPrinciple = (text: string) => {
    const v = text.trim();
    if (!v || settings.writingPrinciples.includes(v)) return;
    updateSettings({ writingPrinciples: [...settings.writingPrinciples, v] });
  };

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-black/8 p-4 dark:border-white/10">
        <SectionTitle hint="会拼进每一次 AI 生成，比在每本书里重复设置更省事">创作者档案</SectionTitle>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <TextField value={settings.penName ?? ""} onChange={(v) => updateSettings({ penName: v || undefined })}>
            <Label>笔名</Label>
            <Input placeholder="用于署名与 AI 的自称" />
          </TextField>
          <div>
            <Label className="mb-1.5 block text-xs">惯用叙事视角</Label>
            <select
              value={settings.defaultPov ?? ""}
              onChange={(e) => updateSettings({ defaultPov: (e.target.value || undefined) as PovStyle | undefined })}
              className="w-full rounded-lg border border-black/10 bg-transparent px-2 py-1.5 text-sm dark:border-white/15"
            >
              <option value="">— 不指定 —</option>
              {POV_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-black/8 p-4 dark:border-white/10">
        <SectionTitle hint="选择你常写的题材，AI 会带上对应的题材写作要点">惯用体裁</SectionTitle>
        <div className="flex flex-wrap gap-1.5">
          {GENRES.map((g) => {
            const on = settings.defaultGenres.includes(g);
            return (
              <button
                key={g}
                type="button"
                onClick={() =>
                  updateSettings({
                    defaultGenres: on ? settings.defaultGenres.filter((x) => x !== g) : [...settings.defaultGenres, g].slice(0, 4),
                  })
                }
                className="transition active:scale-95"
              >
                <Chip size="sm" color={on ? "accent" : "default"}>
                  {g}
                </Chip>
              </button>
            );
          })}
        </div>
      </section>

      <section className="rounded-xl border border-black/8 p-4 dark:border-white/10">
        <SectionTitle hint="逐条写清你的写作原则，AI 会当成硬约束遵守">写作原则</SectionTitle>
        <div className="mt-2 space-y-1.5">
          {settings.writingPrinciples.map((p, i) => (
            <div key={i} className="flex items-start gap-2 rounded-lg bg-black/[0.03] px-2.5 py-1.5 text-xs dark:bg-white/[0.05]">
              <span className="mt-0.5 opacity-40">{i + 1}</span>
              <span className="min-w-0 flex-1 leading-relaxed">{p}</span>
              <button
                type="button"
                className="opacity-40 transition hover:text-rose-500 hover:opacity-100"
                onClick={() => updateSettings({ writingPrinciples: settings.writingPrinciples.filter((_, j) => j !== i) })}
              >
                <Trash2 className="size-3" />
              </button>
            </div>
          ))}
          {settings.writingPrinciples.length === 0 && (
            <p className="py-3 text-center text-xs opacity-50">还没有写作原则。从下面的常用条目里挑，或自己写一条。</p>
          )}
        </div>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const input = e.currentTarget.elements.namedItem("principle") as HTMLInputElement | null;
            if (input) {
              addPrinciple(input.value);
              input.value = "";
            }
          }}
        >
          <input
            name="principle"
            placeholder="例如：不写总结句，把判断留给读者"
            className="min-w-0 flex-1 rounded-lg border border-black/10 bg-transparent px-2.5 py-1.5 text-sm outline-none dark:border-white/15"
          />
          <Button size="sm" variant="outline" type="submit">
            <Plus className="size-3.5" />
            添加
          </Button>
        </form>
        <div className="mt-3">
          <p className="mb-1.5 flex items-center gap-1 text-[11px] opacity-50">
            <Sparkles className="size-3" />
            常用条目，点一下加入
          </p>
          <div className="flex flex-wrap gap-1.5">
            {PRINCIPLE_PRESETS.filter((p) => !settings.writingPrinciples.includes(p)).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => addPrinciple(p)}
                className="rounded-md bg-black/[0.04] px-2 py-1 text-[11px] opacity-70 transition hover:opacity-100 dark:bg-white/[0.06]"
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-black/8 p-4 dark:border-white/10">
        <SectionTitle hint="AI 生成时一律避开这些词句，优先级高于单本书的设置">全局禁用表达</SectionTitle>
        {/* onBlur 冒泡自内部 input：失焦时才解析，编辑中不吞分隔符 */}
        <div onBlur={commitForbidden}>
          <TextField value={forbiddenDraft} onChange={setForbiddenDraft}>
            <Label>用顿号或逗号分隔</Label>
            <Input placeholder="总而言之、值得注意的是、空气仿佛凝固" />
          </TextField>
        </div>
      </section>

      <section className="rounded-xl border border-black/8 p-4 dark:border-white/10">
        <SectionTitle hint="任何任务都要遵守的长期要求">长期补充指令</SectionTitle>
        <TextArea
          rows={3}
          value={settings.globalInstructions ?? ""}
          onChange={(e) => updateSettings({ globalInstructions: e.target.value || undefined })}
          placeholder="例如：我写的是冷硬派悬疑，不要出现轻松幽默的桥段；称呼统一用姓氏加职务。"
        />
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          onPress={() => {
            updateSettings({
              penName: DEFAULT_SETTINGS.penName,
              defaultGenres: DEFAULT_SETTINGS.defaultGenres,
              defaultPov: DEFAULT_SETTINGS.defaultPov,
              writingPrinciples: DEFAULT_SETTINGS.writingPrinciples,
              globalForbidden: DEFAULT_SETTINGS.globalForbidden,
              globalInstructions: DEFAULT_SETTINGS.globalInstructions,
            });
            notify("success", "创作者档案已清空");
          }}
        >
          <RotateCcw className="size-3.5" />
          清空档案
        </Button>
        <Chip size="sm" color="accent">
          <UserRound className="mr-1 inline size-3" />
          共 {settings.writingPrinciples.length} 条原则 · {settings.globalForbidden.length} 个禁用词
        </Chip>
      </div>
    </div>
  );
}
