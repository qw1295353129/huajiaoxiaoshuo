import { create } from "zustand";
import type { AppSettings, AppState, ID, Project } from "@/core";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "@/db/repo/settings";
import { db, ensureAppState } from "@/db/database";
import { setLastOpened } from "@/db/repo/projects";
import { setAuthorProfile } from "@/ai/prompts";

type Theme = AppSettings["theme"];

interface AppStore {
  ready: boolean;
  initError?: string;
  settings: AppSettings;
  appState?: AppState;
  project?: Project;
  chapterId?: ID;
  /** 界面态 */
  sidebarCollapsed: boolean;
  aiPanelOpen: boolean;
  flowMode: boolean;
  commandOpen: boolean;
  /** 全局 toast 通道，供非 React 代码推送消息 */
  notice?: { id: string; kind: "info" | "success" | "warning" | "danger"; text: string; detail?: string };

  bootstrap: () => Promise<void>;
  updateSettings: (patch: Partial<AppSettings>) => void;
  setProject: (project?: Project, chapterId?: ID) => Promise<void>;
  openChapter: (chapterId?: ID) => Promise<void>;
  toggleSidebar: () => void;
  setAiPanel: (open: boolean) => void;
  setFlow: (on: boolean) => void;
  setCommandOpen: (open: boolean) => void;
  notify: (kind: "info" | "success" | "warning" | "danger", text: string, detail?: string) => void;
  clearNotice: () => void;
}

export const useAppStore = create<AppStore>((set, get) => ({
  ready: false,
  settings: typeof window === "undefined" ? { ...DEFAULT_SETTINGS } : loadSettings(),
  sidebarCollapsed: false,
  aiPanelOpen: false,
  flowMode: false,
  commandOpen: false,

  async bootstrap() {
    try {
      const appState = await ensureAppState();
      const settings = loadSettings();
      applyTheme(settings.theme);
      syncAuthorProfile(settings);
      set({ appState, settings, ready: true });
      if (appState.lastProjectId) {
        const project = await db.projects.get(appState.lastProjectId);
        if (project) set({ project, chapterId: appState.lastChapterId });
      }
    } catch (e) {
      set({ ready: true, initError: e instanceof Error ? e.message : String(e) });
    }
  },

  updateSettings(patch) {
    const next = { ...get().settings, ...patch };
    saveSettings(next);
    applyTheme(next.theme);
    syncAuthorProfile(next);
    set({ settings: next });
  },

  async setProject(project, chapterId) {
    set({ project, chapterId });
    if (project) await setLastOpened(project.id, chapterId);
  },

  async openChapter(chapterId) {
    set({ chapterId });
    const { project } = get();
    if (project) await setLastOpened(project.id, chapterId);
  },

  toggleSidebar() {
    set({ sidebarCollapsed: !get().sidebarCollapsed });
  },
  setAiPanel(open) {
    set({ aiPanelOpen: open });
  },
  setFlow(on) {
    set({ flowMode: on });
  },
  setCommandOpen(open) {
    set({ commandOpen: open });
  },

  notify(kind, text, detail) {
    set({ notice: { id: Math.random().toString(36).slice(2), kind, text, detail } });
  },
  clearNotice() {
    set({ notice: undefined });
  },
}));

/** 把创作者档案同步给 AI 层（所有 system prompt 都会带上） */
function syncAuthorProfile(settings: AppSettings) {
  setAuthorProfile({
    penName: settings.penName,
    defaultGenres: settings.defaultGenres,
    defaultPov: settings.defaultPov,
    writingPrinciples: settings.writingPrinciples,
    globalForbidden: settings.globalForbidden,
    globalInstructions: settings.globalInstructions,
  });
}

/**
 * 所有"彩色主题"。它们靠 `data-theme` 属性生效，与 dark 正交。
 *
 * 抽成常量而不是在 applyTheme 里写条件：加主题时只需改这一处，
 * 不会出现"CSS 里加了、applyTheme 里忘了"的静默失效。
 */
export const COLOR_THEMES: readonly string[] = ["warm", "soft", "vivid"];

export function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  const dark = theme === "dark" || (theme === "system" && prefersDark);
  root.classList.toggle("dark", dark);
  /**
   * 彩色主题用 data-theme 标记，**与 dark 正交**（它们本身是浅色系）。
   *
   * 用属性而不是再加一个 class：类名会与 Tailwind 的 dark 变体混在一起难分辨，
   * 属性在 CSS 里写成 [data-theme="warm"] 一眼能看出是"主题"而不是"明暗模式"。
   *
   * 这里列的是**所有**彩色主题 —— 加主题时忘了同步这张表，
   * 表现就是"选了没反应"，所以它与 COLOR_THEMES 用同一个来源。
   */
  if (COLOR_THEMES.includes(theme)) root.setAttribute("data-theme", theme);
  else root.removeAttribute("data-theme");
  root.style.colorScheme = dark ? "dark" : "light";
}

/** 监听系统主题变化（theme = system 时） */
export function watchSystemTheme() {
  if (typeof window === "undefined") return () => undefined;
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const handler = () => {
    if (useAppStore.getState().settings.theme === "system") applyTheme("system");
  };
  mq.addEventListener("change", handler);
  return () => mq.removeEventListener("change", handler);
}

/** 便捷选择器 */
export const selectProjectId = () => useAppStore.getState().project?.id;

/** 供非组件代码（AI 流水线等）弹出的提示 */
export function notify(kind: "info" | "success" | "warning" | "danger", text: string, detail?: string) {
  useAppStore.getState().notify(kind, text, detail);
}
