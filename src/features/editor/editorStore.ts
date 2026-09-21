import { create } from "zustand";
import type { ID, Snapshot, WritingSession } from "@/core";
import type { GenerationOutput } from "@/ai/writing";

export interface AiResultView {
  id: string;
  taskKind: string;
  label: string;
  candidates: { content: string; words: number }[];
  activeIndex: number;
  status: "running" | "done" | "error";
  error?: string;
  model?: string;
  usage?: { prompt: number; completion: number; total: number };
  contextTokens?: number;
  contextSources?: { label: string; tokens: number; trimmed?: boolean }[];
  streaming?: string;
  createdAt: number;
}

interface EditorState {
  chapterId?: ID;
  projectId?: ID;
  /** 编辑器内的当前选中文本 */
  selection: string;
  selectionRange?: { from: number; to: number };
  /** 选区的纯文本偏移（审稿锚点用它） */
  selectionOffsets?: { from: number; to: number; text: string };
  dirty: boolean;
  saving: boolean;
  lastSavedAt?: number;
  wordCount: number;
  sessionWords: number;
  sessionStart?: number;
  session?: WritingSession;
  flowMode: boolean;
  typewriter: boolean;
  rightPanel: "ai" | "review" | "outline" | "snapshots" | "none";
  results: AiResultView[];
  activeResultId?: string;
  running: boolean;
  abort?: AbortController;
  snapshots: Snapshot[];

  setChapter: (chapterId?: ID, projectId?: ID) => void;
  setSelection: (
    text: string,
    range?: { from: number; to: number },
    offsets?: { from: number; to: number; text: string },
  ) => void;
  setDirty: (dirty: boolean) => void;
  setSaving: (saving: boolean) => void;
  markSaved: (words: number) => void;
  setWordCount: (n: number) => void;
  setSession: (session?: WritingSession) => void;
  addSessionWords: (n: number) => void;
  setFlow: (on: boolean) => void;
  setTypewriter: (on: boolean) => void;
  setRightPanel: (p: EditorState["rightPanel"]) => void;
  pushResult: (r: AiResultView) => void;
  updateResult: (id: string, patch: Partial<AiResultView>) => void
  removeResult: (id: string) => void;
  setActiveResult: (id?: string) => void;
  setRunning: (running: boolean, abort?: AbortController) => void;
  setSnapshots: (s: Snapshot[]) => void;
  resetSession: () => void;
}

/** 写作台局部状态：不进持久化，切换章节时保留 AI 结果方便对照。 */
export const useEditorStore = create<EditorState>((set, get) => ({
  selection: "",
  dirty: false,
  saving: false,
  wordCount: 0,
  sessionWords: 0,
  flowMode: false,
  typewriter: false,
  rightPanel: "ai",
  results: [],
  running: false,
  snapshots: [],

  setChapter(chapterId, projectId) {
    const prev = get().chapterId;
    set({
      chapterId,
      projectId,
      dirty: false,
      selection: "",
      selectionRange: undefined,
      wordCount: 0,
      sessionWords: 0,
      activeResultId: undefined,
      sessionStart: Date.now(),
      results: prev === chapterId ? get().results : [],
    });
  },
  setSelection(text, range, offsets) {
    set({ selection: text, selectionRange: range, selectionOffsets: offsets });
  },
  setDirty(dirty) {
    set({ dirty });
  },
  setSaving(saving) {
    set({ saving });
  },
  markSaved(words) {
    set({ dirty: false, saving: false, lastSavedAt: Date.now(), wordCount: words });
  },
  setWordCount(n) {
    const prev = get().wordCount;
    const delta = prev ? n - prev : 0;
    set({ wordCount: n, sessionWords: get().sessionWords + Math.max(0, delta) });
  },
  setSession(session) {
    set({ session, sessionStart: session ? Date.parse(session.startedAt) : undefined });
  },
  addSessionWords(n) {
    set({ sessionWords: get().sessionWords + n });
  },
  setFlow(on) {
    set({ flowMode: on, rightPanel: on ? "none" : get().rightPanel === "none" ? "ai" : get().rightPanel });
  },
  setTypewriter(on) {
    set({ typewriter: on });
  },
  setRightPanel(p) {
    set({ rightPanel: p });
  },
  pushResult(r) {
    set({ results: [r, ...get().results].slice(0, 20), activeResultId: r.id });
  },
  updateResult(id, patch) {
    set({ results: get().results.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  },
  removeResult(id) {
    set({ results: get().results.filter((r) => r.id !== id) });
  },
  setActiveResult(id) {
    set({ activeResultId: id });
  },
  setRunning(running, abort) {
    set({ running, abort: running ? abort : undefined });
  },
  setSnapshots(snapshots) {
    set({ snapshots });
  },
  resetSession() {
    set({ sessionWords: 0, sessionStart: Date.now() });
  },
}));

export function resultFromOutput(out: GenerationOutput, label: string, taskKind: string): AiResultView {
  return {
    id: Math.random().toString(36).slice(2),
    taskKind,
    label,
    candidates: out.candidates.map((c) => ({ content: c.content, words: c.words })),
    activeIndex: 0,
    status: out.ok ? "done" : "error",
    error: out.error,
    model: out.model,
    usage: out.usage,
    contextTokens: out.contextTokens,
    contextSources: out.contextSources.map((s) => ({ label: s.label, tokens: s.tokens, trimmed: s.trimmed })),
    createdAt: Date.now(),
  };
}
