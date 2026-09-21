import type { ReactNode } from "react";
import { NavLink, useParams } from "react-router-dom";
import { ChevronLeft, Settings as SettingsIcon } from "lucide-react";
import { Button, Tooltip } from "@heroui/react";
import { useAppStore } from "@/app/store";
import { NAV_GROUPS, ROUTE_PAGES } from "@/app/nav";
import { ROUTES } from "@/app/routes";

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
 * 写作页不使用它（需要全宽三栏）。
 */
export function PageScaffold({ title, description, actions, children, withNav = true, contentClassName }: Props) {
  const project = useAppStore((s) => s.project);
  const { projectId = "" } = useParams<{ projectId: string }>();
  const id = project?.id ?? projectId;
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-neutral-50 dark:bg-neutral-950">
      {withNav && (
        <nav className="hidden w-56 shrink-0 flex-col border-r border-black/5 bg-white/60 px-3 py-4 backdrop-blur lg:flex dark:border-white/5 dark:bg-neutral-900/40">
          <NavLink
            to={ROUTES.home}
            className="mb-4 flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-semibold transition hover:bg-black/5 dark:hover:bg-white/5"
          >
            <ChevronLeft className="size-4 opacity-60" />
            <span className="truncate">{project?.title ?? "书库"}</span>
          </NavLink>

          <div className="flex-1 space-y-4 overflow-y-auto">
            {NAV_GROUPS.map((g) => (
              <div key={g.key}>
                <p className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wider opacity-40">{g.label}</p>
                <ul className="space-y-0.5">
                  {ROUTE_PAGES.filter((p) => p.group === g.key).map((p) => (
                    <li key={p.key}>
                      <NavLink
                        to={p.to(id)}
                        className={({ isActive }) =>
                          "flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition " +
                          (isActive
                            ? "bg-black/[0.06] font-medium dark:bg-white/10"
                            : "opacity-70 hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/5")
                        }
                      >
                        <p.icon className="size-4 shrink-0" />
                        <span className="truncate">{p.label}</span>
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <Tooltip>
            <Tooltip.Trigger>
              <Button
                variant="ghost"
                size="sm"
                fullWidth
                className="mt-2 justify-start"
                onPress={() => setSettingsOpen(true)}
              >
                <SettingsIcon className="size-4" />
                设置
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content>设置（⌘,）</Tooltip.Content>
          </Tooltip>
        </nav>
      )}

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
