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
  tone?: "default" | "accent" | "success" | "warning" | "danger";
}) {
  const toneClass: Record<string, string> = {
    default: "text-neutral-500",
    accent: "text-neutral-700",
    success: "text-emerald-500",
    warning: "text-amber-500",
    danger: "text-rose-500",
  };
  /*
    "强调卡"用深色实心块，其余色调各配一层极淡的同色渐变。
    颜色的实际取值由主题变量决定（见 globals.css 的 .tone-gradient-*），
    所以暖阳主题下是暖色渐变、柔彩主题下是冷色渐变 —— 每个主题有自己的个性。
  */
  const gradient =
    tone === "accent" ? "tone-solid" : tone === "default" ? "" : "tone-gradient tone-gradient-" + tone;

  return (
    <Card className={"p-4 " + gradient}>
      <div className="flex items-start justify-between gap-2">
        <p className={"text-xs " + (tone === "accent" ? "opacity-70" : "opacity-55")}>{label}</p>
        {icon && <span className={tone === "accent" ? "opacity-80" : toneClass[tone]}>{icon}</span>}
      </div>
      <p className="tabular mt-2 text-xl font-semibold tracking-tight">{value}</p>
      {hint && <p className={"mt-1 text-[11px] " + (tone === "accent" ? "opacity-70" : "opacity-45")}>{hint}</p>}
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

/** 进度条（纯 CSS，无依赖） */
export function Progress({ value, max, tone = "violet" }: { value: number; max: number; tone?: string }) {
  const percent = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/[0.07] dark:bg-white/10">
      <div className={`h-full rounded-full bg-${tone}-500 transition-all`} style={{ width: `${percent}%` }} />
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
