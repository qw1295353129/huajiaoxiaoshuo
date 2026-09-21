import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { Button, Card, Chip } from "@heroui/react";
import { ArrowRight, Check, ClipboardList, LayoutList } from "lucide-react";
import type { GenesisConstraints, GenesisRun } from "@/core";
import { PageScaffold } from "@/components/common/PageScaffold";
import { SectionTitle } from "@/components/common/ui";
import { useInterval } from "@/app/hooks";
import { useAppStore } from "@/app/store";
import { ROUTES } from "@/app/routes";
import { listGenesisRuns } from "@/db/repo/genesis";
import { getProvider, listProviders, resolveModel } from "@/db/repo/settings";
import { applyGenesis, runGenesis, type ApplyGenesisResult } from "@/ai/genesis";
import { GenesisForm, type UntilStage } from "./GenesisForm";
import { GenesisPreview } from "./GenesisPreview";
import { GenesisHistory } from "./GenesisHistory";
import { StageStepper } from "./StageStepper";
import {
  ALL_PARTS,
  PART_KEYS,
  PART_LABELS,
  PIPELINE,
  RUN_STATUS_META,
  bibleOf,
  filterRun,
  type PartKey,
} from "./helpers";

/** 一句话成书：从一句灵感跑完五个阶段，生成可落库的故事圣经 */
export function GenesisPage() {
  const { projectId = "" } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const project = useAppStore((s) => s.project);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const notify = useAppStore((s) => s.notify);

  const settings = useAppStore((s) => s.settings);
  const providersRaw = useLiveQuery(() => listProviders(), [], undefined);

  // 真正会被调用的模型：走任务路由 > 全局默认，和 runner 的判断保持一致
  const [modelReady, setModelReady] = useState(false);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const resolved = await resolveModel("genesis");
      if (!alive) return;
      if (!resolved.providerId || !resolved.model) {
        setModelReady(false);
        return;
      }
      const provider = await getProvider(resolved.providerId);
      if (!alive) return;
      setModelReady(Boolean(provider?.enabled));
    })();
    return () => {
      alive = false;
    };
  }, [providersRaw, settings.activeProviderId, settings.activeModel]);

  const [seed, setSeed] = useState("");
  const [constraints, setConstraints] = useState<GenesisConstraints>({
    genres: [],
    lengthClass: "novel",
    pov: "third-limited",
    toneKeywords: [],
    references: [],
    avoid: [],
  });
  const [chaptersPerVolume, setChaptersPerVolume] = useState(12);
  const [until, setUntil] = useState<UntilStage>("outline");

  const [run, setRun] = useState<GenesisRun>();
  const [history, setHistory] = useState<GenesisRun[]>([]);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<ApplyGenesisResult>();
  const [durations, setDurations] = useState<Record<string, number>>({});
  const [parts, setParts] = useState<Record<PartKey, boolean>>({ ...ALL_PARTS });
  const [replaceChapters, setReplaceChapters] = useState(false);
  const [selectedChars, setSelectedChars] = useState<Set<number>>(new Set());
  const [selectedWorld, setSelectedWorld] = useState<Set<number>>(new Set());

  const abortRef = useRef<AbortController | null>(null);
  const pollRef = useRef<{ startedAt: number } | null>(null);
  const timingsRef = useRef<Record<string, number>>({});
  const seededRef = useRef<string | undefined>(undefined);

  // 用项目现有信息预填表单（只填一次）
  useEffect(() => {
    if (!project || seededRef.current === project.id) return;
    seededRef.current = project.id;
    setSeed(project.logline ?? "");
    setConstraints({
      genres: project.genres.slice(0, 3),
      lengthClass: project.lengthClass,
      toneKeywords: project.themes.slice(0, 4),
      pov: project.pov,
      references: [],
      avoid: project.forbidden.slice(0, 4),
    });
  }, [project]);

  const bible = bibleOf(run);
  const charCount = bible?.characters?.length ?? 0;
  const worldCount = bible?.world?.length ?? 0;

  // 切换产物时默认全选
  useEffect(() => {
    setSelectedChars(new Set(Array.from({ length: charCount }, (_, i) => i)));
    setSelectedWorld(new Set(Array.from({ length: worldCount }, (_, i) => i)));
  }, [run?.id, charCount, worldCount]);

  // 轮询正在生成的 run，拿到实时阶段状态
  const tick = async () => {
    const list = await listGenesisRuns(projectId);
    setHistory(list);
    const started = pollRef.current;
    if (!started) return;
    const live = list.find((r) => new Date(r.createdAt).getTime() >= started.startedAt - 3000);
    if (live) setRun(live);
  };

  useInterval(() => {
    void tick();
  }, busy ? 900 : null);

  useInterval(() => setElapsed((v) => v + 1), busy ? 1000 : null);

  // 记录每个阶段耗时（引擎只在结束时落库，不写 ms）
  useEffect(() => {
    if (!run) return;
    const next: Record<string, number> = {};
    for (const stage of run.stages) {
      if (stage.status === "running" && timingsRef.current[stage.kind] === undefined) {
        timingsRef.current[stage.kind] = Date.now();
      }
      const start = timingsRef.current[stage.kind];
      if (start !== undefined && (stage.status === "done" || stage.status === "failed")) {
        if (durations[stage.kind] === undefined) next[stage.kind] = Date.now() - start;
      }
    }
    if (Object.keys(next).length) setDurations((prev) => ({ ...prev, ...next }));
  }, [run, durations]);

  async function start() {
    if (!seed.trim() || busy) return;
    setBusy(true);
    setElapsed(0);
    setApplyResult(undefined);
    setDurations({});
    setRun(undefined);
    timingsRef.current = {};
    pollRef.current = { startedAt: Date.now() };
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const result = await runGenesis({
        projectId,
        seed: seed.trim(),
        constraints,
        chaptersPerVolume,
        until,
        signal: controller.signal,
        // 阶段状态一变就立刻刷新 UI
        onStage: () => {
          void tick();
        },
      });
      setRun(result);
      const list = await listGenesisRuns(projectId);
      setHistory(list);
      if (result.status === "failed") {
        notify("danger", "生成中断", result.error ?? "有阶段失败了，可以重试，也可以先应用已完成的部分");
      } else {
        notify("success", "故事圣经生成完成", "检查产物，勾选后写入项目");
      }
    } catch (e) {
      notify("danger", "生成失败", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      pollRef.current = null;
      abortRef.current = null;
    }
  }

  function cancel() {
    abortRef.current?.abort();
    notify("info", "已请求取消", "当前阶段会在得到响应后中断，已完成的部分会保留");
  }

  async function doApply(target: GenesisRun, all: boolean) {
    setApplying(true);
    try {
      const source = all ? target : filterRun(target, selectedChars, selectedWorld);
      const activeParts = all ? PART_KEYS : PART_KEYS.filter((key) => parts[key]);
      const result = await applyGenesis(projectId, source, {
        parts: activeParts,
        replaceChapters: all ? false : replaceChapters,
      });
      setApplyResult(result);
      notify(
        "success",
        "已写入项目",
        "人物 " + result.characters + " · 世界观 " + result.worldEntries + " · 规则 " + result.rules +
          " · 卷 " + result.arcs + " · 章节 " + result.chapters,
      );
      const list = await listGenesisRuns(projectId);
      setHistory(list);
      const updated = list.find((r) => r.id === target.id);
      if (updated) setRun(updated);
    } catch (e) {
      notify("danger", "落库失败", e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  }

  function togglePart(key: PartKey) {
    setParts((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function toggleIndex(setter: (fn: (prev: Set<number>) => Set<number>) => void, index: number) {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  const stageList = run?.stages?.length
    ? run.stages
    : busy
      ? PIPELINE.map((kind, index) => ({
          kind,
          status: index === 0 ? ("running" as const) : ("pending" as const),
        }))
      : [];

  const hasProduct = Boolean(run && run.stages.some((s) => s.data));
  const statusMeta = run ? RUN_STATUS_META[run.status] : undefined;
  const selectedParts = PART_KEYS.filter((key) => parts[key]).length;

  return (
    <PageScaffold
      title="一句话成书"
      description={project ? project.title + " · 写一句灵感，长出人物、世界观与分卷结构" : "五阶段生成故事圣经"}
      actions={statusMeta ? <Chip color={statusMeta.color}>{statusMeta.label}</Chip> : undefined}
    >
      <div className="mx-auto max-w-5xl space-y-5 pb-12">
        <GenesisForm
          seed={seed}
          onSeedChange={setSeed}
          constraints={constraints}
          onConstraintsChange={(patch) => setConstraints((prev) => ({ ...prev, ...patch }))}
          chaptersPerVolume={chaptersPerVolume}
          onChaptersPerVolumeChange={setChaptersPerVolume}
          until={until}
          onUntilChange={setUntil}
          modelReady={modelReady}
          onOpenSettings={() => setSettingsOpen(true)}
          busy={busy}
          onStart={() => void start()}
          onCancel={cancel}
        />

        {stageList.length > 0 && (
          <StageStepper stages={stageList} durations={durations} busy={busy} elapsed={elapsed} />
        )}

        {run && hasProduct && (
          <Card className="p-4">
            <SectionTitle hint="勾选要写进项目的部分；人物与世界观还可以逐条挑选">
              写入项目
            </SectionTitle>

            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {PART_KEYS.map((key) => (
                <label key={key} className="inline-flex cursor-pointer items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={parts[key]}
                    onChange={() => togglePart(key)}
                    className="accent-violet-500"
                  />
                  {PART_LABELS[key]}
                </label>
              ))}
            </div>

            <label className="mt-3 flex cursor-pointer items-start gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={replaceChapters}
                onChange={(e) => setReplaceChapters(e.target.checked)}
                className="mt-0.5 accent-rose-500"
              />
              <span className={replaceChapters ? "text-rose-500" : "opacity-70"}>
                覆盖已有章节（会先删除当前项目的全部章节与正文，只建议在空项目里使用）
              </span>
            </label>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button
                variant="primary"
                isPending={applying}
                isDisabled={applying || selectedParts === 0}
                onPress={() => run && void doApply(run, false)}
              >
                <Check className="size-4" />
                仅应用勾选的部分
              </Button>
              <span className="text-[11px] opacity-50">
                已勾选 {selectedParts} 个板块 · 人物 {selectedChars.size}/{charCount} · 世界观 {selectedWorld.size}/
                {worldCount}
              </span>
            </div>

            {applyResult && (
              <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.06] p-3">
                <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">落库完成</p>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[11px] opacity-75">
                  <span className="tabular">人物 {applyResult.characters}</span>
                  <span className="tabular">世界观 {applyResult.worldEntries}</span>
                  <span className="tabular">硬规则 {applyResult.rules}</span>
                  <span className="tabular">分卷 {applyResult.arcs}</span>
                  <span className="tabular">章节 {applyResult.chapters}</span>
                  <span className="tabular">开篇 {applyResult.openingWords} 字</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onPress={() => navigate(ROUTES.overview(projectId))}>
                    <LayoutList className="size-3.5" />
                    去看总览
                  </Button>
                  <Button size="sm" variant="outline" onPress={() => navigate(ROUTES.outline(projectId))}>
                    <ClipboardList className="size-3.5" />
                    去大纲页
                    <ArrowRight className="size-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" onPress={() => navigate(ROUTES.characters(projectId))}>
                    查看人物卡
                  </Button>
                </div>
              </div>
            )}
          </Card>
        )}

        {run && hasProduct && (
          <GenesisPreview
            run={run}
            selectedChars={selectedChars}
            selectedWorld={selectedWorld}
            onToggleChar={(index) => toggleIndex(setSelectedChars, index)}
            onToggleWorld={(index) => toggleIndex(setSelectedWorld, index)}
            onSetAllChars={(checked) =>
              setSelectedChars(new Set(checked ? Array.from({ length: charCount }, (_, i) => i) : []))
            }
            onSetAllWorld={(checked) =>
              setSelectedWorld(new Set(checked ? Array.from({ length: worldCount }, (_, i) => i) : []))
            }
          />
        )}

        <GenesisHistory
          runs={history}
          currentId={run?.id}
          busy={busy || applying}
          onView={(target) => {
            setRun(target);
            setApplyResult(undefined);
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
          onApply={(target) => void doApply(target, true)}
        />
      </div>
    </PageScaffold>
  );
}
