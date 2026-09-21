import { Outlet, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { useAppStore } from "@/app/store";
import { ROUTES } from "@/app/routes";

/**
 * 应用外壳。
 *
 * 只保留"进入项目前的兜底跳转"这一件事：
 * - 全局快捷键（⌘K / ⌘, / ⌘⇧F）在 <GlobalHotkeys />
 * - 命令面板在 <App /> 根部渲染
 * 这两样以前放在这里，导致书库首页、新建页、设置页完全用不了它们。
 */
export function AppLayout() {
  const project = useAppStore((s) => s.project);
  const navigate = useNavigate();

  useEffect(() => {
    if (!project) navigate(ROUTES.welcome, { replace: true });
  }, [project, navigate]);

  return (
    <div className="h-dvh w-full overflow-hidden">
      <Outlet />
    </div>
  );
}
