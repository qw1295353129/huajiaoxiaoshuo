import { useEffect } from "react";
import { AlertCircle, CheckCircle2, Info, TriangleAlert, X } from "lucide-react";
import { useAppStore } from "@/app/store";

const STYLE: Record<string, { ring: string; icon: typeof Info; tint: string }> = {
  info: { ring: "ring-sky-500/30", icon: Info, tint: "text-sky-500" },
  success: { ring: "ring-emerald-500/30", icon: CheckCircle2, tint: "text-emerald-500" },
  warning: { ring: "ring-amber-500/30", icon: TriangleAlert, tint: "text-amber-500" },
  danger: { ring: "ring-rose-500/30", icon: AlertCircle, tint: "text-rose-500" },
};

/** 全局轻提示：固定在右下角，4 秒自动消失，可手动关闭 */
export function Notice() {
  const notice = useAppStore((s) => s.notice);
  const clear = useAppStore((s) => s.clearNotice);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => clear(), notice.kind === "danger" ? 9000 : 4500);
    return () => clearTimeout(t);
  }, [notice, clear]);

  if (!notice) return null;
  const s = STYLE[notice.kind] ?? STYLE.info;
  const Icon = s.icon;

  return (
    <div
      role="status"
      aria-live="polite"
      className={
        "fixed bottom-5 right-5 z-[999] flex max-w-sm items-start gap-3 rounded-xl bg-white/95 px-4 py-3 shadow-lg ring-1 backdrop-blur dark:bg-neutral-900/95 " +
        s.ring
      }
    >
      <Icon className={"mt-0.5 size-4 shrink-0 " + s.tint} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-snug">{notice.text}</p>
        {notice.detail && <p className="mt-1 text-xs leading-relaxed opacity-70">{notice.detail}</p>}
      </div>
      <button
        type="button"
        onClick={clear}
        aria-label="关闭提示"
        className="rounded p-0.5 opacity-50 transition hover:opacity-100"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
