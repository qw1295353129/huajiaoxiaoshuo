import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, Chip } from "@heroui/react";
import { Copy, Fingerprint, RefreshCw, Sparkles } from "lucide-react";
import type { Chapter, ID, StyleFingerprint } from "@/core";
import { db } from "@/db/database";
import { getStyleFingerprint, saveStyleFingerprint } from "@/db/repo/story";
import { buildFingerprint } from "@/utils/style-analyzer";
import { countWords } from "@/utils/text";
import { EmptyHint, Loading, Progress, SectionTitle } from "@/components/common/ui";
import { formatDateTime } from "@/utils/format";
import { useAppStore } from "@/app/store";
import { MiniHistogram } from "./charts";
import { copyText, fmt1, fmtInt, fmtPct } from "./helpers";

/** 采样上限：指纹只看前 24 万字，足够稳定又不会卡住主线程 */
const SAMPLE_CAP = 240_000;

const HISTOGRAM_LABELS = ["0-5", "5-10", "10-15", "15-20", "20-25", "25-30", "30-40", "40-50", "50-80", "80+"];

/** 文风指纹：统计全文的句式、用词偏好，生成给 AI 的文风描述 */
export function StyleFingerprintPanel({ projectId, chapters }: { projectId: ID; chapters: Chapter[] }) {
  const notify = useAppStore((s) => s.notify);
  const [fp, setFp] = useState<StyleFingerprint | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setFp(await getStyleFingerprint(projectId));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** 汇总所有章节正文（只读），按写作顺序采样 */
  const compute = useCallback(async () => {
    setBusy(true);
    setStage("读取章节正文…");
    setProgress({ done: 0, total: chapters.length });
    try {
      const contents = await db.chapterContents.where("projectId").equals(projectId).toArray();
      const byId = new Map(contents.map((c) => [c.chapterId, c]));
      const ordered = chapters
        .slice()
        .sort((a, b) => a.order - b.order)
        .filter((c) => (byId.get(c.id)?.text ?? "").trim().length > 0);

      if (!ordered.length) {
        notify("warning", "没有可分析的正文", "先在写作台写下一些内容再来计算文风指纹。");
        return;
      }

      let text = "";
      let sampled = 0;
      for (const ch of ordered) {
        if (text.length >= SAMPLE_CAP) break;
        const raw = byId.get(ch.id)?.text ?? "";
        const slice = text.length + raw.length > SAMPLE_CAP ? raw.slice(0, SAMPLE_CAP - text.length) : raw;
        text += (text ? "\n\n" : "") + slice;
        sampled += 1;
        setStage("采样第 " + sampled + "/" + ordered.length + " 章…");
        setProgress({ done: sampled, total: ordered.length });
      }

      setStage("统计句式与用词…");
      const sampleWords = countWords(text);
      const next = buildFingerprint({ projectId, sampleChapters: sampled, sampleWords, text });
      await saveStyleFingerprint(next);
      setFp(next);
      notify("success", "文风指纹已更新", "采样 " + sampled + " 章 / " + fmtInt(sampleWords) + " 字");
    } catch (e) {
      notify("danger", "文风指纹计算失败", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setStage("");
    }
  }, [projectId, chapters, notify]);

  const metrics = fp?.metrics;
  const tiles = useMemo(() => {
    if (!metrics) return [];
    return [
      { label: "平均句长", value: fmt1(metrics.avgSentenceLength) + " 字", hint: metrics.avgSentenceLength > 24 ? "句子偏长" : metrics.avgSentenceLength < 12 ? "句子偏短" : "长度适中" },
      { label: "句长标准差", value: fmt1(metrics.sentenceLengthStd), hint: metrics.sentenceLengthStd > 9 ? "长短交错明显" : "句式较均匀" },
      { label: "对话占比", value: fmtPct(metrics.dialogueRatio, 1), hint: metrics.dialogueRatio > 0.45 ? "对话驱动" : metrics.dialogueRatio < 0.15 ? "叙述为主" : "比例健康" },
      { label: "比喻密度", value: fmt1(metrics.simileDensity), hint: "每千字「像/如/仿佛」次数" },
      { label: "词汇丰富度", value: metrics.ttr.toFixed(3), hint: "不同汉字数 / 总汉字数" },
      { label: "副词密度", value: fmt1(metrics.adverbDensity), hint: metrics.adverbDensity > 12 ? "「地」偏多，注意克制" : "每千字「地」字数" },
      { label: "形容词密度", value: fmt1(metrics.adjectiveDensity), hint: metrics.adjectiveDensity > 45 ? "定语偏多" : "每千字「X的」结构数" },
      { label: "节奏分", value: fmt1(metrics.pacingScore), hint: metrics.pacingScore > 70 ? "节奏良好" : metrics.pacingScore > 50 ? "中规中矩" : "节奏偏平" },
    ];
  }, [metrics]);

  const cloud = useMemo(() => {
    const words = fp?.topWords ?? [];
    const max = Math.max(1, ...words.map((w) => w.count));
    return words.slice(0, 36).map((w) => ({
      ...w,
      size: 12 + Math.round((w.count / max) * 14),
      opacity: 0.45 + (w.count / max) * 0.55,
    }));
  }, [fp]);

  if (loading) return <Loading label="正在读取文风指纹…" />;

  if (!fp || !metrics) {
    return (
      <Card className="p-4">
        <SectionTitle hint="纯本地统计，不消耗 token">文风指纹</SectionTitle>
        {busy ? (
          <div className="space-y-2 py-6">
            <p className="text-xs opacity-60">{stage}</p>
            <Progress value={progress.done} max={progress.total} />
          </div>
        ) : (
          <EmptyHint
            icon={<Fingerprint className="size-7" />}
            title="还没有文风指纹"
            description="统计全书正文的句长分布、对话比例、用词偏好与节奏评分，生成一段可直接交给 AI 的文风描述，让续写更像你写的。"
            action={
              <Button variant="primary" size="sm" onPress={() => void compute()}>
                <Sparkles className="size-4" />
                计算文风指纹
              </Button>
            }
          />
        )}
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <Card className="p-4">
        <SectionTitle
          hint={"采样 " + fp.sampleChapters + " 章 / " + fmtInt(fp.sampleWords) + " 字 · 计算于 " + formatDateTime(fp.computedAt)}
          action={
            <Button variant="outline" size="sm" isDisabled={busy} isPending={busy} onPress={() => void compute()}>
              <RefreshCw className="size-4" />
              重新计算
            </Button>
          }
        >
          文风指纹
        </SectionTitle>
        {busy && (
          <div className="mb-3 space-y-2">
            <p className="text-xs opacity-60">{stage}</p>
            <Progress value={progress.done} max={progress.total} />
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-xl border border-black/5 p-3 dark:border-white/5">
              <p className="text-[11px] opacity-55">{t.label}</p>
              <p className="tabular mt-1 text-lg font-semibold tracking-tight">{t.value}</p>
              <p className="mt-0.5 text-[11px] opacity-45">{t.hint}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-4">
        <SectionTitle hint="字符越大表示出现越频繁（中文字滑窗去重后的高频片段）">高频用词</SectionTitle>
        {cloud.length === 0 ? (
          <EmptyHint title="样本太少，还没统计出高频词" description="多写几章后重新计算即可。" />
        ) : (
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2 leading-relaxed">
            {cloud.map((w) => (
              <span key={w.word} className="cursor-default transition hover:text-violet-500" style={{ fontSize: w.size, opacity: w.opacity }} title={w.word + " · " + w.count + " 次"}>
                {w.word}
              </span>
            ))}
          </div>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-4">
          <SectionTitle hint="每章句长落在各区间内的句子数量">句长分布</SectionTitle>
          <MiniHistogram values={fp.sentenceHistogram} labels={HISTOGRAM_LABELS} />
        </Card>

        <Card className="p-4">
          <SectionTitle hint="反复出现的 5~8 字片段，往往是你的口头禅">标志性短语</SectionTitle>
          {fp.signaturePhrases.length === 0 ? (
            <EmptyHint title="还没有明显重复的短语" description="这说明你的措辞变化比较丰富。" />
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {fp.signaturePhrases.map((p) => (
                <Chip key={p.phrase} size="sm" color="default">
                  {p.phrase} · {p.count}
                </Chip>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card className="p-4">
        <SectionTitle
          hint="这段描述会被拼进 AI 的上下文，用于约束续写风格"
          action={
            <Button
              variant="outline"
              size="sm"
              onPress={() => {
                void copyText(fp.prompt).then((ok) => notify(ok ? "success" : "danger", ok ? "文风描述已复制" : "复制失败", ok ? undefined : "浏览器拒绝了剪贴板访问，请手动选中复制。"));
              }}
            >
              <Copy className="size-4" />
              复制
            </Button>
          }
        >
          给 AI 的文风描述
        </SectionTitle>
        <p className="rounded-xl bg-black/[0.03] p-3 text-sm leading-relaxed dark:bg-white/[0.04]">{fp.prompt}</p>
      </Card>
    </div>
  );
}
