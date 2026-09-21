import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { ID } from "@/core";
import { Button } from "@heroui/react";
import { FilePlus2, FileText, Layers, ListTree, Plus, Sparkles, TrendingUp } from "lucide-react";
import { PageScaffold } from "@/components/common/PageScaffold";
import { EmptyHint, Loading, StatCard } from "@/components/common/ui";
import { ROUTES } from "@/app/routes";
import { useAppStore } from "@/app/store";
import { useArcs, useChapters, useMetrics, useProject } from "@/app/hooks";
import { createArc, createChapter } from "@/db/repo/outline";
import { formatNumber, formatWords } from "@/utils/format";
import { ChapterPanel } from "./ChapterPanel";
import { OutlineGenModal } from "./OutlineGenModal";
import { OutlineTree } from "./OutlineTree";
import { TensionCurve } from "./TensionCurve";
import { arcColor, errorText, flattenGroups, groupChapters, sumWords } from "./outlineMeta";

/** 大纲页：左侧卷/章树 + 右侧章节详情，顶部统计与 AI 生成，中部情绪张力曲线。 */
export function OutlinePage() {
  const { projectId = "" } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const notify = useAppStore((s) => s.notify);

  const project = useProject(projectId);
  const arcs = useArcs(projectId) ?? [];
  const chapters = useChapters(projectId) ?? [];
  const metrics = useMetrics(projectId) ?? [];

  const [selectedId, setSelectedId] = useState<ID>();
  const [showDialogue, setShowDialogue] = useState(true);
  const [genOpen, setGenOpen] = useState(false);

  // 展示顺序：卷按 order、卷内章节按 order，"未分卷"排在最后
  const groups = useMemo(() => groupChapters(arcs, chapters), [arcs, chapters]);
  const ordered = useMemo(() => flattenGroups(groups), [groups]);
  const totalWords = useMemo(() => sumWords(chapters), [chapters]);
  const doneCount = useMemo(() => chapters.filter((c) => c.status === "done").length, [chapters]);
  const looseCount = useMemo(() => groups.find((g) => !g.arc)?.chapters.length ?? 0, [groups]);
  const avgWords = chapters.length ? Math.round(totalWords / chapters.length) : 0;

  const selected = useMemo(() => ordered.find((c) => c.id === selectedId), [ordered, selectedId]);
  const selectedIndex = selected ? ordered.indexOf(selected) : 0;

  // 默认选中第一章；章节被删除后自动回落到第一章
  useEffect(() => {
    if (!ordered.length) return;
    if (selectedId && ordered.some((c) => c.id === selectedId)) return;
    setSelectedId(ordered[0].id);
  }, [ordered, selectedId]);

  // 点击曲线数据点后，把左侧对应章节滚进可视区
  useEffect(() => {
    if (!selectedId) return;
    const row = document.querySelector('[data-chapter-row="' + selectedId + '"]');
    row?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  /** 跳转写作页（同时同步全局当前章节） */
  const openChapter = (chapterId: ID) => {
    void useAppStore.getState().openChapter(chapterId);
    navigate(ROUTES.write(projectId, chapterId));
  };

  const manualFirstArc = async () => {
    try {
      await createArc(projectId, "第一卷", { color: arcColor(0) });
      notify("success", "已新建第一卷", "在左侧的卷里继续添加章节");
    } catch (e) {
      notify("danger", "新建卷失败", errorText(e));
    }
  };

  const addChapter = async () => {
    const lastArc = arcs[arcs.length - 1];
    try {
      const created = await createChapter(projectId, { arcId: lastArc?.id });
      setSelectedId(created.id);
      notify("success", "已新建章节", created.title);
    } catch (e) {
      notify("danger", "新建章节失败", errorText(e));
    }
  };

  const isEmpty = arcs.length === 0 && chapters.length === 0;

  return (
    <PageScaffold
      title="大纲"
      description={project ? arcs.length + " 卷 · " + chapters.length + " 章 · " + formatWords(totalWords) : undefined}
      actions={
        <>
          <Button variant="outline" size="sm" isDisabled={!project} onPress={() => void addChapter()}>
            <FilePlus2 className="size-4" />
            新建章节
          </Button>
          <Button variant="primary" size="sm" isDisabled={!project} onPress={() => setGenOpen(true)}>
            <Sparkles className="size-4" />
            AI 生成整卷大纲
          </Button>
        </>
      }
    >
      {!project ? (
        <Loading label="正在打开项目…" />
      ) : isEmpty ? (
        <EmptyHint
          icon={<Layers className="size-8" />}
          title="大纲还是空的"
          description="让 AI 一次生成「卷 → 章」的完整结构，或者先手动建立第一卷，再逐章填写细纲与张力。"
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button variant="primary" onPress={() => setGenOpen(true)}>
                <Sparkles className="size-4" />
                用 AI 生成大纲
              </Button>
              <Button variant="outline" onPress={() => void manualFirstArc()}>
                <Plus className="size-4" />
                手动新建第一卷
              </Button>
            </div>
          }
        />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="总字数"
              value={formatNumber(totalWords)}
              hint="所有章节正文合计"
              icon={<FileText className="size-4" />}
              tone="accent"
            />
            <StatCard
              label="章节数"
              value={formatNumber(chapters.length)}
              hint={"已完成 " + doneCount + " 章"}
              icon={<ListTree className="size-4" />}
            />
            <StatCard
              label="卷数"
              value={formatNumber(arcs.length)}
              hint={looseCount ? "另有 " + looseCount + " 章未分卷" : "章节都已归入卷"}
              icon={<Layers className="size-4" />}
              tone="success"
            />
            <StatCard
              label="平均章字数"
              value={formatWords(avgWords)}
              hint="按现有章节平均"
              icon={<TrendingUp className="size-4" />}
              tone="warning"
            />
          </div>

          <TensionCurve
            chapters={ordered}
            metrics={metrics}
            selectedId={selectedId}
            onSelect={setSelectedId}
            showDialogue={showDialogue}
            onShowDialogueChange={setShowDialogue}
          />

          <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
            <div className="lg:sticky lg:top-0 lg:max-h-[calc(100dvh-2.5rem)] lg:w-[380px] lg:shrink-0 lg:overflow-y-auto">
              <OutlineTree
                projectId={projectId}
                arcs={arcs}
                chapters={ordered}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onOpenChapter={openChapter}
              />
            </div>

            <div className="min-w-0 flex-1">
              {selected ? (
                <ChapterPanel projectId={projectId} chapter={selected} index={selectedIndex} />
              ) : (
                <EmptyHint
                  title="选择一个章节"
                  description="在左侧卷章树里点击任意章节，这里会显示它的细纲、张力与 AI 工具。"
                />
              )}
            </div>
          </div>
        </div>
      )}

      <OutlineGenModal
        projectId={projectId}
        open={genOpen}
        onOpenChange={setGenOpen}
        onWritten={(chapterId) => {
          if (chapterId) setSelectedId(chapterId);
        }}
      />
    </PageScaffold>
  );
}
