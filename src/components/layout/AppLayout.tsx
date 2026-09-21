import { Outlet, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { useAppStore } from "@/app/store";
import { ROUTES } from "@/app/routes";
import { CommandPalette } from "@/components/common/CommandPalette";
import { ROUTE_PAGES } from "@/app/nav";

/**
 * 应用外壳：只负责全局浮层与投影切换。
 * 每个页面自己决定是否显示侧边栏，写作页需要全宽。
 */
export function AppLayout() {
  const project = useAppStore((s) => s.project);
  const commandOpen = useAppStore((s) => s.commandOpen);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const navigate = useNavigate();

  // 全局快捷键
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        useAppStore.getState().setCommandOpen(true);
      }
      if (mod && e.key === ",") {
        e.preventDefault();
        setSettingsOpen(true);
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        useAppStore.getState().setFlow(!useAppStore.getState().flowMode);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSettingsOpen]);

  useEffect(() => {
    if (!project) navigate(ROUTES.welcome, { replace: true });
  }, [project, navigate]);

  void ROUTE_PAGES;

  return (
    <div className="h-dvh w-full overflow-hidden">
      <Outlet />
      {commandOpen && <CommandPalette />}
    </div>
  );
}
