import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Button, Chip, Tooltip } from "@heroui/react";
import {
  Clock, Eye, History, Keyboard, Maximize2, Minimize2, PanelLeftClose,
  PanelLeftOpen, PanelRightClose, PanelRightOpen, Save, ScanEye, Type, Wand2, Zap,
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
import { CommentPanel } from "./CommentPanel";
import { ProjectNav } from "@/components/layout/ProjectNav";
import type { ReviewMarkInput } from "./EditorCanvas";
import {
  addReviewSuggestion,
  listComments,
  listReviewSuggestions,
  markReviewSuggestion,
} from "@/db/repo/review";
import { useLiveQuery } from "dexie-react-hooks";
import type { ChapterComment, ReviewSuggestion } from "@/core";
import { locateAnchor, makeAnchor } from "@/utils/anchor";
import { docToText as docToPlainText } from "@/utils/rich-text";
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
  /**
   * 编辑器里装的是**哪一章**、以及**那一章的**内容。
   *
   * 两者必须放在同一个状态里一起更新。分开就会在切章时出现
   * "key 已经是新章、内容还是旧章"的错配 —— 那正是内容串章的来源。
   *
   * 输入时只更新 html（id 不变）；装载新章时两者一起换。
   */
  const [loadedFor, setLoadedFor] = useState<{ id: string; html: string }>({ id: "", html: "" });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  /**
   * 正在编辑属性的章节。
   *
   * 两个入口都指向它：左侧章节列表里每条的小齿轮，以及工具栏的齿轮（作用于当前章）。
   * 用"哪一章"而不是布尔值 —— 这样从列表点非当前章时也不会改错对象。
   */
  const [settingsFor, setSettingsFor] = useState<Chapter | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const saveTimer = useRef<number | null>(null);
  const sessionRef = useRef<ID | undefined>(undefined);
  const lastActivity = useRef<number>(Date.now());
  const initialWords = useRef<number>(0);
  /**
   * 编辑器里当前这份内容**属于哪一章**。
   *
   * ## 为什么需要（这是一个真实的数据损坏 bug）
   *
   * 切章时新章节的数据是异步取回来的，中间有一小段空窗：
   * store 里的 chapterId 还是旧的，而编辑器已经换了内容。
   * 那段时间任何一次保存都会**把新章的正文写进旧章**。
   * 实测症状：切到第二章，第一章的正文里出现了第二章的内容；再切几下又串回来。
   *
   * ## 为什么不能只记"当前章"
   *
   * 只记"编辑器里是哪一章"，切章时就无法再保存旧章 —— 旧章的未保存内容会被丢掉。
   * 所以这里记的是**「编辑器里这份内容属于哪一章」**，一次只装一份：
   *
   *   { chapterId: "A", html: "<p>A 的正文</p>" }
   *
   * 保存时拿它去写它自己的 chapterId，**永远不会写错对象**；
   * 而挂载新章时先把上一份**冲出去**，未保存的内容也不会丢。
   */
  /**
   * **编辑器当前真正持有的那一份内容，以及它属于哪一章。**
   *
   * 这是保存的唯一依据。两条不变式：
   *
   * 1. `chapterId` 与 `html` **永远一起更新** —— 不存在"内容属于 A、章节写着 B"；
   * 2. 它只在**编辑器确实换成了那一章的内容之后**才指向新章。
   *
   * ## 踩过的两个坑（都因为违反了上面某一条）
   *
   * ① 内容用 `draftHtml`（渲染闭包）：晚一拍 → 丢最后一个字。
   * ② 装载时**先把 ref 换成新章**、再让编辑器换内容：
   *    中间那段窗口里编辑器还是旧章内容，而 ref 已说是新章 →
   *    此刻到达的 onChange 把**旧章正文认成新章的** → 甲的正文写进乙。
   *
   * ## 为什么用"待认领"而不是先清空
   *
   * ② 的第一次修法是"装载前先把 chapterId 清空，到达的 onChange 一律不采纳"。
   * 那会**连新章自己的第一次 onChange 一起丢掉**（诊断日志里看到 owner 为空），
   * 结果新章的输入永不保存。
   *
   * 改成"外部记账 + 待认领"仍然失败：认领时机依赖 effect 执行顺序，
   * 实测 pending 常常还没设上、onChange 就已经到了。
   *
   * **最终做法**：归属由编辑器随 onChange 一起给出（见 onEditorChange 的第三个参数），
   * 彻底不需要外部记账。
   */
  const contentRef = useRef<{ chapterId: ID | ""; html: string }>({ chapterId: "", html: "" });
  /** 上一次真正写进数据库的内容 —— 用来判断"这次有没有必要写" */
  const lastSavedRef = useRef<{ chapterId: ID | ""; html: string }>({ chapterId: "", html: "" });
  /**
   * **哪一章**的内容已经真正装进编辑器了。
   *
   * ## 为什么必须单独标记（这是"内容变空"的根因）
   *
   * 编辑器的初始内容是 `"<p></p>"`（7 个字符，truthy），而 `stripHtml` 之后是空字符串。
   * 首次挂载时它会立刻触发一次 onChange → 标记 dirty → 自动保存，
   * 于是**在真实内容装载完成之前就把这一章存成了空**。
   * 实测：库里 textLen=0 且 rev 递增，而编辑器里还显示着（随后装载进来的）正文 ——
   * 用户看到的正是"内容过一会就没了"。
   *
   * ## 为什么记"哪一章"而不是一个布尔值
   *
   * 布尔值在切章时会误伤：新章还没装载，而上一章的内容是好的、需要冲刷落库。
   * 记下章节号就能精确判断"编辑器里现在这份内容，是不是已经装载完成的那一份"。
   */
  const loadedReadyRef = useRef<ID | "">("");
  /**
   * 正在把某一章的内容塞进编辑器。
   *
   * ## 为什么需要它（这是最后一块拼图）
   *
   * `editor.commands.setContent(html, { emitUpdate: false })` **并不能阻止 onUpdate 触发** ——
   * 实测：每次装载都会用刚设进去的内容触发一次 onChange，把 dirty 置真、
   * 排一次自动保存。于是刷新后装载到一半（编辑器里还是初始空文档）时，
   * 那次自动保存就把整章写成了空。
   *
   * 所以装载期间到达的 onChange 一律忽略：那不是作者的编辑，是装载的副作用。
   */
  const loadingRef = useRef(false);
  /**
   * 编辑器里的内容被作者**真的改过**（不是装载、不是切章带来的）。
   *
   * 只有它为 true 时才值得往数据库写：
   * 否则切一次章就会把没动过的正文原样写回去一遍，白白产生快照与版本号。
   */
  /*
    不再单独维护"人是否改过"：store 里的 dirty 就是这件事的唯一答案。
    之前 userEdited 与 dirty 并存，等于同一件事有两个来源 —— 它们会不同步，
    而"保存被跳过 / 内容归属判断错"都源于此。
  */

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

  /**
   * 装载某一章的内容到编辑器。
   *
   * 关键顺序：**先把上一份冲出去，再装新的**。
   * 冲刷必须在覆盖状态之前完成 —— 一旦 contentRef 被换成新章的内容，
   * 旧章的未保存编辑就再也写不回去了。
   */
  const loadChapterInto = useCallback(
    async (target: Chapter, html: string, text: string) => {
      /*
        先冲刷上一章：此刻 contentRef 里还是上一章的内容与它的 id，
        两者配套，直接写回它自己的章节 —— 不会写错对象。
      */
      /*
        先冲刷上一章。
        冲刷对象取 contentRef 的章节；若它还没被认领（pendingChapter 有值），
        说明编辑器的内容正被换走，那就冲刷 pending 指向的那一章 ——
        它是"这份旧内容真正属于的章节"。
      */
      const prev = contentRef.current;
      const prevOwner = prev.chapterId;
      if (prevOwner && prevOwner !== target.id && useEditorStore.getState().dirty) {
        await saveChapterContent(prevOwner, prev.html);
      }
      // 从这里开始到装载结束，编辑器产生的 onChange 都是装载副作用
      loadingRef.current = true;
      setDraftHtml(html);
      /*
        装载完成即同步 contentRef 与 lastSavedRef。
        不能等某次 onChange 恰好到达 —— 若 loadingRef 拦住了它，
        contentRef 会仍指向上一章，随后的自动保存/接受修订都会读到旧文。
      */
      contentRef.current = { chapterId: target.id, html };
      lastSavedRef.current = { chapterId: target.id, html };
      setDraftWords(target.wordCount || countWords(text));
      setLoadedFor({ id: target.id, html });
      /*
        装载结束。用**微任务**而不是同步赋值：
        setContent 触发的 onChange 是同步派发的，若在它之前就清掉标记，
        那次回调又会被当成作者的编辑。
      */
      queueMicrotask(() => {
        loadingRef.current = false;
      });
      editorStore.setChapter(target.id, projectId);
      // 新章的脏标记清零：它是上一章遗留下来的，
      // 留着会让切章后的第一次保存把新章内容写回去（即使内容没变）
      useEditorStore.getState().setDirty(false);
      initialWords.current = target.wordCount || 0;
      void listSnapshots(target.id).then((s) => editorStore.setSnapshots(s));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    if (!chapter || !content || loadedFor.id === chapter.id) return;
    /*
      useLiveQuery 换 chapterId 时会先渲染一帧**上一章**的 content
      （新订阅尚未 emit）。不校验归属就会把旧章正文装进新章 ——
      实测切回来显示的是第二章内容。
    */
    if (content.chapterId !== chapter.id) return;
    /*
      关键：**先从库里读到了内容**，才允许写入这一章。
      放在 effect 里而不是 loadChapterInto 里 —— 后者由本 effect 调用，
      而编辑器的初始空文档可能在它之前就触发了 onChange。
    */
    loadedReadyRef.current = chapter.id;
    void loadChapterInto(chapter, content.html ?? "<p></p>", content.text ?? "");
  }, [chapter, content, loadedFor, loadChapterInto]);

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
    async (reason: "auto" | "manual" | "switch", targetChapterId?: ID) => {
      const state = useEditorStore.getState();
      const { chapterId: ownerId, html } = contentRef.current;
      /*
        要写的是**这份内容自己的章节**（ownerId），而不是 store 里的当前章 ——
        切章空窗期里 store 可能已经指向新章。调用方若明确指定了目标章
        （切章时的冲刷会传"我正要离开的那一章"），以它为准。
      */
      const cid = targetChapterId ?? ownerId;
      if (!cid) return;
      // 内容与所属章节对不上（切章空窗期）时，宁可这次不写，也不能写错对象
      if (!ownerId || ownerId !== cid) return;
      /*
        空守卫。
        `"<p></p>"` 是 truthy，所以单靠 `if (!html)` 拦不住空文档 ——
        页面刚加载、装载还没完成时 contentRef 本来就是空的，
        首屏那次保存会把**整章正文清空**（实测：库里变空，而编辑器里还显示着旧内容）。
        两边都空才跳过：作者在空章节里反复没打字不该产生写入，
        而"原本有内容、被作者全删了"仍会正常写出去。
      */
      /*
        编辑器里这份内容必须**已经是装载完成的那一份**才允许写。
        初始空文档（装载完成前）会立刻触发一次 onChange，若放它写进去，
        整章正文就被清空了 —— 这正是用户报的"内容没了"。
      */
      /*
        只有"已经从库里把这一章读出来"之后才允许写入。
        loadedReadyRef 在**装载 effect 真正拿到内容之后**才被赋值 ——
        刷新后 refs 全部重置，编辑器的初始空文档会立刻触发一次 onChange，
        此时 loadedReadyRef 为空，这一道就把清空挡在了外面
        （实测：刷新 4 秒后整章被写成空，就是漏了这一道）。
      */
      if (loadedReadyRef.current !== cid) return;
      // 内容没变就不写（避免切章时把没动过的正文原样写回一遍，白白产生版本号）
      if (html === lastSavedRef.current.html && cid === lastSavedRef.current.chapterId) {
        // 装载副作用触发的保存：内容一致时顺带清 dirty，否则一打开章就永远"未保存"
        state.setDirty(false);
        return;
      }
      state.setSaving(true);
      const res = await saveChapterContent(cid, html);
      lastSavedRef.current = { chapterId: cid, html };
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

  // handle 的 ref：doSave 需要在调用那一刻取到最新的编辑器句柄
  const handleRef = useRef<EditorCanvasHandle | null>(null);
  useEffect(() => {
    handleRef.current = handle;
  }, [handle]);

  /**
   * 绕过编辑器直接写库之后（接受修订、恢复快照），原子地同步保存侧状态。
   *
   * 少做任何一步都会被随后的自动保存/切章冲刷用**旧 contentRef** 写回去，
   * 刚应用的修订会被静默撤销。
   */
  const commitExternalContent = useCallback((chapterId: ID, html: string, words: number) => {
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    contentRef.current = { chapterId, html };
    lastSavedRef.current = { chapterId, html };
    loadedReadyRef.current = chapterId;
    setDraftHtml(html);
    setDraftWords(words);
    const state = useEditorStore.getState();
    state.markSaved(words);
    state.setDirty(false);
  }, []);

  const onEditorChange = useCallback(
    (html: string, words: number, ownerChapterId: string) => {
      setDraftHtml(html);
      setDraftWords(words);
      lastActivity.current = Date.now();
      /*
        归属由**编辑器**在触发回调的同一时刻给出（第三个参数）——
        内容与归属一起到达，不存在"内容属于 A、章节写着 B"的窗口。
        这是踩了两次时序坑之后的做法：外部记账在切章时必然有一段错位，
        而错位窗口里的回调会把新章内容认成旧章的（实测：乙的正文被写进甲）。
      */
      /*
        装载期间的回调是 setContent 的副作用，不是作者编辑 —— 直接忽略。
        （setContent 的 emitUpdate:false 拦不住 onUpdate，这一点实测确认过。）
      */
      if (loadingRef.current) return;
      if (!ownerChapterId) return;
      contentRef.current = { chapterId: ownerChapterId, html };
      /*
        这里**故意不更新 loadedFor.html**：initialHtml 由它派生，
        若输入也改它，每次敲键都会让"初始内容"变化，等于把编辑器内容反复重置。
        loadedFor.html 的语义是"装载时塞进编辑器的那一份"，装载后就不该再变。
      */
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

  // 切章时把正在离开的那一章冲刷落库
  useEffect(() => {
    const leaving = routeChapterId;
    return () => {
      // 明确指定"写回我正要离开的那一章"，而不是让它去猜当前章（会猜错）
      void doSave("switch", leaving);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeChapterId]);

  // 处理改写工单：内容加载完成后，在正文里定位证据原文并选中
  useEffect(() => {
    if (!handle || !workOrder.quote || loadedFor.id !== routeChapterId) return;
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

  // ---------- 审稿：评论与修订建议 ----------
  const comments = useLiveQuery(
    () => (routeChapterId ? listComments(routeChapterId) : Promise.resolve([])),
    [routeChapterId],
    [] as ChapterComment[],
  );
  const suggestions = useLiveQuery(
    () => (routeChapterId ? listReviewSuggestions(routeChapterId) : Promise.resolve([])),
    [routeChapterId],
    [] as ReviewSuggestion[],
  );

  /** 正文纯文本（审稿锚点、AI 上下文都用它） */
  const plainText = useMemo(() => docToPlainText(draftHtml), [draftHtml]);

  /** 待处理 + 已处理的审稿标记，叠加到正文上 */
  const reviewMarks = useMemo<ReviewMarkInput[]>(() => {
    const marks: ReviewMarkInput[] = [];
    for (const c of comments) {
      if (!c.anchor) continue;
      const hit = locateAnchor(plainText, c.anchor);
      if (!hit) continue;
      marks.push({ from: hit.from, to: hit.to, data: { kind: "comment", id: c.id, muted: c.resolved, label: c.body.slice(0, 40) } });
    }
    for (const s of suggestions) {
      const hit = locateAnchor(plainText, s.anchor);
      if (!hit) continue;
      marks.push({
        from: hit.from,
        to: hit.to,
        data: { kind: s.kind, id: s.id, muted: s.status !== "pending", label: s.reason ?? s.proposed.slice(0, 40) },
      });
    }
    return marks;
  }, [comments, suggestions, plainText]);

  /** 接受一条建议：把正文里那段替换掉，并标记为已接受 */
  const acceptSuggestion = useCallback(
    async (id: ID) => {
      const s = suggestions.find((x) => x.id === id);
      if (!s) return;
      const hit = locateAnchor(plainText, s.anchor);
      if (!hit) {
        notify("warning", "这条建议的原文已经找不到了", "正文改动较大，已标记为已接受");
        await markReviewSuggestion(id, "accepted");
        return;
      }
      const next =
        s.kind === "delete"
          ? plainText.slice(0, hit.from) + plainText.slice(hit.to)
          : plainText.slice(0, hit.from) + s.proposed + plainText.slice(hit.to);
      // 改动前存一个快照，方便回退
      if (chapter) await createSnapshot(chapter.id, "应用修订建议前", "pre-ai");
      const html = textToDoc(next);
      const res = await saveChapterContent(chapter!.id, html);
      commitExternalContent(chapter!.id, html, res.words);
      await markReviewSuggestion(id, "accepted");
      notify("success", s.kind === "delete" ? "已删除该段" : "已应用修订");
    },
    [suggestions, plainText, chapter, notify, commitExternalContent],
  );

  const rejectSuggestion = useCallback(
    async (id: ID) => {
      await markReviewSuggestion(id, "rejected");
      notify("info", "已拒绝该建议");
    },
    [notify],
  );

  /** 全部接受：从后往前应用，避免偏移互相影响 */
  const acceptAllSuggestions = useCallback(async () => {
    const pending = suggestions.filter((s) => s.status === "pending");
    const located: { s: ReviewSuggestion; hit: { from: number; to: number } }[] = [];
    for (const s of pending) {
      const hit = locateAnchor(plainText, s.anchor);
      if (hit) located.push({ s, hit: { from: hit.from, to: hit.to } });
    }
    located.sort((a, b) => b.hit.from - a.hit.from);
    if (!located.length) {
      notify("warning", "没有可应用的修订", "建议锚定的原文都找不到了");
      return;
    }
    if (chapter) await createSnapshot(chapter.id, "批量应用修订前", "pre-ai");
    let next = plainText;
    for (const { s, hit } of located) {
      next = s.kind === "delete" ? next.slice(0, hit.from) + next.slice(hit.to) : next.slice(0, hit.from) + s.proposed + next.slice(hit.to);
    }
    const html = textToDoc(next);
    const res = await saveChapterContent(chapter!.id, html);
    commitExternalContent(chapter!.id, html, res.words);
    for (const { s } of located) await markReviewSuggestion(s.id, "accepted");
    notify("success", "已应用 " + located.length + " 条修订");
  }, [suggestions, plainText, chapter, notify, commitExternalContent]);

  /** 把 AI 生成的一段内容变成"修订建议"而不是直接插入正文 */
  const suggestFromAi = useCallback(
    async (text: string) => {
      if (!chapter) return;
      const offsets = useEditorStore.getState().selectionOffsets;
      const anchor = offsets
        ? makeAnchor(plainText, offsets.from, offsets.to)
        : { from: Math.max(0, plainText.length - 1), to: plainText.length, quote: "" };
      await addReviewSuggestion({
        projectId,
        chapterId: chapter.id,
        kind: anchor.quote ? "replace" : "insert",
        anchor,
        proposed: text,
        reason: "由 AI 生成，待你确认",
        source: "ai",
      });
      useEditorStore.getState().setRightPanel("review");
      notify("success", "已加入修订建议", "到审稿面板逐条接受或拒绝");
    },
    [chapter, plainText, projectId, notify],
  );

  const pendingReviewCount =
    comments.filter((c) => !c.resolved).length + suggestions.filter((s) => s.status === "pending").length;

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
        {/*
          这里原来有个「返回总览」的箭头按钮。
          加入左侧项目导航（ProjectNav）之后它就成了冗余 —— 导航里本来就有「总览」，
          而且左上角的书名可以回到书库。工具栏本来就挤，去掉一个重复入口更清爽。
        */}
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
        {/*
          「AI 助手」：显式入口，带文字标签。
          以前这里是「章节属性」齿轮 —— 而章节属性已经移到左侧章节列表的每一行上
          （点哪一章改哪一章），工具栏这个是重复入口，去掉后正好把位置让给 AI 助手。
        */}
        <Button
          size="sm"
          variant={rightPanel === "ai" ? "secondary" : "ghost"}
          aria-label="AI 助手"
          onPress={() => editorStore.setRightPanel(rightPanel === "ai" ? "none" : "ai")}
        >
          <Wand2 className="size-4" />
          AI 助手
        </Button>
        <Tooltip>
          <Tooltip.Trigger>
            <Button
              isIconOnly
              size="sm"
              variant={rightPanel === "review" ? "secondary" : "ghost"}
              aria-label="审稿"
              onPress={() => {
                editorStore.setRightPanel(rightPanel === "review" ? "ai" : "review");
              }}
            >
              <span className="relative">
                <ScanEye className="size-4" />
                {pendingReviewCount > 0 && (
                  <span className="absolute -right-1.5 -top-1.5 grid size-3.5 place-items-center rounded-full bg-amber-500 text-[8px] font-medium text-white">
                    {pendingReviewCount > 9 ? "9+" : pendingReviewCount}
                  </span>
                )}
              </span>
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content>审稿（批注与修订建议）</Tooltip.Content>
        </Tooltip>
        <Tooltip>
          <Tooltip.Trigger>
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              aria-label="版本快照"
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
      {/*
        项目导航。写作页是三栏（目录 / 正文 / AI 面板），套不进 PageScaffold，
        所以直接放这个组件 —— 没有它的时候，人一进写作页就没法切到别的页面了，
        只能靠浏览器后退（用户反馈："打开总览和写作，侧边栏消失了"）。
        心流模式下隐藏，那正是"什么都别打扰我"的场景。
      */}
      {!flow && <ProjectNav className="hidden lg:flex" />}

      {!flow && !sidebarCollapsed && (
        <ChapterList
          projectId={projectId}
          arcs={arcs}
          chapters={chapters}
          activeChapterId={routeChapterId}
          collapsed={false}
          onOpenSettings={setSettingsFor}
        />
      )}
      {!flow && sidebarCollapsed && (
        <ChapterList
          projectId={projectId}
          arcs={arcs}
          chapters={chapters}
          activeChapterId={routeChapterId}
          collapsed
          onOpenSettings={setSettingsFor}
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
          ) : loadedFor.id !== routeChapterId ? (
            /*
              **内容没就位就不挂载编辑器** —— 这是解决"内容变空"的关键一步。
              编辑器带空文档挂载时会立刻触发一次 onChange，
              而那一刻它报的内容是 `<p></p>`（stripHtml 后为空），
              自动保存就把整章写成了空。等装载完成再挂载，它出生的第一份内容就是对的。
            */
            <div className="grid h-full place-items-center text-xs opacity-50">正在载入本章…</div>
          ) : (
            <EditorCanvas
              /*
                key 用章节号：**每章让编辑器重新挂载**，而不是事后 setContent 改写。
                两个原因：
                 ① 挂载时内容就已经是对的（上面的条件保证了这一点），
                    编辑器不会先报一次"空内容"；
                 ② 切章时旧编辑器卸载，其清理逻辑负责把上一章冲刷落库。
              */
              chapterKey={routeChapterId}
              /*
                内容只在"确实已为该章装载"时给出。
                原来未装载时回退到 content?.html / draftHtml，
                而它们在切章瞬间都还是**上一章**的正文 →
                编辑器一换 key 就把上一章内容灌进新章（症状①）。
                未装载时给空文档，真正的装载由装载 effect 完成。
              */
              ownedHtml={loadedFor.id === routeChapterId ? loadedFor.html : ""}
              reviewMarks={reviewMarks}
              fontSize={settings.editorFontSize}
              maxWidth={flow ? Math.max(settings.editorMaxWidth, 720) : settings.editorMaxWidth}
              typewriter={settings.typewriterScroll}
              onReady={setHandle}
              onChange={onEditorChange}
              onSelectionChange={(text, range) => {
                // 同时记录"纯文本偏移"，审稿锚点用它（ProseMirror 位置会随编辑漂移）
                const offsets = handle?.getSelectionOffsets() ?? undefined;
                useEditorStore.getState().setSelection(text, range, offsets);
              }}
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
          onSuggest={suggestFromAi}
          injectedInstruction={workOrder.fix}
          injectedQuote={workOrder.quote}
        />
      )}
      {!flow && rightPanel === "review" && chapter && (
        <CommentPanel
          projectId={projectId}
          chapterId={chapter.id}
          text={plainText}
          selection={editorStore.selectionOffsets ?? null}
          onClose={() => editorStore.setRightPanel("ai")}
          onJumpTo={(from, to) => handle?.selectRange(from, to)}
          onAcceptSuggestion={(id) => void acceptSuggestion(id)}
          onRejectSuggestion={(id) => void rejectSuggestion(id)}
          onAcceptAll={() => void acceptAllSuggestions()}
        />
      )}
      {!flow && rightPanel === "snapshots" && chapter && (
        <SnapshotPanel
          chapter={chapter}
          onClose={() => editorStore.setRightPanel("ai")}
          onRestore={async (snapshotId) => {
            await restoreSnapshot(snapshotId);
            const fresh = await getChapterContent(chapter.id);
            const html = fresh?.html ?? "<p></p>";
            const words = countWords(fresh?.text ?? "");
            commitExternalContent(chapter.id, html, words);
            notify("success", "已恢复到该快照", "原内容已自动备份为「恢复前自动备份」");
          }}
        />
      )}

      {settingsFor && (
        <ChapterSettings
          chapter={settingsFor}
          projectId={projectId}
          onClose={() => setSettingsFor(null)}
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
