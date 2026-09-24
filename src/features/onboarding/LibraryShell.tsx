import { Outlet } from "react-router-dom";
import { ProjectNav } from "@/components/layout/ProjectNav";

/**
 * 书库壳：左侧常驻 ProjectNav + 右侧内容区。
 *
 * 「我的作品」列表放在右侧内容区，而不是整页跳走丢掉侧栏 ——
 * 在项目里点侧栏「我的作品」时导航仍在，列表出现在右边。
 */
export function LibraryShell() {
  return (
    <div className="flex h-dvh w-full overflow-hidden bg-neutral-50 dark:bg-neutral-950">
      <ProjectNav className="hidden lg:flex" />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}
