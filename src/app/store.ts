import { create } from "zustand";
import type { AppSettings, AppState, ID, Project } from "@/core";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "@/db/repo/settings";
import { db, ensureAppState } from "@/db/database";
import { setLastOpened } from "@/db/repo/projects";

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
  settingsOpen: boolean;
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
  setSettingsOpen: (open: boolean) => void;
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
  settingsOpen: false,

  async bootstrap() {
    try {
      const appState = await ensureAppState();
      const settings = loadSettings();
      applyTheme(settings.theme);
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
  setSettingsOpen(open) {
    set({ settingsOpen: open });
  },
  notify(kind, text, detail) {
    set({ notice: { id: Math.random().toString(36).slice(2), kind, text, detail } });
  },
  clearNotice() {
    set({ notice: undefined });
  },
}));

export function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  const dark = theme === "dark" || (theme === "system" && prefersDark);
  root.classList.toggle("dark", dark);
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
