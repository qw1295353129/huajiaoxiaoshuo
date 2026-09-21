import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "@/app/store";
import { useOpenSettings } from "@/app/useOpenSettings";

/**
 * 全局快捷键。
 *
 * 注意：这些必须挂在应用根部，不能放在 AppLayout —— AppLayout 只在
 * `/p/:projectId/*` 下渲染，放在那里会导致书库首页、新建页、设置页里
 * ⌘K / ⌘, 全部失效（这是之前的真实 bug）。
 */
export function GlobalHotkeys() {
  const navigate = useNavigate();
  const openSettings = useOpenSettings();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      if (e.key.toLowerCase() === "k") {
        e.preventDefault();
        const store = useAppStore.getState();
        store.setCommandOpen(!store.commandOpen);
        return;
      }
      if (e.key === ",") {
        e.preventDefault();
        openSettings();
        return;
      }
      if (e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        const store = useAppStore.getState();
        store.setFlow(!store.flowMode);
        return;
      }
      // ⌘/ 显示快捷键说明与 ⌘? 等价
      if (e.key === "/" || (e.shiftKey && e.key === "?")) {
        e.preventDefault();
        navigate("/settings?tab=editor");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, openSettings]);

  return null;
}
