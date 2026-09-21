import type { ReactNode } from "react";
import { ProjectNav } from "@/components/layout/ProjectNav";

interface Props {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  /** 是否显示左侧项目导航 */
  withNav?: boolean;
  contentClassName?: string;
}

/**
 * 内容页统一脚手架：左侧项目导航 + 标题区 + 内容区。
 *
 * 导航本体在 ProjectNav 里（写作页也要用，它套不进这个脚手架）。
 * 内容区自己带 overflow-y-auto —— 外层路由是 h-dvh + overflow-hidden，
 * 页面不自带滚动就会被裁掉。
 */
export function PageScaffold({ title, description, actions, children, withNav = true, contentClassName }: Props) {
  return (
    <div className="flex h-dvh w-full overflow-hidden bg-neutral-50 dark:bg-neutral-950">
      {withNav && <ProjectNav className="hidden lg:flex" />}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-black/5 px-5 py-3 dark:border-white/5">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-tight">{title}</h1>
            {description && <p className="mt-0.5 truncate text-xs opacity-60">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
        <div className={"min-h-0 flex-1 overflow-y-auto " + (contentClassName ?? "p-5")}>{children}</div>
      </div>
    </div>
  );
}
