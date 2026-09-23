import { useMemo, useState } from "react";
import { Chip, Input, Label, TextField } from "@heroui/react";
import { Search } from "lucide-react";
import {
  filterTemplates,
  NOVEL_TEMPLATES,
  TEMPLATE_CATEGORIES,
  TEMPLATE_CATEGORY_LABEL,
  type NovelTemplate,
  type TemplateCategory,
} from "@/core";

/**
 * 小说模板库：分类 + 搜索 + 卡片。
 * 选中后通过 onChange 回传模板，由新建页决定如何预填表单。
 */
export function TemplatePicker({
  selectedId,
  onChange,
}: {
  selectedId?: string;
  onChange: (t: NovelTemplate | null) => void;
}) {
  const [category, setCategory] = useState<TemplateCategory>("all");
  const [query, setQuery] = useState("");

  const list = useMemo(() => filterTemplates(NOVEL_TEMPLATES, category, query), [category, query]);

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <Label className="mb-0">创作模板（可选）</Label>
        {selectedId && (
          <button
            type="button"
            className="text-xs opacity-55 transition hover:opacity-100"
            onClick={() => onChange(null)}
          >
            清除选择
          </button>
        )}
      </div>
      <p className="text-xs leading-relaxed opacity-55">
        选一个模板会带出书名灵感、一句话故事、体裁与篇幅；不选也能直接创建。
      </p>

      <div className="flex flex-wrap gap-1.5">
        {TEMPLATE_CATEGORIES.map((c) => (
          <button key={c} type="button" onClick={() => setCategory(c)} className="transition active:scale-95">
            <Chip size="sm" color={category === c ? "accent" : "default"}>
              {TEMPLATE_CATEGORY_LABEL[c]}
            </Chip>
          </button>
        ))}
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 opacity-40" />
        <TextField value={query} onChange={setQuery}>
          <Label className="sr-only">搜索模板</Label>
          <Input placeholder="搜索模板…" className="pl-8" />
        </TextField>
      </div>

      {list.length === 0 ? (
        <p className="rounded-xl border border-dashed border-black/10 px-4 py-6 text-center text-xs opacity-50 dark:border-white/15">
          没有匹配的模板，换个关键词或分类试试。
        </p>
      ) : (
        <div className="grid max-h-72 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
          {list.map((t) => {
            const active = selectedId === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onChange(active ? null : t)}
                className={
                  "rounded-xl border p-3 text-left transition " +
                  (active
                    ? "border-black/40 bg-black/[0.04] ring-1 ring-black/20 dark:border-white/30 dark:bg-white/[0.06] dark:ring-white/20"
                    : "border-black/8 hover:border-black/25 dark:border-white/10 dark:hover:border-white/25")
                }
              >
                <p className="text-sm font-medium">
                  <span className="mr-1">{t.emoji}</span>
                  {t.name}
                </p>
                <p className="mt-1 line-clamp-2 text-xs leading-relaxed opacity-60">{t.logline}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {t.tags.slice(0, 4).map((tag) => (
                    <span
                      key={tag}
                      className="rounded bg-black/[0.05] px-1.5 py-0.5 text-[10px] opacity-70 dark:bg-white/[0.08]"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
