import type { ReactNode } from "react";
import { Card, Chip, Spinner } from "@heroui/react";
import type { IssueSeverity } from "@/core";

/** 共享小组件：所有页面统一使用，避免各处重复造轮子。 */

export function SectionTitle({ children, hint, action }: { children: ReactNode; hint?: string; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div>
        <h2 className="text-sm font-semibold tracking-tight">{children}</h2>
        {hint && <p className="mt-0.5 text-xs opacity-55">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
  /**
   * 色调。
   * `info` 是补上的 —— 之前代码里有 4 处 `tone: "info"`，
   * 但类型里没有它，TypeScript 会把它们当默认色处理（静默退化，不报错）。
   */
  tone?: "default" | "accent" | "info" | "success" | "warning" | "danger";
}) {
  const toneClass: Record<string, string> = {
    default: "text-neutral-500",
    /*
      accent 的图标用主题色（而不是中性灰）。
      这是"强调"唯一保留的表达方式 —— 只体现在一个小图标上，
      既看得出哪张卡是主角，又不会在两种主题下都变成一块反色板。
    */
    accent: "text-[var(--accent)]",
    info: "text-sky-500",
    success: "text-emerald-500",
    warning: "text-amber-500",
    danger: "text-rose-500",
  };
  /*
    ## 为什么没有"实心强调卡"了
    accent 原先会渲染成一块**实心反色卡**：浅色主题下是纯黑、深色主题下是纯白。
    用户指出两个方向都别扭 —— 深色主题里冒出一张白卡、浅色主题里冒出一张黑卡，
    它跟周围所有卡片都是"反着"的，看起来像渲染错误而不是强调。
    参考图里确实有深色块，但那要求**整页所有卡片都按同一套配色语言排布**；
    我们这里 accent 散落在十几处（"本章字数""全书字数""角色"…），
    语义上并不都是"最该突出的那一个"，所以那种实心块只会显得随机。
    现在 accent 与其它色调一视同仁：一层同色淡渐变 + 主色图标。
    主题若仍想要实心块，覆盖 --tone-solid-bg / --tone-solid-fg 即可（.tone-solid 仍保留）。
  */
  const gradient = tone === "default" ? "" : "tone-gradient tone-gradient-" + tone;

  return (
    <Card className={"p-4 " + gradient}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs opacity-55">{label}</p>
        {icon && <span className={toneClass[tone]}>{icon}</span>}
      </div>
      <p className="tabular mt-2 text-xl font-semibold tracking-tight">{value}</p>
      {hint && <p className="mt-1 text-[11px] opacity-45">{hint}</p>}
    </Card>
  );
}

export function EmptyHint({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="grid place-items-center rounded-xl border border-dashed border-black/10 px-6 py-14 text-center dark:border-white/10">
      {icon && <div className="mb-3 opacity-25">{icon}</div>}
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="mt-1.5 max-w-sm text-xs leading-relaxed opacity-55">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Loading({ label = "加载中…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-14 text-sm opacity-60">
      <Spinner size="sm" />
      {label}
    </div>
  );
}

const SEVERITY_META: Record<IssueSeverity, { label: string; color: "danger" | "warning" | "accent" | "default" }> = {
  blocker: { label: "阻断", color: "danger" },
  error: { label: "严重", color: "danger" },
  warn: { label: "警告", color: "warning" },
  info: { label: "提示", color: "accent" },
};

export function SeverityChip({ severity }: { severity: IssueSeverity }) {
  const meta = SEVERITY_META[severity] ?? SEVERITY_META.info;
  return (
    <Chip size="sm" color={meta.color}>
      {meta.label}
    </Chip>
  );
}

export function Tag({ children, color = "default" }: { children: ReactNode; color?: "default" | "accent" | "success" | "warning" | "danger" }) {
  return (
    <Chip size="sm" color={color}>
      {children}
    </Chip>
  );
}

/**
 * 进度条（纯 CSS，无依赖）。
 * 颜色用静态映射 —— `bg-${tone}-500` 这类动态类 Tailwind 不会生成，进度条会隐形。
 * 默认 accent 走 `var(--accent)`，跟随主题（项目已中性化，不要写死 violet）。
 */
const PROGRESS_TONE: Record<string, string> = {
  accent: "var(--accent)",
  default: "var(--foreground)",
  success: "var(--color-emerald-500, #10b981)",
  warning: "var(--color-amber-500, #f59e0b)",
  danger: "var(--color-rose-500, #f43f5e)",
  info: "var(--color-sky-500, #0ea5e9)",
};

export function Progress({ value, max, tone = "accent" }: { value: number; max: number; tone?: string }) {
  const percent = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const background = PROGRESS_TONE[tone] ?? PROGRESS_TONE.accent;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/[0.07] dark:bg-white/10">
      <div className="h-full rounded-full transition-all" style={{ width: `${percent}%`, background }} />
    </div>
  );
}

/** 两栏布局：左列表右详情 */
export function SplitPane({ left, right, leftWidth = 300 }: { left: ReactNode; right: ReactNode; leftWidth?: number }) {
  return (
    <div className="flex h-full min-h-0 gap-4">
      <div className="shrink-0 overflow-y-auto" style={{ width: leftWidth }}>
        {left}
      </div>
      <div className="min-w-0 flex-1 overflow-y-auto">{right}</div>
    </div>
  );
}

/** 键值展示行 */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  if (children === null || children === undefined || children === "") return null;
  return (
    <div className="grid grid-cols-[80px_1fr] gap-3 py-1.5 text-sm">
      <span className="opacity-50">{label}</span>
      <span className="whitespace-pre-wrap leading-relaxed">{children}</span>
    </div>
  );
}
