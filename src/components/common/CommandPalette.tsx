import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, CornerDownLeft, Settings } from "lucide-react";
import { ROUTES } from "@/app/routes";
import { useAppStore } from "@/app/store";
import { ROUTE_PAGES } from "@/app/nav";

/** 命令面板：⌘K 呼出，跳转页面。后续会加入"对当前章节执行 AI 动作"。 */
export function CommandPalette() {
  const open = useAppStore((s) => s.commandOpen);
  const close = () => useAppStore.getState().setCommandOpen(false);
  const project = useAppStore((s) => s.project);
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  // 每次打开都重置搜索词与高亮项
  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
    }
  }, [open]);

  const items = useMemo(() => {
    const id = project?.id ?? "";
    const pages = ROUTE_PAGES.map((p) => ({ label: p.label, to: p.to(id), icon: p.icon }));
    // 设置不在侧栏分组里，单独放进来，否则用命令面板找不到它
    const extras = [
      { label: "设置 · 创作者档案", to: ROUTES.settingsSection("profile"), icon: Settings },
      { label: "设置 · 模型与 AI", to: ROUTES.settingsSection("models"), icon: Settings },
      { label: "设置 · 任务路由", to: ROUTES.settingsSection("routing"), icon: Settings },
      { label: "设置 · 写作偏好", to: ROUTES.settingsSection("editor"), icon: Settings },
      { label: "设置 · 隐私", to: ROUTES.settingsSection("privacy"), icon: Settings },
      { label: "设置 · 数据", to: ROUTES.settingsSection("data"), icon: Settings },
    ];
    return [...pages, ...extras].filter((x) =>
      query ? x.label.toLowerCase().includes(query.toLowerCase()) : true,
    );
  }, [project?.id, query]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((a) => Math.min(items.length - 1, a + 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => Math.max(0, a - 1));
      }
      if (e.key === "Enter" && items[active]) {
        e.preventDefault();
        navigate(items[active].to);
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, items, active, navigate]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[500] flex items-start justify-center bg-black/30 pt-[12vh] backdrop-blur-sm" onClick={close}>
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/10 dark:bg-neutral-900 dark:ring-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-black/5 px-4 py-3 dark:border-white/5">
          <Search className="size-4 opacity-40" />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            placeholder="搜索页面与命令…"
            className="w-full bg-transparent text-sm outline-none placeholder:opacity-40"
          />
          <kbd className="rounded bg-black/5 px-1.5 py-0.5 text-[10px] opacity-60 dark:bg-white/10">ESC</kbd>
        </div>
        <ul className="max-h-80 overflow-y-auto p-2">
          {items.length === 0 && <li className="px-3 py-6 text-center text-sm opacity-50">没有匹配项</li>}
          {items.map((item, i) => (
            <li key={item.to + item.label}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => {
                  navigate(item.to);
                  close();
                }}
                className={
                  "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition " +
                  (i === active ? "bg-black/[0.06] dark:bg-white/10" : "")
                }
              >
                <item.icon className="size-4 opacity-60" />
                <span className="flex-1 truncate">{item.label}</span>
                {i === active && <CornerDownLeft className="size-3.5 opacity-40" />}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
