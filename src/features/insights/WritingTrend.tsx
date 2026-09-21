import { useMemo } from "react";
import { Button, Card } from "@heroui/react";
import { CalendarCheck, Clock, Flame, Gauge, RefreshCw, Timer } from "lucide-react";
import type { Chapter, ID, PomodoroRecord, WritingSession } from "@/core";
import { useAsync } from "@/app/hooks";
import { dailyWordCounts, heatmap, listPomodoros, listSessions, writingSpeed } from "@/db/repo/writing";
import { EmptyHint, Loading, SectionTitle, StatCard } from "@/components/common/ui";
import { dayKey, formatRelative, formatWords } from "@/utils/format";
import { BarChart, WritingHeatmap, type HeatCell } from "./charts";
import { fmt1, fmtInt, shortDate, useSettle } from "./helpers";

interface TrendData {
  heat: HeatCell[];
  daily: Record<string, number>;
  sessions: WritingSession[];
  pomodoros: PomodoroRecord[];
}

/** 写作趋势：热力图 + 近 60 天柱状图 + 会话/番茄钟统计 */
export function WritingTrend({ projectId, chapters }: { projectId: ID; chapters: Chapter[] }) {
  const settled = useSettle();
  const [data, loading, error, reload] = useAsync<TrendData | undefined>(
    async () => {
      const [heat, daily, sessions, pomodoros] = await Promise.all([
        heatmap(projectId, 180),
        dailyWordCounts(projectId, 60),
        listSessions(projectId),
        listPomodoros(projectId),
      ]);
      return { heat, daily, sessions, pomodoros };
    },
    [projectId],
    undefined,
  );

  const chapterTitle = useMemo(() => {
    const map = new Map(chapters.map((c) => [c.id, c.title]));
    return (id?: ID) => (id ? map.get(id) ?? "未命名章节" : "—");
  }, [chapters]);

  const stats = useMemo(() => {
    const sessions = data?.sessions ?? [];
    const heat = data?.heat ?? [];
    const days = new Set(sessions.map((s) => dayKey(s.startedAt)));
    const lastAt = sessions.reduce<string | undefined>((acc, s) => (!acc || s.startedAt > acc ? s.startedAt : acc), undefined);
    const writings = sessions.filter((s) => s.wordsAdded > 0);
    const avgWords = writings.length ? Math.round(writings.reduce((a, s) => a + s.wordsAdded, 0) / writings.length) : 0;
    const totalActiveMs = sessions.reduce((a, s) => a + s.activeMs, 0);
    const totalWords = sessions.reduce((a, s) => a + s.wordsAdded, 0);
    const speed = writingSpeed(totalWords, totalActiveMs);
    const heatWords = heat.reduce((a, c) => a + c.words, 0);
    const active = heat.filter((c) => c.words > 0).length;
    let longest = 0;
    let run = 0;
    for (const c of heat) {
      if (c.words > 0) {
        run += 1;
        if (run > longest) longest = run;
      } else run = 0;
    }
    // 今天还没写不算断更
    let i = heat.length - 1;
    if (i >= 0 && heat[i].words === 0) i -= 1;
    let tail = 0;
    while (i >= 0 && heat[i].words > 0) {
      tail += 1;
      i -= 1;
    }
    const pomodoros = data?.pomodoros ?? [];
    return {
      days: days.size,
      lastAt,
      avgWords,
      avgMinutes: sessions.length ? totalActiveMs / 60000 / sessions.length : 0,
      speed,
      heatWords,
      active,
      longest,
      tail,
      pomodoroDone: pomodoros.filter((p) => p.completed).length,
      pomodoroMinutes: pomodoros.reduce((a, p) => a + p.minutes, 0),
    };
  }, [data]);

  if (loading || !settled) return <Loading label="正在统计写作记录…" />;
  if (error) {
    return (
      <EmptyHint
        title="写作记录读取失败"
        description={error.message}
        action={
          <Button variant="outline" size="sm" onPress={reload}>
            重试
          </Button>
        }
      />
    );
  }

  const sessions = data?.sessions ?? [];
  const heat = data?.heat ?? [];
  const daily = data?.daily ?? {};
  const barData = Object.keys(daily)
    .sort()
    .map((k) => ({ label: shortDate(k), value: daily[k], tip: k + " · " + daily[k].toLocaleString("zh-CN") + " 字" }));

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="累计写作天数"
          value={fmtInt(stats.days) + " 天"}
          hint={stats.tail > 0 ? "连续写作 " + stats.tail + " 天" : "今天还没写，休息一下也行"}
          icon={<CalendarCheck className="size-4" />}
          tone="accent"
        />
        <StatCard
          label="最近一次写作"
          value={stats.lastAt ? formatRelative(stats.lastAt) : "—"}
          hint={stats.active > 0 ? "近 180 天活跃 " + stats.active + " 天" : "还没有记录"}
          icon={<Clock className="size-4" />}
        />
        <StatCard
          label="平均每次会话"
          value={stats.avgWords ? fmtInt(stats.avgWords) + " 字" : "—"}
          hint={stats.avgMinutes > 0 ? "平均专注 " + fmt1(stats.avgMinutes) + " 分钟" : "暂无有效会话"}
          icon={<Timer className="size-4" />}
          tone="success"
        />
        <StatCard
          label="写作速度"
          value={stats.speed > 0 ? fmt1(stats.speed) + " 字/分" : "—"}
          hint={stats.pomodoroDone > 0 ? "番茄钟 " + stats.pomodoroDone + " 个 · " + fmtInt(stats.pomodoroMinutes) + " 分钟" : "暂无番茄钟记录"}
          icon={<Gauge className="size-4" />}
          tone="warning"
        />
      </div>

      <Card className="p-4">
        <SectionTitle
          hint={"近 180 天共 " + fmtInt(stats.heatWords) + " 字 · 最长连续 " + stats.longest + " 天"}
          action={
            <Button variant="ghost" size="sm" onPress={reload} isIconOnly aria-label="刷新">
              <RefreshCw className="size-4" />
            </Button>
          }
        >
          写作热力图
        </SectionTitle>
        {heat.every((c) => c.words === 0) ? (
          <EmptyHint
            icon={<Flame className="size-7" />}
            title="还没有写作热力数据"
            description="写作记录会随写作台的会话自动累积，先在写作台敲下第一章吧。"
          />
        ) : (
          <WritingHeatmap data={heat} />
        )}
      </Card>

      <Card className="p-4">
        <SectionTitle hint="按会话新增字数汇总，柱高为当日净增字数">近 60 天字数</SectionTitle>
        {barData.length === 0 ? (
          <EmptyHint title="近 60 天没有写作记录" description="完成一次写作会话后，这里会出现每日字数柱状图。" />
        ) : (
          <BarChart data={barData} height={170} caption={"近 60 天共 " + fmtInt(barData.reduce((a, d) => a + d.value, 0)) + " 字"} />
        )}
      </Card>

      <Card className="p-4">
        <SectionTitle hint={"共 " + sessions.length + " 次会话，显示最近 10 次"}>写作会话</SectionTitle>
        {sessions.length === 0 ? (
          <EmptyHint title="还没有写作会话" description="开始写作后，每次会话的时长、字数与心流状态都会记录在这里。" />
        ) : (
          <div className="divide-y divide-black/5 dark:divide-white/5">
            <div className="grid grid-cols-[1fr_1.4fr_70px_70px_60px] gap-2 pb-2 text-[11px] opacity-45">
              <span>开始</span>
              <span>章节</span>
              <span className="text-right">新增</span>
              <span className="text-right">专注</span>
              <span className="text-right">心流</span>
            </div>
            {sessions.slice(0, 10).map((s) => (
              <div key={s.id} className="grid grid-cols-[1fr_1.4fr_70px_70px_60px] items-center gap-2 py-2 text-xs">
                <span className="truncate opacity-60">{formatRelative(s.startedAt)}</span>
                <span className="truncate">{chapterTitle(s.chapterId)}</span>
                <span className="tabular text-right">{fmtInt(s.wordsAdded)}</span>
                <span className="tabular text-right opacity-60">{fmt1(s.activeMs / 60000)} 分</span>
                <span className="text-right">{s.flow ? "是" : "—"}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <p className="px-1 text-[11px] opacity-45">
        会话数据来自写作台自动记录；总篇幅 {formatWords(chapters.reduce((a, c) => a + c.wordCount, 0))}。
      </p>
    </div>
  );
}
