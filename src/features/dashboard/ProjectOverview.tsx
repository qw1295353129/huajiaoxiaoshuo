import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Card, Chip, Tooltip } from "@heroui/react";
import {
  AlertTriangle, ArrowRight, BookOpen, Feather, FileText, GitBranch, Gauge,
  Layers, Plus, ScrollText, Sparkles, Users, Wand2,
} from "lucide-react";
import type { Project } from "@/core";
import { ROUTES } from "@/app/routes";
import { useArcs, useAsync, useChapters, useCharacters, useIssues, useMetrics, useThreads } from "@/app/hooks";
import { getGoal, recomputeProjectStats } from "@/db/repo/projects";
import { dailyWordCounts } from "@/db/repo/writing";
import { auditThreads } from "@/db/repo/story";
import { formatRelative, formatWords, pct, todayKey } from "@/utils/format";
import { SectionTitle, StatCard } from "@/components/common/ui";
import { CHAPTER_STATUS_LABEL } from "@/app/theme";

/**
 * 项目总览：把「这本书现在什么情况、下一步该干什么」一屏说清。
 * 数据全部来自现有仓储层与 hooks，不额外增加计算负担。
 */
export function ProjectOverview({ project }: { project: Project }) {
  const navigate = useNavigate();
  const { projectId = project.id } = useParams<{ projectId: string }>();
  void projectId;
  const chapters = useChapters(project.id);
  const arcs = useArcs(project.id);
  const characters = useCharacters(project.id);
  const threads = useThreads(project.id);
  const metrics = useMetrics(project.id);
  const issues = useIssues(project.id, "open");

  // 注意：useAsync 返回对象（不是元组），按名取值
  const goal = useAsync(() => getGoal(project.id), [project.id], undefined).value;
  const daily = useAsync(() => dailyWordCounts(project.id, 30), [project.id], {} as Record<string, number>).value;
  const threadProblems = useAsync(
    () => auditThreads(project.id),
    [project.id],
    [] as Awaited<ReturnType<typeof auditThreads>>,
  ).value;

  // 打开总览时顺手刷新一次统计，保证字数/章节数是最新的
  useEffect(() => {
    void recomputeProjectStats(project.id);
  }, [project.id]);

  const stats = project.stats;

  // 时间基准只在挂载时取一次，避免渲染期间调用 impure 函数（也不该每次渲染都变）
  const [now] = useState(() => Date.now());

  const writing = useMemo(() => {
    const kept = chapters.filter((c) => c.status !== "cut");
    const done = kept.filter((c) => c.status === "done" || c.status === "drafted").length;
    const today = daily[todayKey()] ?? 0;
    const last7 = Object.entries(daily)
      .filter(([k]) => now - new Date(k).getTime() < 7 * 86400_000)
      .reduce((n, entry) => n + (entry[1] as number), 0);
    return { kept, done, today, last7 };
  }, [chapters, daily, now]);

  const nextChapter = useMemo(() => {
    const ordered = [...writing.kept].sort((a, b) => a.order - b.order);
    return ordered.find((c) => c.status === "drafting") ?? ordered.find((c) => c.wordCount === 0) ?? ordered[ordered.length - 1];
  }, [writing.kept]);

  const blockers = issues.filter((i) => i.severity === "blocker" || i.severity === "error").length;
  const avgWords = writing.kept.length ? Math.round(stats.words / writing.kept.length) : 0;
  const target = project.targetWords || 1;
  const dailyTarget = goal?.dailyWords ?? 2000;
  const todayPct = pct(writing.today, dailyTarget);

  const cards = [
    { label: "章节", value: String(writing.kept.length), hint: writing.done + " 章已成稿", icon: <Layers className="size-4" />, tone: "default" as const },
    { label: "总字数", value: formatWords(stats.words), hint: "目标 " + formatWords(target), icon: <Feather className="size-4" />, tone: "accent" as const },
    { label: "人物", value: String(characters.length), hint: characters.filter((c) => c.role === "protagonist" || c.role === "antagonist").length + " 位主要角色", icon: <Users className="size-4" />, tone: "default" as const },
    { label: "伏笔", value: String(threads.filter((t) => t.status !== "resolved" && t.status !== "abandoned").length), hint: threadProblems.length ? threadProblems.length + " 条有风险" : "状态健康", icon: <GitBranch className="size-4" />, tone: threadProblems.length ? ("warning" as const) : ("success" as const) },
  ];

  const bars = useMemo(() => {
    const out: { key: string; words: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now - i * 86400_000);
      const k = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
      out.push({ key: k, words: daily[k] ?? 0 });
    }
    return out;
  }, [daily, now]);
  const maxBar = Math.max(1, ...bars.map((b) => b.words));

  const statusRows = Object.entries(
    writing.kept.reduce<Record<string, number>>((acc, c) => {
      acc[c.status] = (acc[c.status] ?? 0) + 1;
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);

  const todos: { key: string; icon: React.ReactNode; title: string; hint?: string; action: string; to: string }[] = [];
  if (nextChapter) {
    todos.push({
      key: "next",
      icon: <Feather className="size-4" />,
      title: "继续写「" + nextChapter.title + "」",
      hint: "第 " + (nextChapter.order + 1) + " 章 · 当前 " + formatWords(nextChapter.wordCount) + " · " + (CHAPTER_STATUS_LABEL[nextChapter.status] ?? nextChapter.status),
      action: "去写",
      to: ROUTES.write(project.id, nextChapter.id),
    });
  } else {
    todos.push({
      key: "genesis",
      icon: <Wand2 className="size-4" />,
      title: "用「一句话成书」搭出整本书",
      hint: "给出灵感，自动生成人物、世界观、分卷结构与章节大纲",
      action: "开始",
      to: ROUTES.genesis(project.id),
    });
  }
  if (blockers > 0) {
    todos.push({ key: "issues", icon: <AlertTriangle className="size-4" />, title: "处理 " + blockers + " 个严重一致性问题", hint: "前后矛盾、设定冲突这类问题越拖越难改", action: "去处理", to: ROUTES.consistency(project.id) });
  }
  if (threadProblems.length > 0) {
    todos.push({ key: "threads", icon: <GitBranch className="size-4" />, title: threadProblems.length + " 条伏笔需要关注", hint: threadProblems[0].detail, action: "去查看", to: ROUTES.threads(project.id) });
  }
  if (characters.length === 0) {
    todos.push({ key: "chars", icon: <Users className="size-4" />, title: "建立人物卡", hint: "人物卡会进入每次 AI 生成的上下文，是写得像的前提", action: "去建立", to: ROUTES.characters(project.id) });
  }
  if (arcs.length === 0 && writing.kept.length > 0) {
    todos.push({ key: "arcs", icon: <Layers className="size-4" />, title: "给章节分卷", hint: "分卷后大纲与节奏曲线才好读", action: "去分卷", to: ROUTES.outline(project.id) });
  }
  todos.push({ key: "insights", icon: <Gauge className="size-4" />, title: "看一眼写作分析", hint: "字数趋势、文风指纹、AI 味体检、宏观节奏", action: "查看", to: ROUTES.insights(project.id) });

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{project.title}</h1>
            {project.genres.map((g) => (
              <Chip key={g} size="sm">
                {g}
              </Chip>
            ))}
          </div>
          {project.logline && <p className="mt-2 max-w-2xl text-sm leading-relaxed opacity-65">{project.logline}</p>}
          <p className="mt-1.5 text-[11px] opacity-45">
            更新于 {formatRelative(project.updatedAt)}
            {stats.startedAt ? " · 已写 " + stats.writingDays + " 天" : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onPress={() => navigate(ROUTES.write(project.id, nextChapter?.id))}>
            <Feather className="size-4" />
            {stats.words > 0 ? "继续写作" : "开始写第一章"}
          </Button>
          <Button variant="outline" onPress={() => navigate(ROUTES.ai(project.id))}>
            <Sparkles className="size-4" />
            AI 工作室
          </Button>
        </div>
      </div>

      <Card className="mb-5 p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs opacity-55">全书进度</p>
            <p className="tabular mt-1 text-3xl font-semibold tracking-tight">{pct(stats.words, target).toFixed(1)}%</p>
          </div>
          <div className="text-right text-xs opacity-60">
            <p className="tabular">
              {formatWords(stats.words)} / {formatWords(target)}
            </p>
            <p className="mt-0.5">还差 {formatWords(Math.max(0, target - stats.words))}</p>
          </div>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-black/[0.07] dark:bg-white/10">
          <div className="h-full rounded-full bg-violet-500 transition-all" style={{ width: pct(stats.words, target) + "%" }} />
        </div>

        <div className="mt-4 grid gap-3 border-t border-black/5 pt-4 sm:grid-cols-3 dark:border-white/5">
          <div>
            <p className="text-[11px] opacity-55">今日进度</p>
            <p className="tabular mt-0.5 text-lg font-medium">
              {formatWords(writing.today)}
              <span className="ml-1 text-xs font-normal opacity-50">/ {formatWords(dailyTarget)}</span>
            </p>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-black/[0.07] dark:bg-white/10">
              <div className={(todayPct >= 100 ? "bg-emerald-500" : "bg-amber-500") + " h-full rounded-full"} style={{ width: todayPct + "%" }} />
            </div>
          </div>
          <div>
            <p className="text-[11px] opacity-55">近 7 天</p>
            <p className="tabular mt-0.5 text-lg font-medium">{formatWords(writing.last7)}</p>
            <p className="mt-1 text-[11px] opacity-45">平均每天 {formatWords(Math.round(writing.last7 / 7))}</p>
          </div>
          <div>
            <p className="text-[11px] opacity-55">平均章长</p>
            <p className="tabular mt-0.5 text-lg font-medium">{formatWords(avgWords)}</p>
            <p className="mt-1 text-[11px] opacity-45">
              {avgWords >= (project.targetChapterWords || 3000) * 0.8 ? "长度合适" : "偏短，可再充实"}
            </p>
          </div>
        </div>
      </Card>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((d) => (
          <StatCard key={d.label} label={d.label} value={d.value} hint={d.hint} icon={d.icon} tone={d.tone} />
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div>
          <SectionTitle hint="按当前状态排出的优先事项">接下来</SectionTitle>
          <Card className="divide-y divide-black/5 p-0 dark:divide-white/5">
            {todos.map((t) => (
              <div key={t.key} className="flex items-center gap-3 px-4 py-3">
                <span className="text-violet-500">{t.icon}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{t.title}</p>
                  {t.hint && <p className="mt-0.5 truncate text-[11px] opacity-55">{t.hint}</p>}
                </div>
                <Button size="sm" variant="ghost" onPress={() => navigate(t.to)}>
                  {t.action}
                  <ArrowRight className="size-3.5" />
                </Button>
              </div>
            ))}
          </Card>
        </div>

        <div className="space-y-5">
          <div>
            <SectionTitle hint="近 30 天每日新增字数">写作节奏</SectionTitle>
            <Card className="p-4">
              <div className="flex h-20 items-end gap-[3px]">
                {bars.map((b) => (
                  <Tooltip key={b.key}>
                    <Tooltip.Trigger>
                      <div
                        className={(b.words > 0 ? "bg-violet-500/70" : "bg-black/[0.06] dark:bg-white/10") + " flex-1 rounded-sm"}
                        style={{ height: Math.max(3, (b.words / maxBar) * 100) + "%" }}
                      />
                    </Tooltip.Trigger>
                    <Tooltip.Content>
                      {b.key.slice(5)} · {formatWords(b.words)}
                    </Tooltip.Content>
                  </Tooltip>
                ))}
              </div>
              <div className="mt-2 flex justify-between text-[10px] opacity-40">
                <span>30 天前</span>
                <span>今天</span>
              </div>
            </Card>
          </div>

          <div>
            <SectionTitle hint="章节状态分布">结构</SectionTitle>
            <Card className="space-y-2 p-4">
              {statusRows.map(([status, count]) => (
                <div key={status} className="flex items-center gap-2 text-xs">
                  <span className="w-14 shrink-0 opacity-60">{CHAPTER_STATUS_LABEL[status] ?? status}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/[0.07] dark:bg-white/10">
                    <div className="h-full rounded-full bg-violet-500/70" style={{ width: pct(count, writing.kept.length) + "%" }} />
                  </div>
                  <span className="tabular w-8 text-right opacity-60">{count}</span>
                </div>
              ))}
              {writing.kept.length === 0 && <p className="py-2 text-xs opacity-50">还没有章节</p>}
              <div className="flex items-center justify-between border-t border-black/5 pt-2 text-[11px] opacity-50 dark:border-white/5">
                <span>共 {arcs.length} 卷 · {metrics.length} 章有指标</span>
                <span>{issues.length} 个待处理问题</span>
              </div>
            </Card>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" onPress={() => navigate(ROUTES.outline(project.id))}>
              <Layers className="size-3.5" /> 大纲
            </Button>
            <Button size="sm" variant="ghost" onPress={() => navigate(ROUTES.characters(project.id))}>
              <Users className="size-3.5" /> 人物
            </Button>
            <Button size="sm" variant="ghost" onPress={() => navigate(ROUTES.threads(project.id))}>
              <GitBranch className="size-3.5" /> 伏笔
            </Button>
            <Button size="sm" variant="ghost" onPress={() => navigate(ROUTES.consistency(project.id))}>
              <ScrollText className="size-3.5" /> 一致性
            </Button>
            <Button size="sm" variant="ghost" onPress={() => navigate(ROUTES.data(project.id))}>
              <FileText className="size-3.5" /> 导出
            </Button>
          </div>
        </div>
      </div>

      {stats.words === 0 && (
        <Card className="mt-6 p-6 text-center">
          <BookOpen className="mx-auto mb-3 size-7 opacity-20" />
          <p className="text-sm font-medium">这本书还是一张白纸</p>
          <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed opacity-60">
            最省事的起步方式是「一句话成书」：写一句灵感，它会生成书名、高概念、人物、世界观、分卷结构与章节大纲，并直接写进这个项目。
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <Button variant="primary" onPress={() => navigate(ROUTES.genesis(project.id))}>
              <Wand2 className="size-4" /> 一句话成书
            </Button>
            <Button variant="outline" onPress={() => navigate(ROUTES.write(project.id))}>
              <Plus className="size-4" /> 直接开始写
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}