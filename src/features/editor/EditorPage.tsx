import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Button, Chip, Tooltip } from "@heroui/react";
import {
  ArrowLeft, Clock, Eye, History, Keyboard, Maximize2, Minimize2, PanelLeftClose,
  PanelLeftOpen, PanelRightClose, PanelRightOpen, Save, Settings2, Type, Zap,
} from "lucide-react";
import type { Chapter, ID } from "@/core";
import { useAppStore } from "@/app/store";
import { ROUTES } from "@/app/routes";
import { useArcs, useChapter, useChapterContent, useChapters } from "@/app/hooks";
import { docToText, isEmptyDoc, textToDoc } from "@/utils/rich-text";
import { countChars, countWords } from "@/utils/text";
import { formatClock, formatRelative, formatWords } from "@/utils/format";
import {
  createChapter, createSnapshot, getChapterContent, listSnapshots, pruneAutoSnapshots,
  restoreSnapshot, saveChapterContent, updateChapter,
} from "@/db/repo/outline";
import { endSession, logPomodoro, startSession, updateSession } from "@/db/repo/writing";
import { useEditorStore } from "./editorStore";
import { EditorCanvas, type EditorCanvasHandle } from "./EditorCanvas";
import { ChapterList } from "./ChapterList";
import { AiPanel } from "./AiPanel";
import { SnapshotPanel } from "./SnapshotPanel";
import { ChapterSettings } from "./ChapterSettings";
import { PomodoroTimer } from "./PomodoroTimer";

export function EditorPage() {
  const { projectId = "", chapterId: routeChapterId } = useParams<{ projectId: string; chapterId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  /** 来自一致性报告的改写工单：?fix=改写指令&quote=证据原文&from=&to= */
  const workOrder = useMemo(
    () => ({
      fix: searchParams.get("fix") ?? undefined,
      quote: searchParams.get("quote") ?? undefined,
      from: searchParams.get("from") ? Number(searchParams.get("from")) : undefined,
      to: searchParams.get("to") ? Number(searchParams.get("to")) : undefined,
    }),
    [searchParams],
  );
  const project = useAppStore((s) => s.project);
  const openChapter = useAppStore((s) => s.openChapter);
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const notify = useAppStore((s) => s.notify);


  const chapters = useChapters(projectId);
  const arcs = useArcs(projectId);
  const chapter = useChapter(routeChapterId);
  const content = useChapterContent(routeChapterId);

  const editorStore = useEditorStore();
  const flowApplied = useRef(false);
  const [handle, setHandle] = useState<EditorCanvasHandle | null>(null);
  const [draftHtml, setDraftHtml] = useState<string>("");
  const [draftWords, setDraftWords] = useState(0);
  const [loadedFor, setLoadedFor] = useState<string>("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const saveTimer = useRef<number | null>(null);
  const sessionRef = useRef<ID | undefined>(undefined);
  const lastActivity = useRef<number>(Date.now());
  const initialWords = useRef<number>(0);

  const flow = editorStore.flowMode;
  const rightPanel = editorStore.rightPanel;

  // ---------- 选中章节后的初始化 ----------
  useEffect(() => {
    if (!routeChapterId) {
      // 没有指定章节：自动跳到第一章或创建
      if (chapters.length > 0) {
        navigate(ROUTES.write(projectId, chapters[0].id), { replace: true });
      }
      return;
    }
    void openChapter(routeChapterId);
  }, [routeChapterId, chapters, navigate, openChapter, projectId]);

  useEffect(() => {
    if (!chapter || !content || loadedFor === chapter.id) return;
    setDraftHtml(content.html ?? "<p></p>");
    setDraftWords(chapter.wordCount || countWords(content.text));
    setLoadedFor(chapter.id);
    editorStore.setChapter(chapter.id, projectId);
    initialWords.current = chapter.wordCount || 0;
    void listSnapshots(chapter.id).then((s) => editorStore.setSnapshots(s));
  }, [chapter, content, loadedFor, editorStore, projectId]);

  // 设置里开了「默认进入心流模式」时，进入写作页自动隐藏面板（只生效一次）
  useEffect(() => {
    if (flowApplied.current || !chapter) return;
    flowApplied.current = true;
    if (settings.flowByDefault) useEditorStore.getState().setFlow(true);
  }, [chapter, settings.flowByDefault]);

  // ---------- 写作会话 ----------
  useEffect(() => {
    if (!chapter || !projectId) return;
    let sessionId: ID | undefined;
    void startSession(projectId, chapter.id, editorStore.flowMode).then((s) => {
      sessionId = s.id;
      sessionRef.current = s.id;
      editorStore.setSession(s);
    });
    const startWords = initialWords.current;
    return () => {
      const endedAt = new Date().toISOString();
      const added = Math.max(0, useEditorStore.getState().wordCount - startWords);
      if (sessionId) {
        void updateSession(sessionId, {
          wordsAdded: added,
          endedAt,
          flow: useEditorStore.getState().flowMode,
        });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapter?.id, projectId]);

  // ---------- 保存 ----------
  const doSave = useCallback(
    async (reason: "auto" | "manual" | "switch") => {
      const state = useEditorStore.getState();
      const cid = state.chapterId;
      if (!cid || !state.dirty) return;
      state.setSaving(true);
      const res = await saveChapterContent(cid, draftHtml);
      state.markSaved(res.words);
      if (reason === "manual") notify("success", "已保存", formatWords(res.words));
      if (state.session) {
        void updateSession(state.session.id, {
          wordsAdded: Math.max(0, res.words - initialWords.current),
          endedAt: new Date().toISOString(),
        });
      }
    },
    [draftHtml, notify],
  );

  const onEditorChange = useCallback(
    (html: string, words: number) => {
      setDraftHtml(html);
      setDraftWords(words);
      lastActivity.current = Date.now();
      const state = useEditorStore.getState();
      state.setDirty(true);
      state.setWordCount(words);
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => void doSave("auto"), settings.autosaveMs);
    },
    [doSave, settings.autosaveMs],
  );

  // 自动快照
  useEffect(() => {
    if (!chapter || settings.snapshotIntervalMin <= 0) return;
    const id = window.setInterval(
      () => {
        const state = useEditorStore.getState();
        if (!state.chapterId || !state.dirty) return;
        void createSnapshot(state.chapterId, "自动快照", "auto").then(() =>
          pruneAutoSnapshots(state.chapterId!, 30),
        );
      },
      settings.snapshotIntervalMin * 60_000,
    );
    return () => window.clearInterval(id);
  }, [chapter, settings.snapshotIntervalMin]);

  // 离开页面前最后一次保存
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (useEditorStore.getState().dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  // ---------- 快捷键 ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void doSave("manual");
      }
      if (mod && e.key.toLowerCase() === "j") {
        e.preventDefault();
        document.querySelector<HTMLButtonElement>("[data-ai-continue]")?.click();
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        editorStore.setFlow(!useEditorStore.getState().flowMode);
      }
      if (mod && e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        const idx = chapters.findIndex((c) => c.id === routeChapterId);
        const next = e.key === "ArrowUp" ? idx - 1 : idx + 1;
        if (next >= 0 && next < chapters.length) {
          void doSave("switch").then(() => navigate(ROUTES.write(projectId, chapters[next].id)));
        }
      }
      if (e.key === "Escape" && useEditorStore.getState().flowMode) {
        useEditorStore.getState().setFlow(false);
      }
      if (e.key === "?" && e.shiftKey) {
        e.preventDefault();
        setShowShortcuts((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doSave, chapters, routeChapterId, navigate, projectId, editorStore]);

  // 切章时先保存
  useEffect(() => {
    return () => {
      void doSave("switch");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeChapterId]);

  // 处理改写工单：内容加载完成后，在正文里定位证据原文并选中
  useEffect(() => {
    if (!handle || !workOrder.quote || loadedFor !== routeChapterId) return;
    handle.focus();
    useEditorStore.getState().setSelection(workOrder.quote, { from: 0, to: 0 });
    notify("info", "已定位到问题段落", "点右侧「改写」按建议重写这一段");
    // 清掉一次性参数，避免刷新后重复提示
    const next = new URLSearchParams(searchParams);
    next.delete("fix");
    next.delete("quote");
    next.delete("from");
    next.delete("to");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle, workOrder.quote, loadedFor, routeChapterId]);

  const insertFromAi = useCallback(
    (text: string, mode: "cursor" | "end" | "replace-selection") => {
      if (!handle) return;
      const isChapterEmpty = isEmptyDoc(draftHtml);
      handle.insertText(text, isChapterEmpty && mode !== "end" ? "cursor" : mode);
      notify("success", "已插入正文", "记得检查一下衔接是否自然");
    },
    [handle, draftHtml, notify],
  );

  const currentIndex = chapters.findIndex((c) => c.id === routeChapterId);
  const sessionWords = editorStore.sessionWords;

  const statusBar = (
    <div className="flex shrink-0 items-center justify-between gap-3 border-t border-black/5 px-4 py-1.5 text-[11px] dark:border-white/5">
      <div className="flex items-center gap-3 opacity-60">
        <span className="tabular">{formatWords(draftWords)}</span>
        <span className="tabular opacity-70">{countChars(draftHtml)} 字符</span>
        {sessionWords > 0 && <span className="tabular text-emerald-600 dark:text-emerald-400">本次 +{sessionWords}</span>}
        {editorStore.dirty ? (
          <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
            <span className="animate-pulse-soft">●</span> 未保存
          </span>
        ) : (
          <span className="flex items-center gap-1 opacity-50">
            <Save className="size-3" />
            {editorStore.lastSavedAt ? formatRelative(new Date(editorStore.lastSavedAt).toISOString()) : "已同步"}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3 opacity-60">
        <PomodoroTimer
          onComplete={(minutes, words) => {
            void logPomodoro(projectId, minutes, true, words);
            notify("success", "完成一个番茄钟", minutes + " 分钟 · " + words + " 字");
          }}
        />
        <Tooltip>
          <Tooltip.Trigger>
            <button
              type="button"
              onClick={() => setShowShortcuts(true)}
              className="flex items-center gap-1 rounded px-1 py-0.5 transition hover:bg-black/5 dark:hover:bg-white/10"
            >
              <Keyboard className="size-3" />
            </button>
          </Tooltip.Trigger>
          <Tooltip.Content>快捷键（Shift+?）</Tooltip.Content>
        </Tooltip>
        <span className="tabular">
          {currentIndex >= 0 ? currentIndex + 1 : "-"} / {chapters.length}
        </span>
      </div>
    </div>
  );

  const toolbar = (
    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-black/5 px-3 py-2 dark:border-white/5">
      <div className="flex min-w-0 items-center gap-1.5">
        <Tooltip>
          <Tooltip.Trigger>
            <Button isIconOnly size="sm" variant="ghost" onPress={() => navigate(ROUTES.overview(projectId))}>
              <ArrowLeft className="size-4" />
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content>返回总览</Tooltip.Content>
        </Tooltip>
        <Tooltip>
          <Tooltip.Trigger>
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              onPress={() => setSidebarCollapsed((v) => !v)}
            >
              {sidebarCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content>目录</Tooltip.Content>
        </Tooltip>
        <div className="ml-1 min-w-0">
          <p className="truncate text-sm font-medium">{chapter?.title ?? "未选择章节"}</p>
          <p className="truncate text-[10px] opacity-45">{project?.title}</p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {chapter && (
          <Chip size="sm" color="default">
            {chapter.status === "drafting" ? "写作中" : chapter.status === "idea" ? "构思" : chapter.status}
          </Chip>
        )}
        <Tooltip>
          <Tooltip.Trigger>
            <Button isIconOnly size="sm" variant="ghost" onPress={() => setShowSettings(true)}>
              <Settings2 className="size-4" />
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content>章节属性</Tooltip.Content>
        </Tooltip>
        <Tooltip>
          <Tooltip.Trigger>
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              onPress={() => {
                editorStore.setRightPanel(rightPanel === "snapshots" ? "ai" : "snapshots");
              }}
            >
              <History className="size-4" />
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content>版本快照</Tooltip.Content>
        </Tooltip>
        <Tooltip>
          <Tooltip.Trigger>
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              onPress={() => {
                editorStore.setFlow(true);
              }}
            >
              <Maximize2 className="size-4" />
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content>心流模式（⌘⇧F）</Tooltip.Content>
        </Tooltip>
        <Tooltip>
          <Tooltip.Trigger>
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              onPress={() => {
                editorStore.setRightPanel(rightPanel === "none" ? "ai" : "none");
              }}
            >
              {rightPanel === "none" ? <PanelRightOpen className="size-4" /> : <PanelRightClose className="size-4" />}
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content>AI 面板</Tooltip.Content>
        </Tooltip>
      </div>
    </div>
  );

  if (!projectId) return null;

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-neutral-50 dark:bg-neutral-950">
      {!flow && !sidebarCollapsed && (
        <ChapterList
          projectId={projectId}
          arcs={arcs}
          chapters={chapters}
          activeChapterId={routeChapterId}
          collapsed={false}
        />
      )}
      {!flow && sidebarCollapsed && (
        <ChapterList
          projectId={projectId}
          arcs={arcs}
          chapters={chapters}
          activeChapterId={routeChapterId}
          collapsed
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {!flow && toolbar}

        <div className="min-h-0 flex-1 overflow-y-auto bg-white dark:bg-neutral-900/40">
          {!routeChapterId || !chapter ? (
            <div className="grid h-full place-items-center px-6 text-center">
              <div>
                <Type className="mx-auto mb-3 size-8 opacity-20" />
                <p className="text-sm font-medium">还没有章节</p>
                <p className="mt-1.5 max-w-xs text-xs leading-relaxed opacity-55">
                  创建第一章，或者到大纲页用 AI 生成整体结构。
                </p>
                <div className="mt-4 flex justify-center gap-2">
                  <Button
                    size="sm"
                    variant="primary"
                    onPress={async () => {
                      const c = await createChapter(projectId, {});
                      navigate(ROUTES.write(projectId, c.id));
                    }}
                  >
                    新建第一章
                  </Button>
                  <Button size="sm" variant="outline" onPress={() => navigate(ROUTES.outline(projectId))}>
                    去大纲页
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <EditorCanvas
              chapterKey={chapter.id}
              initialHtml={loadedFor === chapter.id ? draftHtml : content?.html ?? "<p></p>"}
              fontSize={settings.editorFontSize}
              maxWidth={flow ? Math.max(settings.editorMaxWidth, 720) : settings.editorMaxWidth}
              typewriter={settings.typewriterScroll}
              onReady={setHandle}
              onChange={onEditorChange}
              onSelectionChange={(text, range) => useEditorStore.getState().setSelection(text, range)}
              onStats={() => undefined}
            />
          )}
        </div>

        {!flow && statusBar}
      </div>

      {!flow && rightPanel === "ai" && (
        <AiPanel
          projectId={projectId}
          chapterId={routeChapterId}
          onInsert={insertFromAi}
          injectedInstruction={workOrder.fix}
          injectedQuote={workOrder.quote}
        />
      )}
      {!flow && rightPanel === "snapshots" && chapter && (
        <SnapshotPanel
          chapter={chapter}
          onClose={() => editorStore.setRightPanel("ai")}
          onRestore={async (snapshotId) => {
            await restoreSnapshot(snapshotId);
            const fresh = await getChapterContent(chapter.id);
            setDraftHtml(fresh?.html ?? "<p></p>");
            setDraftWords(countWords(fresh?.text ?? ""));
            setLoadedFor("");
            notify("success", "已恢复到该快照", "原内容已自动备份为「恢复前自动备份」");
          }}
        />
      )}

      {showSettings && chapter && (
        <ChapterSettings
          chapter={chapter}
          projectId={projectId}
          onClose={() => setShowSettings(false)}
          onSaved={() => notify("success", "章节属性已保存")}
        />
      )}

      {showShortcuts && <ShortcutSheet onClose={() => setShowShortcuts(false)} />}

      {flow && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2">
          <div className="flex items-center gap-3 rounded-full bg-black/80 px-4 py-2 text-xs text-white shadow-lg backdrop-blur">
            <span className="tabular">{formatWords(draftWords)}</span>
            <span className="opacity-60">{editorStore.dirty ? "未保存" : "已保存"}</span>
            <button type="button" onClick={() => editorStore.setFlow(false)} className="flex items-center gap-1 opacity-80 hover:opacity-100">
              <Minimize2 className="size-3.5" />
              退出心流
            </button>
          </div>
        </div>
      )}

      {flow && (
        <Tooltip>
          <Tooltip.Trigger>
            <button
              type="button"
              onClick={() => updateSettings({ typewriterScroll: !settings.typewriterScroll })}
              className="fixed right-6 top-6 z-50 rounded-full bg-black/70 p-2 text-white opacity-30 transition hover:opacity-90"
            >
              <Eye className="size-4" />
            </button>
          </Tooltip.Trigger>
          <Tooltip.Content>{settings.typewriterScroll ? "关闭打字机滚动" : "开启打字机滚动"}</Tooltip.Content>
        </Tooltip>
      )}

      {flow && (
        <span className="fixed left-6 top-6 z-50 flex items-center gap-2 text-[11px] text-white/50">
          <Zap className="size-3" />
          <Clock className="size-3" />
          {formatClock(Math.round((Date.now() - lastActivity.current) / 1000))} 前有输入
        </span>
      )}
    </div>
  );
}

function ShortcutSheet({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ["⌘/Ctrl + S", "立即保存"],
    ["⌘/Ctrl + J", "AI 续写当前章节"],
    ["⌘/Ctrl + ⇧ + F", "进入 / 退出心流模式"],
    ["⌘/Ctrl + ⌥ + ↑/↓", "上一章 / 下一章"],
    ["⌘/Ctrl + K", "命令面板"],
    ["⌘/Ctrl + ,", "打开设置"],
    ["Esc", "退出心流模式"],
    ["Shift + ?", "显示这份快捷键"],
  ];
  return (
    <div className="fixed inset-0 z-[400] grid place-items-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-3 text-sm font-semibold">快捷键</h3>
        <ul className="space-y-1.5">
          {rows.map(([k, v]) => (
            <li key={k} className="flex items-center justify-between text-xs">
              <kbd className="rounded bg-black/5 px-1.5 py-0.5 font-mono dark:bg-white/10">{k}</kbd>
              <span className="opacity-70">{v}</span>
            </li>
          ))}
        </ul>
        <Button className="mt-4" size="sm" variant="outline" fullWidth onPress={onClose}>
          知道了
        </Button>
      </div>
    </div>
  );
}
