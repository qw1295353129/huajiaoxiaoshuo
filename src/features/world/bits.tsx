import { useMemo } from "react";
import { Chip } from "@heroui/react";
import { Star } from "lucide-react";
import type { WorldCategory } from "@/core";
import type { TitleIndex } from "./world-links";
import { parseWikiSegments, resolveWikilink } from "./world-links";
import { categoryLabel } from "./world-labels";

/** 世界观页面共用的小组件（分类徽标、重要度星、正文预览） */

export function CategoryChip({ category }: { category: WorldCategory }) {
  return (
    <Chip size="sm" color="default">
      {categoryLabel(category)}
    </Chip>
  );
}

/** 重要度五颗星；传了 onChange 就可点选 */
export function ImportanceStars({
  value,
  onChange,
  size = 14,
}: {
  value: number;
  onChange?: (next: number) => void;
  size?: number;
}) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={"重要度 " + value + " / 5"}>
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = n <= value;
        const cls = "shrink-0 transition " + (filled ? "text-amber-500" : "opacity-25");
        const icon = <Star style={{ width: size, height: size }} fill={filled ? "currentColor" : "none"} />;
        if (!onChange) return <span key={n} className={cls}>{icon}</span>;
        return (
          <button
            key={n}
            type="button"
            aria-label={"设为 " + n + " 星"}
            className={cls + " hover:opacity-70"}
            onClick={() => onChange(n)}
          >
            {icon}
          </button>
        );
      })}
    </span>
  );
}

/**
 * 正文预览：把 [[标题]] 渲染成可跳转的链接。
 * 找不到对应条目时给出「创建该条目」入口，避免出现死链。
 */
export function WikiBody({
  body,
  index,
  onOpen,
  onCreate,
  className,
}: {
  body: string;
  index: TitleIndex;
  onOpen: (id: string) => void;
  onCreate: (target: string) => void;
  className?: string;
}) {
  const segments = useMemo(() => parseWikiSegments(body), [body]);

  if (!body.trim()) {
    return (
      <p className={"text-sm leading-relaxed opacity-45 " + (className ?? "")}>
        正文还是空的，可以先用 [[条目标题]] 把相关设定串起来。
      </p>
    );
  }

  return (
    <div className={"whitespace-pre-wrap text-sm leading-relaxed " + (className ?? "")}>
      {segments.map((seg, i) => {
        if (seg.kind === "text") return <span key={i}>{seg.text}</span>;
        const target = resolveWikilink(index, seg.target);
        if (target) {
          return (
            <button
              key={i}
              type="button"
              onClick={() => onOpen(target.id)}
              title={"跳转到《" + target.title + "》"}
              className="mx-0.5 rounded bg-black/[0.06] px-1 font-medium text-neutral-800 transition hover:bg-black/[0.08] dark:text-neutral-200"
            >
              {seg.target}
            </button>
          );
        }
        return (
          <span key={i} className="mx-0.5 inline-flex items-baseline gap-1 rounded bg-amber-500/10 px-1 text-amber-600 dark:text-amber-300">
            {seg.target}
            <button
              type="button"
              onClick={() => onCreate(seg.target)}
              className="text-[11px] underline decoration-dotted underline-offset-2 opacity-80 hover:opacity-100"
            >
              创建该条目
            </button>
          </span>
        );
      })}
    </div>
  );
}
