import { NavLink, useParams } from "react-router-dom";
import { Library, Plus, Settings as SettingsIcon } from "lucide-react";
import { Button, Tooltip } from "@heroui/react";
import { useAppStore } from "@/app/store";
import { NAV_GROUPS, ROUTE_PAGES } from "@/app/nav";
import { ROUTES } from "@/app/routes";
import { useOpenSettings } from "@/app/useOpenSettings";

/**
 * 项目内的左侧导航。
 *
 * ## 为什么抽出来
 *
 * 原先它写死在 PageScaffold 里，于是**只有用了脚手架的页面才有导航** ——
 * 总览和写作页没有，进去之后就没法切到别的页面了，只能靠浏览器后退。
 *
 * 抽出来之后，两处共用同一份导航，不会出现"某个页面漏了某一项"。
 * 书库页（LibraryShell）也复用它：列表在右侧内容区，侧栏不消失。
 */
export function ProjectNav({ className }: { className?: string }) {
  const project = useAppStore((s) => s.project);
  const setNewProjectOpen = useAppStore((s) => s.setNewProjectOpen);
  const { projectId = "" } = useParams<{ projectId: string }>();
  const id = project?.id ?? projectId;
  const openSettings = useOpenSettings();
  const onLibrary = !projectId;

  return (
    <nav
      className={
        "flex w-56 shrink-0 flex-col border-r border-black/5 bg-white/60 px-3 py-4 backdrop-blur dark:border-white/5 dark:bg-neutral-900/40 " +
        (className ?? "")
      }
    >
      <NavLink
        to={ROUTES.home}
        className="mb-4 flex items-center gap-2 rounded-lg px-2 py-1.5 transition hover:bg-black/5 dark:hover:bg-white/5"
        aria-label="花椒写作 · 回到我的作品"
      >
        <img src="/icon.svg" alt="" className="size-6 shrink-0 rounded-md" width={24} height={24} />
        <span className="truncate text-sm font-semibold tracking-tight">花椒写作</span>
      </NavLink>

      <div className="flex-1 space-y-5 overflow-y-auto">
        {/* 作品级入口：放在「创作」分组之上 */}
        <ul className="space-y-1">
          <li>
            <NavLink
              to={ROUTES.home}
              end
              className={({ isActive }) =>
                "group flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm transition " +
                (isActive || onLibrary
                  ? "bg-white font-medium shadow-sm ring-1 ring-black/[0.06] dark:bg-white/10 dark:ring-white/10"
                  : "opacity-70 hover:bg-black/[0.04] hover:opacity-100 dark:hover:bg-white/[0.06]")
              }
            >
              <span className="flex w-5 shrink-0 justify-center">
                <Library className="size-4" />
              </span>
              <span className="truncate">我的作品</span>
            </NavLink>
          </li>
          <li>
            <button
              type="button"
              onClick={() => setNewProjectOpen(true)}
              className="group flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm opacity-70 transition hover:bg-black/[0.04] hover:opacity-100 dark:hover:bg-white/[0.06]"
            >
              <span className="flex w-5 shrink-0 justify-center">
                <Plus className="size-4" />
              </span>
              <span className="truncate">新建作品</span>
            </button>
          </li>
        </ul>

        {/* 有项目上下文时才渲染项目分组（书库首页若无 id 会链到 /p//…） */}
        {id &&
          NAV_GROUPS.map((g) => (
            <div key={g.key}>
              <p className="px-2.5 pb-1.5 text-[11px] font-medium uppercase tracking-wider opacity-40">{g.label}</p>
              <ul className="space-y-1">
                {ROUTE_PAGES.filter((p) => p.group === g.key).map((p) => (
                  <li key={p.key}>
                    <NavLink
                      to={p.to(id)}
                      className={({ isActive }) =>
                        "group flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm transition " +
                        (isActive
                          ? "bg-white font-medium shadow-sm ring-1 ring-black/[0.06] dark:bg-white/10 dark:ring-white/10"
                          : "opacity-70 hover:bg-black/[0.04] hover:opacity-100 dark:hover:bg-white/[0.06]")
                      }
                    >
                      <span className="flex w-5 shrink-0 justify-center">
                        <p.icon className="size-4" />
                      </span>
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
          <Button variant="ghost" size="sm" fullWidth className="mt-2 justify-start" onPress={() => openSettings()}>
            <SettingsIcon className="size-4" />
            设置
          </Button>
        </Tooltip.Trigger>
        <Tooltip.Content>设置（⌘,）</Tooltip.Content>
      </Tooltip>
    </nav>
  );
}
