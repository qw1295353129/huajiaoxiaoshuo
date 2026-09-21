/** 本目录内复用的样式常量（表单控件统一为原生元素 + Tailwind）。 */

export const FIELD_CLASS =
  "w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm outline-none transition placeholder:opacity-40 focus:border-violet-500/70 focus:ring-2 focus:ring-violet-500/15 dark:border-white/10 dark:bg-neutral-900";

export const LABEL_CLASS = "mb-1.5 block text-xs font-medium opacity-60";

export const SELECT_CLASS = FIELD_CLASS + " appearance-none pr-8";

export const DIVIDER_CLASS = "border-black/5 dark:border-white/5";

export const CARD_CLASS = "rounded-xl border bg-white/70 p-4 dark:bg-neutral-900/40 " + DIVIDER_CLASS;
