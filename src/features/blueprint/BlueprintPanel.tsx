import { useMemo, useState } from "react";
import { Button, Card, Chip, TextArea } from "@heroui/react";
import {
  AlertTriangle, BookOpen, Check, Copy, ScanSearch, Sparkles, Trash2, Wand2,
} from "lucide-react";
import type { ID, StoryBlueprint } from "@/core";
import { findOverlaps, MUST_REPLACE } from "@/core";
import { analyzeBlueprint, generateFromBlueprint, type GeneratedStory } from "@/ai/blueprint";
import { applyGeneratedStory, type ApplyBlueprintResult } from "./apply";
import { deleteBlueprint, pruneBlueprints, saveBlueprint } from "@/db/repo/blueprint";
import { useAppStore } from "@/app/store";
import { useLiveQuery } from "dexie-react-hooks";
import { listBlueprints } from "@/db/repo/blueprint";
import { SectionTitle, EmptyHint } from "@/components/common/ui";
import { formatWords } from "@/utils/format";
import { countWords } from "@/utils/text";

const NL = String.fromCharCode(10);

/**
 * 拆书 / 仿书。
 *
 * ## 这个功能的产品立场（写在最前面，因为它决定了整页的形态）
 *
 * 拆书很容易滑成洗稿，所以这里刻意把结果切成两层，并在界面上把这件事讲明白：
 *
 * - **技法层**（视角、节奏、信息释放、钩子、语言）—— 这是手艺，**照单全收**，
 *   并且会写进项目的 styleGuide，之后每一次生成都带着它。
 * - **内容层**（题材、世界规则、人物关系、情节引擎、转折、结局）—— 这是别人的创作，
 *   **必须全部换掉**。界面上用醒目的方式标出"只作结构参照"。
 *
 * 生成之后还会跑一次**原创性自检**：拿新作与参考原文比最长公共子串，
 * 连续 12 字以上雷同就标出来。模型偶尔会"记得"原文，作者自己很难逐句比对。
 */
export function BlueprintPanel({ projectId }: { projectId: ID }) {
  const notify = useAppStore((s) => s.notify);

  const [sourceTitle, setSourceTitle] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [analyzing, setAnalyzing] = useState(false);

  const [blueprint, setBlueprint] = useState<StoryBlueprint | null>(null);
  const [activeId, setActiveId] = useState<ID | null>(null);
  const [activeSource, setActiveSource] = useState("");

  const [premise, setPremise] = useState("");
  const [chapterCount, setChapterCount] = useState(12);
  const [generating, setGenerating] = useState(false);
  const [story, setStory] = useState<GeneratedStory | null>(null);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState<ApplyBlueprintResult | null>(null);

  const saved = useLiveQuery(() => listBlueprints(projectId), [projectId], undefined);

  const words = useMemo(() => countWords(sourceText), [sourceText]);

  /** 原创性自检：新作全文 vs 参考原文 */
  const overlaps = useMemo(() => {
    if (!story || !activeSource) return [];
    const flat = [
      story.title, story.logline, story.premise,
      ...story.characters.flatMap((c) => [c.name, c.tagline ?? "", c.want ?? "", c.flaw ?? ""]),
      ...story.world.flatMap((w) => [w.title, w.body]),
      ...story.rules.flatMap((r) => [r.title, r.statement]),
      ...story.arcs.flatMap((a) => [a.title, a.summary ?? "", a.goal ?? "", a.conflict ?? "", a.outcome ?? ""]),
      ...story.chapters.flatMap((c) => [c.title, c.summary ?? "", c.hook ?? ""]),
    ].join(NL);
    return findOverlaps(flat, activeSource);
  }, [story, activeSource]);

  const runAnalyze = async () => {
    if (words < 500) {
      notify("warning", "样本太短", "至少给 500 字，建议一章正文或一份完整大纲");
      return;
    }
    setAnalyzing(true);
    setStory(null);
    setApplied(null);
    try {
      const res = await analyzeBlueprint({ projectId, sourceText, sourceTitle });
      if (!res.ok || !res.blueprint) {
        notify("danger", "拆解失败", res.error);
        return;
      }
      setBlueprint(res.blueprint);
      const row = await saveBlueprint({ projectId, sourceTitle, sourceText, blueprint: res.blueprint });
      setActiveId(row.id);
      setActiveSource(sourceText);
      const pruned = await pruneBlueprints(projectId);
      notify(
        "success",
        "拆解完成",
        res.sampled ? "样本较长，已按开头 + 全文取样分析" : "已分析全文" + (pruned ? "，清理了 " + pruned + " 份旧拆解" : ""),
      );
    } catch (e) {
      notify("danger", "拆解失败", e instanceof Error ? e.message : String(e));
    } finally {
      setAnalyzing(false);
    }
  };

  const runGenerate = async () => {
    if (!blueprint) return;
    if (premise.trim().length < 8) {
      notify("warning", "请先写你的点子", "故事的血肉来自你的点子，技法只是组织方式");
      return;
    }
    setGenerating(true);
    setApplied(null);
    try {
      const res = await generateFromBlueprint({ projectId, blueprint, premise, chapterCount });
      if (!res.ok || !res.story) {
        notify("danger", "生成失败", res.error);
        return;
      }
      setStory(res.story);
      notify("success", "已生成新故事", "请先看原创性自检结果，再决定是否落库");
    } catch (e) {
      notify("danger", "生成失败", e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  };

  const runApply = async () => {
    if (!story) return;
    setApplying(true);
    try {
      const res = await applyGeneratedStory(projectId, story, {
        prefix: "",
        blueprint: blueprint ?? undefined,
      });
      setApplied(res);
      notify(
        "success",
        "已落库",
        "人物 " + res.characters + " · 世界观 " + res.worldEntries + " · 章节 " + res.chapters + "；技法已写入本书的写作风格",
      );
    } catch (e) {
      notify("danger", "落库失败", e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  };

  const loadSaved = (rowId: ID) => {
    const row = (saved ?? []).find((r) => r.id === rowId);
    if (!row) return;
    setBlueprint(row.blueprint);
    setActiveId(row.id);
    setActiveSource(row.sourceText);
    setSourceTitle(row.sourceTitle);
    setSourceText(row.sourceText);
    setStory(null);
    setApplied(null);
  };

  return (
    <div className="space-y-5">
      {/* ---------- 第一步：给参考书 ---------- */}
      <Card className="p-4">
        <SectionTitle hint="本地分析，不上传任何内容。建议给一章正文 + 全书大纲，效果最好">
          第一步 · 放入参考书
        </SectionTitle>
        <div className="mt-3 space-y-2">
          <input
            value={sourceTitle}
            onChange={(e) => setSourceTitle(e.target.value)}
            placeholder="参考书名称（只用于你自己区分，例如「某本悬疑小说」）"
            className="w-full rounded-lg border border-black/10 bg-transparent px-2.5 py-1.5 text-xs dark:border-white/15"
          />
          <TextArea
            rows={8}
            value={sourceText}
            onChange={(e) => setSourceText(e.target.value)}
            placeholder="把参考书正文或大纲粘贴到这里。至少 500 字，建议 3000 字以上 —— 样本越长，拆出来的节奏与结构越准。"
          />
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] opacity-55">{words > 0 ? formatWords(words) : "尚未输入"}</span>
            {words > 0 && words < 500 && (
              <Chip size="sm" color="warning">
                太短，拆不出结构
              </Chip>
            )}
            <Button className="ml-auto" size="sm" variant="primary" isPending={analyzing} onPress={() => void runAnalyze()}>
              <ScanSearch className="size-3.5" />
              开始拆解
            </Button>
          </div>
        </div>
      </Card>

      {/* ---------- 已保存的拆解 ---------- */}
      {(saved ?? []).length > 0 && (
        <Card className="p-4">
          <SectionTitle hint="点一下载入，可以继续用它生成新作">已拆解 {saved?.length} 份</SectionTitle>
          <ul className="mt-2 space-y-1.5">
            {(saved ?? []).map((row) => (
              <li
                key={row.id}
                className={
                  "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-2.5 py-1.5 " +
                  (activeId === row.id ? "border-violet-500/50 bg-violet-500/[0.05]" : "border-black/8 dark:border-white/10")
                }
              >
                <button type="button" onClick={() => loadSaved(row.id)} className="min-w-0 flex-1 text-left">
                  <span className="text-xs font-medium">{row.sourceTitle}</span>
                  <span className="ml-2 text-[11px] opacity-50">
                    {formatWords(row.wordCount)} · {row.blueprint.content.genre}
                  </span>
                </button>
                {activeId === row.id && (
                  <Chip size="sm" color="accent">
                    当前使用
                  </Chip>
                )}
                <button
                  type="button"
                  title="删除这份拆解"
                  onClick={async () => {
                    await deleteBlueprint(row.id);
                    if (activeId === row.id) {
                      setActiveId(null);
                      setBlueprint(null);
                      setActiveSource("");
                    }
                    notify("info", "已删除拆解记录");
                  }}
                  className="rounded p-1 opacity-40 transition hover:text-rose-500 hover:opacity-100"
                >
                  <Trash2 className="size-3" />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* ---------- 第二步：看拆解结果 ---------- */}
      {blueprint && (
        <Card className="p-4">
          <SectionTitle hint="技法照单全收；内容必须全部换掉">第二步 · 拆解结果</SectionTitle>

          <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.05] px-3 py-2.5">
            <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
              <Check className="size-3.5" />
              技法层 · 这些会照做，并写进本书的写作风格
            </p>
            <div className="mt-2 grid gap-x-6 gap-y-1 text-[11px] leading-relaxed sm:grid-cols-2">
              {(
                [
                  ["视角", blueprint.technique.pov],
                  ["时间处理", blueprint.technique.timeHandling],
                  ["语言", blueprint.technique.proseStyle],
                  ["段落与场景", blueprint.technique.paragraphing],
                  ["信息释放节奏", blueprint.technique.informationRelease],
                  ["钩子", blueprint.technique.hooks],
                  ["对话配比", blueprint.technique.dialogueRatio],
                  ["情绪曲线", blueprint.technique.emotionalCurve],
                  ["群像处理", blueprint.technique.ensembleHandling],
                ] as [string, string][]
              ).map(([k, v]) => (
                <p key={k}>
                  <span className="opacity-55">{k}：</span>
                  <span className="opacity-85">{v}</span>
                </p>
              ))}
            </div>
            <p className="mt-2 text-[11px] opacity-70">
              <span className="opacity-60">最值得学的一招：</span>
              {blueprint.technique.signatureMove}
            </p>
          </div>

          <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/[0.05] px-3 py-2.5">
            <p className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
              <AlertTriangle className="size-3.5" />
              内容层 · 只作结构参照，生成时会全部替换
            </p>
            <div className="mt-2 space-y-1 text-[11px] leading-relaxed opacity-80">
              <p><span className="opacity-55">题材：</span>{blueprint.content.genre}</p>
              <p><span className="opacity-55">世界规则形态：</span>{blueprint.content.worldRulesShape}</p>
              <p><span className="opacity-55">人物关系拓扑：</span>{blueprint.content.relationshipShape}</p>
              <p><span className="opacity-55">情节引擎：</span>{blueprint.content.plotEngine}</p>
              <p><span className="opacity-55">结局类型：</span>{blueprint.content.endingType}</p>
            </div>
            {blueprint.content.actStructure.length > 0 && (
              <div className="mt-2">
                <p className="text-[11px] opacity-55">幕结构</p>
                <ul className="mt-0.5 space-y-0.5">
                  {blueprint.content.actStructure.map((a, i) => (
                    <li key={i} className="text-[11px] leading-relaxed opacity-80">
                      {a.act}：{a.function}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="mt-2 rounded bg-amber-500/10 px-2 py-1.5 text-[11px] leading-relaxed">
              <span className="font-medium">必须替换：</span>
              {MUST_REPLACE.join(" / ")}
            </p>
          </div>

          {blueprint.chapterTemplate.length > 0 && (
            <div className="mt-3">
              <p className="text-[11px] font-medium opacity-70">章节功能模板</p>
              <ol className="mt-1 space-y-0.5">
                {blueprint.chapterTemplate.map((r, i) => (
                  <li key={i} className="text-[11px] leading-relaxed opacity-75">
                    {i + 1}. [{r.role}] {r.function}
                    <span className="ml-1 opacity-50">张力 {r.tension}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </Card>
      )}

      {/* ---------- 第三步：生成新作 ---------- */}
      {blueprint && (
        <Card className="p-4">
          <SectionTitle hint="故事的血肉来自你的点子，技法只是组织方式">第三步 · 用这套技法写新故事</SectionTitle>
          <div className="mt-3 space-y-2">
            <TextArea
              rows={3}
              value={premise}
              onChange={(e) => setPremise(e.target.value)}
              placeholder="你的点子。例如：一个靠出租记忆为生的人，发现自己的记忆被反复出租过 37 次。"
            />
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-[11px] opacity-70">
                章节数
                <input
                  type="number"
                  min={3}
                  max={60}
                  value={chapterCount}
                  onChange={(e) => setChapterCount(Math.max(3, Math.min(60, Number(e.target.value) || 12)))}
                  className="tabular w-16 rounded border border-black/10 bg-transparent px-1.5 py-0.5 text-center dark:border-white/15"
                />
              </label>
              <Button className="ml-auto" size="sm" variant="primary" isPending={generating} onPress={() => void runGenerate()}>
                <Wand2 className="size-3.5" />
                生成新故事
              </Button>
            </div>
          </div>

          {story && (
            <div className="mt-4 space-y-3">
              {/* 原创性自检放在最前面：这是作者最该先看的东西 */}
              {overlaps.length > 0 ? (
                <div className="rounded-lg border border-rose-500/40 bg-rose-500/[0.06] px-3 py-2.5">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-rose-600 dark:text-rose-300">
                    <AlertTriangle className="size-3.5" />
                    原创性自检：发现 {overlaps.length} 处与参考书雷同（连续 {12} 字以上）
                  </p>
                  <ul className="mt-1.5 space-y-1">
                    {overlaps.slice(0, 6).map((h, i) => (
                      <li key={i} className="rounded bg-white/60 px-2 py-1 text-[11px] leading-relaxed dark:bg-black/20">
                        {h.text.slice(0, 80)}
                        <span className="ml-1 opacity-50">（{h.length} 字）</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1.5 text-[11px] leading-relaxed opacity-75">
                    建议重新生成，或把这几处改写掉。落库前请务必处理 —— 这是你自己的作品，不该带着别人的句子。
                  </p>
                </div>
              ) : (
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/[0.05] px-3 py-2.5">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                    <Check className="size-3.5" />
                    原创性自检通过：与参考书没有连续 12 字以上的雷同
                  </p>
                </div>
              )}

              <div className="rounded-lg border border-black/8 px-3 py-2.5 dark:border-white/10">
                <p className="text-sm font-semibold">{story.title}</p>
                {story.logline && <p className="mt-0.5 text-xs opacity-70">{story.logline}</p>}
                {story.premise && <p className="mt-1.5 text-[11px] leading-relaxed opacity-65">{story.premise}</p>}
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] opacity-70">
                  <span>人物 {story.characters.length}</span>
                  <span>世界观 {story.world.length}</span>
                  <span>硬规则 {story.rules.length}</span>
                  <span>分卷 {story.arcs.length}</span>
                  <span>章节 {story.chapters.length}</span>
                </div>
              </div>

              <details className="rounded-lg border border-black/8 px-3 py-2 dark:border-white/10">
                <summary className="cursor-pointer text-xs font-medium">看人物与章节（{story.characters.length} 人 / {story.chapters.length} 章）</summary>
                <div className="mt-2 space-y-1.5">
                  {story.characters.map((c, i) => (
                    <p key={i} className="text-[11px] leading-relaxed">
                      <span className="font-medium">{c.name}</span>
                      <span className="ml-1 opacity-50">{c.role}</span>
                      {c.tagline && <span className="ml-1 opacity-70">· {c.tagline}</span>}
                    </p>
                  ))}
                  <div className="mt-2 border-t border-black/5 pt-2 dark:border-white/10">
                    {story.chapters.map((c, i) => (
                      <p key={i} className="text-[11px] leading-relaxed opacity-75">
                        {i + 1}. {c.title}
                        {c.hook && <span className="opacity-60"> · 钩子：{c.hook}</span>}
                      </p>
                    ))}
                  </div>
                </div>
              </details>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  isPending={applying}
                  isDisabled={overlaps.length > 0}
                  onPress={() => void runApply()}
                >
                  <Sparkles className="size-3.5" />
                  落库到这本书
                </Button>
                {overlaps.length > 0 && (
                  <span className="text-[11px] text-rose-600 dark:text-rose-400">
                    有雷同片段，先解决再落库（或换个点子重新生成）
                  </span>
                )}
                <Button size="sm" variant="ghost" onPress={() => setStory(null)}>
                  丢弃这次结果
                </Button>
              </div>

              {applied && (
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/[0.06] px-3 py-2 text-[11px] leading-relaxed">
                  已落库：人物 {applied.characters}
                  {applied.mergedCharacters > 0 && "（更新 " + applied.mergedCharacters + "）"} · 世界观 {applied.worldEntries} ·
                  硬规则 {applied.rules} · 分卷 {applied.arcs}
                  {applied.mergedArcs > 0 && "（更新 " + applied.mergedArcs + "）"} · 章节 {applied.chapters}
                  {applied.mergedChapters > 0 && "（更新 " + applied.mergedChapters + "）"}
                  <p className="mt-1 opacity-70">
                    参考书的写法已写入本书的「写作风格」，之后每一次生成都会带着它。同名条目会被更新，不会重复新增。
                  </p>
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      {!blueprint && (saved ?? []).length === 0 && (
        <EmptyHint
          icon={<BookOpen className="size-9" />}
          title="还没有拆解过任何书"
          description="把一本你觉得写得好的书的正文或大纲贴进来，系统会拆出它的写作技法与结构骨架。技法会照做，内容会全部换成你自己的。"
        />
      )}
    </div>
  );
}
