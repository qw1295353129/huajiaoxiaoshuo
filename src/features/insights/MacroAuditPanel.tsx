import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Card, Chip } from "@heroui/react";
import { Activity, BarChart3, Compass, Gauge, Layers, Play, Stethoscope, Users } from "lucide-react";
import type { Chapter, ID } from "@/core";
import { macroAudit, type MacroAudit } from "@/ai/analysis";
import { EmptyHint, Loading, SectionTitle, SeverityChip, StatCard } from "@/components/common/ui";
import { ROUTES } from "@/app/routes";
import { useAppStore } from "@/app/store";
import { formatWords } from "@/utils/format";
import { BarChart, MultiLineChart, SERIES_COLORS } from "./charts";
import { fmt1, fmtInt, fmtPct, mean, stdDev, useSettle } from "./helpers";

interface Conclusion {
  tone: "danger" | "warning" | "success" | "info";
  text: string;
}

const TONE_CLASS: Record<Conclusion["tone"], string> = {
  danger: "border-rose-500/30 bg-rose-500/[0.06]",
  warning: "border-amber-500/30 bg-amber-500/[0.06]",
  success: "border-emerald-500/30 bg-emerald-500/[0.06]",
  info: "border-black/10 bg-black/[0.03] dark:border-white/10 dark:bg-white/[0.04]",
};

const THREAD_PROBLEM_LABEL: Record<string, string> = {
  overdue: "逾期未回收",
  stale: "久未回收",
  unplanted: "未标注埋设",
  orphan: "孤立伏笔",
};

/** 找出连续偏低的最长区间（用于张力体检结论） */
function longestLowRun(values: number[], threshold: number): { from: number; to: number } | undefined {
  let best: { from: number; to: number } | undefined;
  let start = -1;
  for (let i = 0; i <= values.length; i++) {
    const low = i < values.length && values[i] < threshold;
    if (low && start < 0) start = i;
    if (!low && start >= 0) {
      const run = { from: start, to: i - 1 };
      if (!best || run.to - run.from > best.to - best.from) best = run;
      start = -1;
    }
  }
  return best && best.to > best.from ? best : undefined;
}

/** 把宏观审计结果翻译成人话 */
function buildConclusions(a: MacroAudit): Conclusion[] {
  const out: Conclusion[] = [];
  if (a.chapterCount === 0) {
    out.push({ tone: "info", text: "还没有章节，先在提纲页建立章节结构。" });
    return out;
  }

  // 字数均衡度
  const words = a.wordSpread.map((w) => w.words);
  const cv = a.avgChapterWords ? stdDev(words) / a.avgChapterWords : 0;
  const longest = a.wordSpread.reduce((m, w) => (w.words > m.words ? w : m), a.wordSpread[0]);
  const shortest = a.wordSpread.reduce((m, w) => (w.words < m.words ? w : m), a.wordSpread[0]);
  if (cv > 0.5) {
    out.push({
      tone: "warning",
      text:
        "字数分布很不均衡（变异系数 " + cv.toFixed(2) + "）：最长《" + longest.title + "》" + fmtInt(longest.words) +
        " 字，最短《" + shortest.title + "》" + fmtInt(shortest.words) + " 字，建议把过长的章节拆分、过短的章节合并或补写。",
    });
  } else if (cv > 0.32) {
    out.push({ tone: "info", text: "字数分布略有起伏（变异系数 " + cv.toFixed(2) + "），整体仍在可接受范围，注意别让关键章过短。" });
  } else {
    out.push({ tone: "success", text: "各章字数相当均衡（变异系数 " + cv.toFixed(2) + "），章长节奏稳定。" });
  }

  // 张力曲线
  const tensions = a.tensionCurve.map((t) => t.tension);
  const avgTension = mean(tensions);
  const lowRun = longestLowRun(tensions, Math.max(0, avgTension * 0.6));
  if (avgTension < 0) {
    out.push({ tone: "warning", text: "全书平均张力 " + fmt1(avgTension) + " 偏低，冲突密度不足，读者容易弃书，建议增加对抗与目标受阻的桥段。" });
  }
  if (lowRun) {
    const from = a.tensionCurve[lowRun.from];
    const to = a.tensionCurve[lowRun.to];
    out.push({
      tone: "danger",
      text:
        "第 " + (from.order + 1) + "~" + (to.order + 1) + " 章张力连续偏低（" + (lowRun.to - lowRun.from + 1) +
        " 章，均值 " + fmt1(avgTension) + "），建议压缩这一段的日常描写，把矛盾提前引爆。",
    });
  } else if (avgTension > 0) {
    const peak = a.tensionCurve.reduce((m, t) => (t.tension > m.tension ? t : m), a.tensionCurve[0]);
    out.push({ tone: "success", text: "张力曲线没有长时间塌陷，峰值出现在第 " + (peak.order + 1) + " 章《" + peak.title + "》（" + fmt1(peak.tension) + "）。" });
  }

  // 对话曲线
  const dialogue = a.dialogueCurve.map((d) => d.dialogueRatio);
  const avgDialogue = mean(dialogue);
  const silent = a.dialogueCurve.filter((d) => d.dialogueRatio < 0.08).map((d) => d.order + 1);
  const chatty = a.dialogueCurve.filter((d) => d.dialogueRatio > 0.65).map((d) => d.order + 1);
  if (silent.length) {
    out.push({
      tone: silent.length > a.chapterCount * 0.4 ? "warning" : "info",
      text: "有 " + silent.length + " 章几乎全是叙述（如第 " + silent.slice(0, 6).join("、") + " 章），画面会显得闷，可以补一点对话或内心独白。",
    });
  }
  if (chatty.length) {
    out.push({ tone: "info", text: "有 " + chatty.length + " 章对话占比超过 65%（如第 " + chatty.slice(0, 6).join("、") + " 章），注意穿插动作与环境，避免变成广播剧。" });
  }
  if (!silent.length && !chatty.length) {
    out.push({ tone: "success", text: "对话占比均值 " + fmtPct(avgDialogue, 1) + "，各章波动不大。" });
  }

  // 伏笔
  const overdue = a.threadProblems.filter((t) => t.problem === "overdue");
  const others = a.threadProblems.filter((t) => t.problem !== "overdue");
  if (overdue.length) {
    out.push({ tone: "danger", text: "有 " + overdue.length + " 条伏笔已经逾期未回收（" + overdue.slice(0, 4).map((t) => t.title).join("、") + "），读者会认为你忘了。" });
  }
  if (others.length) {
    out.push({ tone: "warning", text: "另有 " + others.length + " 条伏笔存在风险（" + others.slice(0, 4).map((t) => t.title).join("、") + "），建议排进后续章节。" });
  }
  if (!a.threadProblems.length) {
    out.push({ tone: "success", text: "伏笔健康度良好，没有逾期或长期未回收的线索。" });
  }

  // 人物久未出场
  if (a.staleCharacters.length) {
    out.push({
      tone: "warning",
      text: "有 " + a.staleCharacters.length + " 位主要人物长期未出场（" + a.staleCharacters.slice(0, 4).map((c) => c.name).join("、") + "），读者可能会忘记他们。",
    });
  }

  // 问题计数
  const serious = a.issueCounts.blocker + a.issueCounts.error;
  if (serious > 0) {
    out.push({ tone: "danger", text: "问题库中还有 " + serious + " 条严重问题（阻断 " + a.issueCounts.blocker + " / 严重 " + a.issueCounts.error + "）待处理。" });
  } else if (a.issueCounts.warn + a.issueCounts.info > 0) {
    out.push({ tone: "info", text: "问题库还有 " + (a.issueCounts.warn + a.issueCounts.info) + " 条提示级问题，可择期处理。" });
  } else {
    out.push({ tone: "success", text: "问题库里没有未处理的记录，保持住。" });
  }

  return out;
}

/** 宏观审计：全书体检结论 + 字数/张力/对话曲线 + 伏笔与人物风险 */
export function MacroAuditPanel({ projectId, chapters }: { projectId: ID; chapters: Chapter[] }) {
  const navigate = useNavigate();
  const notify = useAppStore((s) => s.notify);
  const settled = useSettle();
  const [audit, setAudit] = useState<MacroAudit | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async () => {
    setBusy(true);
    try {
      const result = await macroAudit(projectId);
      setAudit(result);
      notify("success", "宏观审计完成", "共 " + result.chapterCount + " 章 / " + formatWords(result.totalWords));
    } catch (e) {
      notify("danger", "宏观审计失败", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [projectId, notify]);

  const conclusions = useMemo(() => (audit ? buildConclusions(audit) : []), [audit]);

  const titleByOrder = useMemo(() => {
    const map = new Map<number, string>();
    for (const c of chapters) map.set(c.order, c.title);
    return map;
  }, [chapters]);

  if (!settled) return <Loading label="正在准备宏观审计…" />;

  if (!chapters.length) {
    return (
      <EmptyHint
        icon={<Stethoscope className="size-7" />}
        title="还没有章节"
        description="宏观审计需要至少一章内容：它会检查字数分布、张力曲线、对话曲线、伏笔回收与人物出场间隔。"
        action={
          <Button variant="primary" size="sm" onPress={() => navigate(ROUTES.outline(projectId))}>
            去大纲页
          </Button>
        }
      />
    );
  }

  if (!audit) {
    return (
      <EmptyHint
        icon={<Stethoscope className="size-7" />}
        title="运行一次宏观审计"
        description="完全离线（不消耗 token）：汇总全书字数分布、张力与对话曲线，检查伏笔回收与长期未出场人物，并给出文字化的体检结论。"
        action={
          <Button variant="primary" size="sm" isDisabled={busy} isPending={busy} onPress={() => void run()}>
            <Play className="size-4" />
            运行宏观审计
          </Button>
        }
      />
    );
  }

  const tensionSeries = [
    {
      key: "tension",
      label: "张力",
      color: SERIES_COLORS.rose,
      values: audit.tensionCurve.map((t) => t.tension),
      format: (v: number) => fmt1(v),
    },
  ];
  const dialogueSeries = [
    {
      key: "dialogue",
      label: "对话占比",
      color: SERIES_COLORS.emerald,
      values: audit.dialogueCurve.map((d) => d.dialogueRatio * 100),
      format: (v: number) => fmt1(v) + "%",
    },
  ];
  const chapterLabels = audit.tensionCurve.map((t) => t.title);
  const chapterIdByOrder = new Map(chapters.map((c) => [c.order, c.id]));

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="全书字数" value={formatWords(audit.totalWords)} hint={audit.chapterCount + " 章"} icon={<Layers className="size-4" />} tone="accent" />
        <StatCard label="章均字数" value={fmtInt(audit.avgChapterWords) + " 字"} hint="与项目目标章长对比" icon={<BarChart3 className="size-4" />} />
        <StatCard
          label="张力峰值"
          value={fmt1(Math.max(...audit.tensionCurve.map((t) => t.tension), 0))}
          hint={"均值 " + fmt1(mean(audit.tensionCurve.map((t) => t.tension)))}
          icon={<Activity className="size-4" />}
          tone="danger"
        />
        <StatCard
          label="未解决问题"
          value={fmtInt(audit.issueCounts.blocker + audit.issueCounts.error + audit.issueCounts.warn + audit.issueCounts.info)}
          hint={"阻断 " + audit.issueCounts.blocker + " · 严重 " + audit.issueCounts.error}
          icon={<Gauge className="size-4" />}
          tone={audit.issueCounts.blocker > 0 ? "danger" : "warning"}
        />
      </div>

      <Card className="p-4">
        <SectionTitle
          hint="按章节顺序阅读，异常区间会被单独点名"
          action={
            <Button variant="outline" size="sm" isDisabled={busy} isPending={busy} onPress={() => void run()}>
              <Play className="size-4" />
              重新审计
            </Button>
          }
        >
          体检结论
        </SectionTitle>
        <ul className="space-y-2">
          {conclusions.map((c, i) => (
            <li key={i} className={"rounded-xl border px-3 py-2 text-xs leading-relaxed " + TONE_CLASS[c.tone]}>
              {c.text}
            </li>
          ))}
        </ul>
      </Card>

      <Card className="p-4">
        <SectionTitle hint="虚线为章均字数，点击柱子跳到该章">字数分布</SectionTitle>
        <BarChart
          data={audit.wordSpread.map((w) => ({
            label: "第" + (w.order + 1) + "章",
            value: w.words,
            tip: "第" + (w.order + 1) + "章 " + w.title + " · " + fmtInt(w.words) + " 字",
          }))}
          avgLine={audit.avgChapterWords}
          height={180}
          onPick={(i) => {
            const row = audit.wordSpread[i];
            const id = row ? chapterIdByOrder.get(row.order) : undefined;
            if (id) navigate(ROUTES.write(projectId, id));
          }}
          caption={"章均 " + fmtInt(audit.avgChapterWords) + " 字"}
        />
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-4">
          <SectionTitle hint="冲突词密度 + 短句比例 + 对话占比的估算值">张力曲线</SectionTitle>
          <MultiLineChart
            series={tensionSeries}
            labels={chapterLabels}
            height={220}
            onPick={(i) => {
              const t = audit.tensionCurve[i];
              const id = t ? chapterIdByOrder.get(t.order) : undefined;
              if (id) navigate(ROUTES.write(projectId, id));
            }}
          />
        </Card>
        <Card className="p-4">
          <SectionTitle hint="对话段占段落总数的比例">对话曲线</SectionTitle>
          <MultiLineChart
            series={dialogueSeries}
            labels={chapterLabels}
            height={220}
            onPick={(i) => {
              const d = audit.dialogueCurve[i];
              const id = d ? chapterIdByOrder.get(d.order) : undefined;
              if (id) navigate(ROUTES.write(projectId, id));
            }}
          />
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-4">
          <SectionTitle hint={audit.threadProblems.length + " 条风险"}>伏笔问题</SectionTitle>
          {audit.threadProblems.length === 0 ? (
            <EmptyHint title="伏笔状态良好" description="没有逾期未回收、久未回收或未标注埋设的伏笔。" />
          ) : (
            <ul className="space-y-2">
              {audit.threadProblems.map((t, i) => (
                <li key={i} className="rounded-lg border border-black/5 px-3 py-2 text-xs dark:border-white/5">
                  <div className="flex items-center gap-2">
                    <Chip size="sm" color={t.problem === "overdue" ? "danger" : "warning"}>
                      {THREAD_PROBLEM_LABEL[t.problem] ?? t.problem}
                    </Chip>
                    <span className="truncate font-medium">{t.title}</span>
                  </div>
                  <p className="mt-1 opacity-60">{t.detail}</p>
                </li>
              ))}
            </ul>
          )}
          <Button className="mt-3" variant="ghost" size="sm" onPress={() => navigate(ROUTES.threads(projectId))}>
            <Compass className="size-4" />
            去伏笔页处理
          </Button>
        </Card>

        <Card className="p-4">
          <SectionTitle hint="超过 12 章未出场的主要人物">久未出场的人物</SectionTitle>
          {audit.staleCharacters.length === 0 ? (
            <EmptyHint title="人物出场节奏正常" description="没有主要角色长时间消失（需要章节标注出场人物后才会统计）。" />
          ) : (
            <ul className="space-y-1.5">
              {audit.staleCharacters.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 rounded-lg border border-black/5 px-3 py-2 text-xs dark:border-white/5">
                  <span className="truncate">{c.name}</span>
                  <span className="shrink-0 opacity-60">{c.lastOrder < 0 ? "从未出场" : "上次出场 第" + (c.lastOrder + 1) + " 章 · 已隔 " + c.gap + " 章"}</span>
                </li>
              ))}
            </ul>
          )}
          <Button className="mt-3" variant="ghost" size="sm" onPress={() => navigate(ROUTES.characters(projectId))}>
            <Users className="size-4" />
            去人物页查看
          </Button>
        </Card>
      </div>

      <Card className="p-4">
        <SectionTitle hint="问题库按来源与严重度统计（含已忽略）">问题计数</SectionTitle>
        <div className="flex flex-wrap items-center gap-3">
          {(["blocker", "error", "warn", "info"] as const).map((s) => (
            <span key={s} className="flex items-center gap-2 text-xs">
              <SeverityChip severity={s} />
              <span className="tabular">{audit.issueCounts[s]}</span>
            </span>
          ))}
          <Button className="ml-auto" variant="outline" size="sm" onPress={() => navigate(ROUTES.consistency(projectId))}>
            去一致性报告页
          </Button>
        </div>
        <p className="mt-3 text-[11px] opacity-45">标题中的第 N 章按章节顺序计算；张力与对话来自章节指标，若指标缺失会回退到章节上缓存的张力值。</p>
      </Card>
    </div>
  );
}
