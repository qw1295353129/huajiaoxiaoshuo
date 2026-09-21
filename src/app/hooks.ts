import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { Chapter, Character, Entity, GlossaryTerm, ID, PlotThread, Project, Relationship, TimelineEvent, WorldEntry } from "@/core";
import { db } from "@/db/database";
import { listChapters, listArcs } from "@/db/repo/outline";
import { listCharacters, listRelationships } from "@/db/repo/cast";
import { listEntities, listGlossary, listRules, listWorldEntries } from "@/db/repo/world";
import { listIssues, listMetrics, listThreads, listTimeline } from "@/db/repo/story";
import { listProjects } from "@/db/repo/projects";

/** 观察式查询：数据库变化自动重渲染（dexie-react-hooks 的 liveQuery） */
export function useProjects(): Project[] | undefined {
  return useLiveQuery(() => listProjects(), [], undefined);
}

export function useProject(projectId?: ID): Project | undefined {
  return useLiveQuery(async () => (projectId ? db.projects.get(projectId) : undefined), [projectId], undefined);
}

export function useArcs(projectId?: ID) {
  return useLiveQuery(async () => (projectId ? listArcs(projectId) : []), [projectId], []);
}

export function useChapters(projectId?: ID): Chapter[] {
  const rows = useLiveQuery(async () => (projectId ? listChapters(projectId) : []), [projectId], undefined);
  return useMemo(() => rows ?? [], [rows]);
}

export function useChapter(chapterId?: ID) {
  return useLiveQuery(async () => (chapterId ? db.chapters.get(chapterId) : undefined), [chapterId], undefined);
}

export function useChapterContent(chapterId?: ID) {
  return useLiveQuery(async () => (chapterId ? db.chapterContents.get(chapterId) : undefined), [chapterId], undefined);
}

export function useCharacters(projectId?: ID): Character[] {
  const rows = useLiveQuery(async () => (projectId ? listCharacters(projectId) : []), [projectId], undefined);
  return useMemo(() => rows ?? [], [rows]);
}

export function useRelationships(projectId?: ID): Relationship[] {
  const rows = useLiveQuery(async () => (projectId ? listRelationships(projectId) : []), [projectId], undefined);
  return useMemo(() => rows ?? [], [rows]);
}

export function useWorldEntries(projectId?: ID): WorldEntry[] {
  const rows = useLiveQuery(async () => (projectId ? listWorldEntries(projectId) : []), [projectId], undefined);
  return useMemo(() => rows ?? [], [rows]);
}

export function useEntities(projectId?: ID): Entity[] {
  const rows = useLiveQuery(async () => (projectId ? listEntities(projectId) : []), [projectId], undefined);
  return useMemo(() => rows ?? [], [rows]);
}

export function useThreads(projectId?: ID): PlotThread[] {
  const rows = useLiveQuery(async () => (projectId ? listThreads(projectId) : []), [projectId], undefined);
  return useMemo(() => rows ?? [], [rows]);
}

export function useTimeline(projectId?: ID): TimelineEvent[] {
  const rows = useLiveQuery(async () => (projectId ? listTimeline(projectId) : []), [projectId], undefined);
  return useMemo(() => rows ?? [], [rows]);
}

export function useMetrics(projectId?: ID) {
  const rows = useLiveQuery(async () => (projectId ? listMetrics(projectId) : []), [projectId], undefined);
  return useMemo(() => rows ?? [], [rows]);
}

export function useIssues(projectId?: ID, status?: "open" | "ignored" | "fixed" | "false-positive") {
  const rows = useLiveQuery(
    async () => (projectId ? listIssues(projectId, status ? { status } : undefined) : []),
    [projectId, status],
    undefined,
  );
  return useMemo(() => rows ?? [], [rows]);
}

export function useGlossary(projectId?: ID): GlossaryTerm[] {
  const rows = useLiveQuery(async () => (projectId ? listGlossary(projectId) : []), [projectId], undefined);
  return useMemo(() => rows ?? [], [rows]);
}

export function useRules(projectId?: ID) {
  const rows = useLiveQuery(async () => (projectId ? listRules(projectId) : []), [projectId], undefined);
  return useMemo(() => rows ?? [], [rows]);
}

/** 带防抖的本地状态（用于搜索框） */
export function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

/** 上一次的值 */
export function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T | undefined>(undefined);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref.current;
}

/** 是否已挂载（避免 SSR/首帧闪烁） */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

/** 定时器：用于番茄钟、写作计时 */
export function useInterval(callback: () => void, delay: number | null) {
  const saved = useRef(callback);
  useEffect(() => {
    saved.current = callback;
  }, [callback]);
  useEffect(() => {
    if (delay === null) return;
    const id = setInterval(() => saved.current(), delay);
    return () => clearInterval(id);
  }, [delay]);
}

/** 全局键盘快捷键 */
export function useHotkey(combo: string, handler: (e: KeyboardEvent) => void, enabled = true) {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  }, [handler]);
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const parts = combo.toLowerCase().split("+");
      const key = parts[parts.length - 1];
      const needMod = parts.includes("mod") || parts.includes("ctrl") || parts.includes("meta");
      const needShift = parts.includes("shift");
      const mod = e.metaKey || e.ctrlKey;
      if (needMod !== mod) return;
      if (needShift !== e.shiftKey) return;
      if (key === "enter" ? e.key !== "Enter" : e.key.toLowerCase() !== key) return;
      ref.current(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [combo, enabled]);
}

export type AsyncResult<T> = [value: T, loading: boolean, error: Error | undefined, reload: () => void];

/** 一次性异步加载（无实时订阅）。返回元组，第 4 项是手动重新加载函数。 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[], initial: T): AsyncResult<T> {
  const [value, setValue] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | undefined>(undefined);
  const [nonce, setNonce] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fnRef
      .current()
      .then((v) => {
        if (alive) {
          setValue(v);
          setError(undefined);
        }
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e : new Error(String(e)));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return [value, loading, error, reload];
}
