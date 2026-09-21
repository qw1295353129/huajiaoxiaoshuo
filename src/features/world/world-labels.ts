import type { WorldCategory } from "@/core";
import { WORLD_CATEGORY_LABELS } from "@/db/defaults";

/** 世界观页面的文案/样式常量（与组件分开，避免影响 Fast Refresh） */

/** 表单控件统一样式（本项目大量使用原生元素 + Tailwind） */
export const INPUT_CLASS =
  "w-full rounded-lg border border-black/10 bg-white/70 px-2.5 py-1.5 text-sm outline-none transition placeholder:opacity-40 focus:border-violet-500/60 dark:border-white/10 dark:bg-white/5";

/** 分类的中文标签；"all" 表示不过滤 */
export function categoryLabel(category: WorldCategory | "all"): string {
  if (category === "all") return "全部";
  return WORLD_CATEGORY_LABELS[category] ?? category;
}
