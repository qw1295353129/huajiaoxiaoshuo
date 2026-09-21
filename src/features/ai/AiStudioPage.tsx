import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { Button, Card, Chip, Tooltip } from "@heroui/react";
import { AlertTriangle, PanelRightClose, PanelRightOpen, Plus, Settings2, Sparkles } from "lucide-react";
import type { AiSession, ChatMessage, ID } from "@/core";
import { PageScaffold } from "@/components/common/PageScaffold";
import { EmptyHint, Loading } from "@/components/common/ui";
import { useChapter, useHotkey } from "@/app/hooks";
import { useAppStore } from "@/app/store";
import { useOpenSettings } from "@/app/useOpenSettings";
import { appendMessage, createAiSession, deleteAiSession, listAiSessions, updateAiSession } from "@/db/repo/ai";
import { getProvider, listProviders, resolveModel } from "@/db/repo/settings";
import { runText, systemWithProject } from "@/ai/runner";
import { newId } from "@/utils/id";
import { truncate } from "@/utils/text";
import { Composer } from "./Composer";
import { ContextPanel } from "./ContextPanel";
import { MessageList } from "./MessageList";
import { QuickActions, type QuickAction } from "./QuickActions";
import { SessionSidebar } from "./SessionSidebar";
import { fallbackSources, toCitation, type RunMeta } from "./meta";

/** 对话助手的人设补充，拼在通用 system 底座之后 */
const CHAT_EXTRA = [
  "你是这位作者的专属创作助手，只为这一部作品服务，熟悉它的设定、人物与前文。",
  "回答先给结论，再给理由；给方案就给 2~3 个方向，并说清各自适合什么情况。",
  "凡是涉及正文的文字，直接给出可以复制进稿子的成品，不要写「你可以这样写」这类空话。",
  "不确定的地方明确说不确定，绝不编造前文里没有的设定。",
].join("\n");

const STARTERS = [
  "用三句话告诉我这本书现在的核心冲突是什么。",
  "主角到目前为止做过最糟糕的决定是什么？后果够不够重？",
  "接下来五章，节奏上应该注意什么？",
];

/** AI 工作室：对话式创作台 */
export function AiStudioPage() {
  const { projectId = "" } = useParams<{ projectId: string }>();
  const project = useAppStore((s) => s.project);
  const chapterId = useAppStore((s) => s.chapterId);
  const settings = useAppStore((s) => s.settings);
  const openSettings = useOpenSettings();
  const notify = useAppStore((s) => s.notify);
  const chapter = useChapter(chapterId);

  const sessionsRaw = useLiveQuery(() => listAiSessions(projectId), [projectId], undefined);
  const sessions = useMemo<AiSession[]>(() => sessionsRaw ?? [], [sessionsRaw]);
  const providersRaw = useLiveQuery(() => listProviders(), [], undefined);

  const [activeId, setActiveId] = useState<ID>();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [stream, setStream] = useState<{ sessionId: ID; text: string; reasoning: string } | null>(null);
  const [runMeta, setRunMeta] = useState<Record<ID, RunMeta>>({});
  const [panelKey, setPanelKey] = useState<ID>();
  const [panelOpen, setPanelOpen] = useState(true);
  const [direct, setDirect] = useState(false);
  const [withChapter, setWithChapter] = useState(true);
  const [archived, setArchived] = useState<AiSession[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const streamTextRef = useRef("");
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const active = useMemo(
    () => sessions.find((s) => s.id === activeId) ?? sessions[0],
    [sessions, activeId],
  );
  const activeMessages = useMemo(() => active?.messages ?? [], [active]);

  // 真正会被调用的模型：走任务路由 > 全局默认，和 runner 的判断保持一致
  const [target, setTarget] = useState<{ providerName: string; model: string } | null>(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const resolved = await resolveModel("chat");
      if (!alive) return;
      if (!resolved.providerId || !resolved.model) {
        setTarget(null);
        return;
      }
      const provider = await getProvider(resolved.providerId);
      if (!alive) return;
      if (!provider || !provider.enabled) {
        setTarget(null);
        return;
      }
      setTarget({ providerName: provider.name, model: resolved.model });
    })();
    return () => {
      alive = false;
    };
  }, [providersRaw, settings.activeProviderId, settings.activeModel]);

  const modelReady = target !== null;
  const modelLabel = target ? target.providerName + " · " + target.model : "";

  // 引用面板默认展示最近一次生成的来源；
  // 刷新页面后运行时元信息会丢失，这时用消息里落库的 contextSources / citations 兜底
  const panelMeta = useMemo<RunMeta | undefined>(() => {
    if (panelKey && runMeta[panelKey]) return runMeta[panelKey];
    const ids = activeMessages.map((m) => m.id).filter((id) => runMeta[id]);
    const last = ids[ids.length - 1];
    if (last) return runMeta[last];
    const lastAssistant = [...activeMessages].reverse().find((m) => m.role === "assistant");
    if (!lastAssistant) return undefined;
    return {
      model: "",
      providerId: "",
      ms: 0,
      ok: !lastAssistant.error,
      error: lastAssistant.error,
      contextTokens: lastAssistant.usage?.prompt ?? 0,
      sources: fallbackSources(lastAssistant.citations, lastAssistant.contextSources),
    };
  }, [panelKey, runMeta, activeMessages]);

  // 切换项目时重置界面态
  useEffect(() => {
    setActiveId(undefined);
    setRunMeta({});
    setStream(null);
    setArchived([]);
    setPanelKey(undefined);
  }, [projectId]);

  // 新消息自动滚到底部
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [activeMessages.length, stream?.text]);

  const stop = () => {
    abortRef.current?.abort();
    notify("info", "已停止生成", "已经写出的内容会保留在对话里");
  };

  useHotkey("mod+enter", () => {
    if (!busy && input.trim()) void handleSend(input);
  });

  async function handleSend(text: string) {
    const content = text.trim();
    if (!content || busy) return;

    let sessionId = active?.id;
    let history: ChatMessage[] = [];
    if (!sessionId) {
      const created = await createAiSession(projectId, {
        taskKind: "chat",
        title: "新对话",
        chapterId: withChapter ? chapterId : undefined,
      });
      sessionId = created.id;
      setActiveId(created.id);
    } else {
      history = active.messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .slice(-12)
        .map((m) => ({ id: m.id, role: m.role, content: truncate(m.content, 4000), createdAt: m.createdAt }));
    }

    const useChapterId = withChapter ? chapterId : undefined;
    const userMessage: ChatMessage = {
      id: newId("msg"),
      role: "user",
      content,
      createdAt: new Date().toISOString(),
    };
    await appendMessage(sessionId, userMessage);

    setInput("");
    setBusy(true);
    streamTextRef.current = "";
    setStream({ sessionId, text: "", reasoning: "" });
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const system = await systemWithProject(projectId, CHAT_EXTRA);
      const result = await runText({
        taskKind: "chat",
        projectId,
        chapterId: useChapterId,
        system,
        user: content,
        history,
        context: { projectId, chapterId: useChapterId, query: content },
        signal: controller.signal,
        onDelta: (delta) => {
          if (delta.text) streamTextRef.current += delta.text;
          setStream((prev) => {
            if (!prev || prev.sessionId !== sessionId) return prev;
            return {
              ...prev,
              text: prev.text + (delta.text ?? ""),
              reasoning: prev.reasoning + (delta.reasoning ?? ""),
            };
          });
        },
      });

      // 手动停止时保留已经流式写出来的内容，不当成失败
      const aborted = controller.signal.aborted;
      const partial = streamTextRef.current.trim();
      const assistantText = result.ok
        ? result.text
        : aborted
          ? (partial ? partial + "\n\n（已手动停止生成）" : "（已停止生成）")
          : "生成失败：" + (result.error ?? "未知错误");

      const assistantMessage: ChatMessage = {
        id: newId("msg"),
        role: "assistant",
        content: assistantText,
        createdAt: new Date().toISOString(),
        usage: result.usage,
        citations: result.contextSources.map(toCitation),
        contextSources: result.contextSources,
        error: result.ok || aborted ? undefined : result.error,
        taskKind: "chat",
      };
      await appendMessage(sessionId, assistantMessage);
      setRunMeta((prev) => ({
        ...prev,
        [assistantMessage.id]: {
          model: result.model,
          providerId: result.providerId,
          ms: result.ms,
          ok: result.ok || aborted,
          error: result.ok || aborted ? undefined : result.error,
          contextTokens: result.contextTokens,
          sources: result.contextSources,
        },
      }));
      setPanelKey(assistantMessage.id);
      if (!result.ok && !aborted) notify("danger", "生成失败", result.error);
    } catch (e) {
      notify("danger", "生成异常", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setStream(null);
      abortRef.current = null;
    }
  }

  async function newSession() {
    const created = await createAiSession(projectId, {
      taskKind: "chat",
      title: "新对话",
      chapterId: withChapter ? chapterId : undefined,
    });
    setActiveId(created.id);
    setPanelKey(undefined);
    inputRef.current?.focus();
  }

  function selectSession(id: ID) {
    if (busy) {
      abortRef.current?.abort();
      notify("info", "已切换对话", "上一个对话的生成已取消");
    }
    setActiveId(id);
    setPanelKey(undefined);
  }

  async function renameSession(id: ID, title: string) {
    const next = title.trim();
    if (!next) return;
    await updateAiSession(id, { title: next });
    notify("success", "已重命名");
  }

  async function archiveSession(id: ID) {
    const target = sessions.find((s) => s.id === id);
    await updateAiSession(id, { archived: true });
    if (target) setArchived((prev) => [target, ...prev.filter((s) => s.id !== id)]);
    if (activeId === id) setActiveId(undefined);
    notify("info", "已归档", "归档的对话不在列表里显示");
  }

  async function restoreSession(id: ID) {
    await updateAiSession(id, { archived: false });
    setArchived((prev) => prev.filter((s) => s.id !== id));
    setActiveId(id);
    notify("success", "已恢复对话");
  }

  async function removeSession(id: ID) {
    const target = sessions.find((s) => s.id === id) ?? archived.find((s) => s.id === id);
    if (!window.confirm("删除对话「" + (target?.title ?? "") + "」？此操作不可撤销。")) return;
    await deleteAiSession(id);
    setArchived((prev) => prev.filter((s) => s.id !== id));
    if (activeId === id) setActiveId(undefined);
    notify("success", "已删除对话");
  }

  function pickAction(action: QuickAction) {
    if (direct && !action.needsInput) {
      void handleSend(action.prompt);
      return;
    }
    setInput(action.needsInput ? action.prompt : action.prompt);
    inputRef.current?.focus();
  }

  const chapterLabel = chapter ? "第 " + (chapter.order + 1) + " 章 " + chapter.title : undefined;

  return (
    <PageScaffold
      title="AI 工作室"
      description={
        project ? project.title + " · 与 AI 一起构思、检查、改写" : "对话式创作工作台"
      }
      contentClassName="overflow-hidden p-0"
      actions={
        <>
          <span className="hidden lg:inline-flex">
            <Tooltip>
              <Tooltip.Trigger>
                <Button
                  size="sm"
                  variant="ghost"
                  isIconOnly
                  aria-label="引用面板"
                  onPress={() => setPanelOpen((v) => !v)}
                >
                  {panelOpen ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content>显示 / 隐藏引用面板</Tooltip.Content>
            </Tooltip>
          </span>
          <Button size="sm" variant="secondary" onPress={() => void newSession()}>
            <Plus className="size-3.5" />
            新建对话
          </Button>
        </>
      }
    >
      <div className="flex h-full min-h-0">
        <SessionSidebar
          sessions={sessions}
          activeId={active?.id}
          archived={archived}
          onSelect={selectSession}
          onCreate={() => void newSession()}
          onRename={(id, title) => void renameSession(id, title)}
          onArchive={(id) => void archiveSession(id)}
          onRestore={(id) => void restoreSession(id)}
          onDelete={(id) => void removeSession(id)}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          {/* 模型状态条 */}
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-black/5 px-4 py-2 dark:border-white/5">
            <div className="flex min-w-0 items-center gap-2">
              <Chip size="sm" color={modelReady ? "accent" : "warning"}>
                <Sparkles className="mr-1 inline size-3" />
                {modelReady ? modelLabel : "未配置模型"}
              </Chip>
              <span className="truncate text-[11px] opacity-50">
                {modelReady ? "本次对话使用的模型" : "前往设置添加供应商与 API Key 后即可对话"}
              </span>
            </div>
            <div className="flex items-center gap-3">
              {chapterLabel && (
                <label className="flex cursor-pointer items-center gap-1.5 text-[11px] opacity-60">
                  <input
                    type="checkbox"
                    checked={withChapter}
                    onChange={(e) => setWithChapter(e.target.checked)}
                    className="accent-neutral-900"
                  />
                  带上当前章节
                  <span className="opacity-70">（{chapterLabel}）</span>
                </label>
              )}
              {!modelReady && (
                <Button size="sm" variant="outline" onPress={() => openSettings("models")}>
                  <Settings2 className="size-3.5" />
                  去设置
                </Button>
              )}
            </div>
          </div>

          {/* 消息区 */}
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {sessionsRaw === undefined ? (
              <Loading label="正在打开对话…" />
            ) : (
              <MessageList
                messages={activeMessages}
                streamText={stream && stream.sessionId === active?.id ? stream.text : null}
                reasoning={stream && stream.sessionId === active?.id ? stream.reasoning : ""}
                meta={runMeta}
                onInspect={(id) => {
                  setPanelKey(id);
                  setPanelOpen(true);
                }}
                empty={
                  <EmptyHint
                    icon={<Sparkles className="size-8" />}
                    title="开始一段新的创作对话"
                    description="AI 会自动带上这本书的人物、世界观、伏笔与当前章节，可以直接让它续写、诊断问题或出主意。"
                    action={
                      <div className="flex flex-wrap justify-center gap-2">
                        {STARTERS.map((s) => (
                          <Button
                            key={s}
                            size="sm"
                            variant="outline"
                            onPress={() => {
                              setInput(s);
                              inputRef.current?.focus();
                            }}
                          >
                            {s}
                          </Button>
                        ))}
                      </div>
                    }
                  />
                }
              />
            )}
          </div>

          {/* 输入区 */}
          <div className="shrink-0 border-t border-black/5 px-4 py-3 dark:border-white/5">
            <div className="mx-auto max-w-3xl">
              {!modelReady && (
                <Card className="mb-2 border border-amber-500/30 bg-amber-500/[0.06] p-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium">还没有可用的模型</p>
                      <p className="mt-0.5 text-[11px] leading-relaxed opacity-70">
                        对话需要调用模型。请到「设置 → 模型与 AI」添加供应商、填写 API Key 并选定当前模型（本地 Ollama /
                        LM Studio 无需 Key）。
                      </p>
                    </div>
                    <Button size="sm" variant="outline" onPress={() => openSettings("models")}>
                      去设置
                    </Button>
                  </div>
                </Card>
              )}

              <QuickActions
                onPick={pickAction}
                direct={direct}
                onToggleDirect={setDirect}
                disabled={busy}
              />

              <Composer
                value={input}
                onChange={setInput}
                onSubmit={() => void handleSend(input)}
                onStop={stop}
                busy={busy}
                disabled={!modelReady}
                inputRef={inputRef}
              />

              <p className="mt-2 text-center text-[11px] opacity-40">
                对话会保存在本机的当前项目中；生成过程与用量可在「AI 用量」页查看。
              </p>
            </div>
          </div>
        </div>

        {panelOpen && (
          <ContextPanel
            meta={panelMeta}
            budget={settings.contextBudget}
            onClose={() => setPanelOpen(false)}
          />
        )}
      </div>
    </PageScaffold>
  );
}
