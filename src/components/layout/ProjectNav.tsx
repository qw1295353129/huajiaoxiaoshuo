import { NavLink, useParams } from "react-router-dom";
import { ChevronLeft, Settings as SettingsIcon } from "lucide-react";
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
 * 总览和写作页没有，进去之后就没法切换到别的页面了，只能靠浏览器的后退。
 *
 * 总览页现在直接用 PageScaffold（它本来就该有统一的标题栏）；
 * 而写作页需要全宽三栏，套不进脚手架，所以单独用这个组件放在三栏的最左边。
 *
 * 抽出来之后，两处共用同一份导航，不会出现"某个页面漏了某一项"。
 */
export function ProjectNav({ className }: { className?: string }) {
  const project = useAppStore((s) => s.project);
  const { projectId = "" } = useParams<{ projectId: string }>();
  const id = project?.id ?? projectId;
  const openSettings = useOpenSettings();

  return (
    <nav
      className={
        "flex w-56 shrink-0 flex-col border-r border-black/5 bg-white/60 px-3 py-4 backdrop-blur dark:border-white/5 dark:bg-neutral-900/40 " +
        (className ?? "")
      }
    >
      <NavLink
        to={ROUTES.home}
        className="mb-4 flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-semibold transition hover:bg-black/5 dark:hover:bg-white/5"
      >
        <ChevronLeft className="size-4 opacity-60" />
        <span className="truncate">{project?.title ?? "书库"}</span>
      </NavLink>

      <div className="flex-1 space-y-5 overflow-y-auto">
        {NAV_GROUPS.map((g) => (
          <div key={g.key}>
            <p className="px-2.5 pb-1.5 text-[11px] font-medium uppercase tracking-wider opacity-40">{g.label}</p>
            <ul className="space-y-1">
              {ROUTE_PAGES.filter((p) => p.group === g.key).map((p) => (
                <li key={p.key}>
                  {/*
                    圆角胶囊式导航项（参考图那种观感）：
                    - 独立的圆角块 + 更大的纵向内边距，项与项之间有呼吸感；
                    - **图标在左**，固定宽度，所以所有标签左端对齐成一条线；
                    - 激活态是"浮起的一块"（白底 + 细边 + 阴影），而不是只换个底色 ——
                      参考图里选中的那一个是明显凸出来的。
                  */}
                  <NavLink
                    to={p.to(id)}
                    className={({ isActive }) =>
                      "group flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm transition " +
                      (isActive
                        ? "bg-white font-medium shadow-sm ring-1 ring-black/[0.06] dark:bg-white/10 dark:ring-white/10"
                        : "opacity-70 hover:bg-black/[0.04] hover:opacity-100 dark:hover:bg-white/[0.06]")
                    }
                  >
                    {/* 固定 20px 宽：图标下面的标签才会整齐对齐 */}
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
