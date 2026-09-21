import { Card, Chip } from "@heroui/react";
import { BookOpen, Compass, Globe, ListTree, Scroll, Users } from "lucide-react";
import type { Arc, Chapter, GenesisRun } from "@/core";
import type { BibleData } from "@/ai/genesis";
import { SectionTitle } from "@/components/common/ui";
import { formatWords } from "@/utils/format";
import { countWords } from "@/utils/text";
import { bibleOf, categoryLabel, categoryOf, pick, pickList, pickNested, roleLabel } from "./helpers";

interface Props {
  run: GenesisRun;
  selectedChars: Set<number>;
  selectedWorld: Set<number>;
  onToggleChar: (index: number) => void;
  onToggleWorld: (index: number) => void;
  onSetAllChars: (checked: boolean) => void;
  onSetAllWorld: (checked: boolean) => void;
}

function KV({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="flex gap-2">
      <dt className="w-9 shrink-0 opacity-45">{label}</dt>
      <dd className="min-w-0 flex-1 leading-relaxed opacity-80">{value}</dd>
    </div>
  );
}

function PickBox({ checked, onToggle, hint }: { checked: boolean; onToggle: () => void; hint: string }) {
  return (
    <label className="inline-flex shrink-0 cursor-pointer items-center gap-1 text-[11px] opacity-65 transition hover:opacity-100" title={hint}>
      <input type="checkbox" checked={checked} onChange={onToggle} className="accent-neutral-900" />
      采用
    </label>
  );
}

function TensionChip({ value }: { value: number }) {
  const color = value >= 3 ? "danger" : value >= 1 ? "warning" : value <= -2 ? "accent" : "default";
  return (
    <Chip size="sm" color={color}>
      张力 {value > 0 ? "+" + value : value}
    </Chip>
  );
}

/** 核心设定 */
function PremiseSection({ bible }: { bible: BibleData }) {
  const words = bible.openingScene ? countWords(bible.openingScene) : 0;
  const themes = bible.themes ?? [];
  return (
    <Card className="p-4">
      <SectionTitle hint="书名、高概念与开篇正文">核心设定</SectionTitle>
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="text-lg font-semibold tracking-tight">{bible.title || "未命名"}</h3>
        {bible.subtitle && <span className="text-sm opacity-55">{bible.subtitle}</span>}
      </div>
      {bible.logline && <p className="mt-2 text-sm leading-relaxed opacity-80">{bible.logline}</p>}
      {bible.premise && (
        <div className="mt-3 rounded-xl bg-black/[0.03] p-3 text-sm leading-relaxed dark:bg-white/[0.04]">
          {bible.premise}
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {themes.map((theme) => (
          <Chip key={theme} size="sm" color="accent">
            {theme}
          </Chip>
        ))}
        {bible.tone && <Chip size="sm">基调：{bible.tone}</Chip>}
      </div>
      {bible.openingScene && (
        <details className="mt-3 rounded-xl border border-black/5 p-3 dark:border-white/5">
          <summary className="cursor-pointer text-xs font-medium opacity-70">
            开篇正文（{formatWords(words)}）
          </summary>
          <p className="mt-2 text-sm leading-relaxed whitespace-pre-wrap">{bible.openingScene}</p>
        </details>
      )}
    </Card>
  );
}

/** 人物卡片网格 */
function CharacterSection({
  characters,
  selected,
  onToggle,
  onSetAll,
}: {
  characters: Record<string, unknown>[];
  selected: Set<number>;
  onToggle: (index: number) => void;
  onSetAll: (checked: boolean) => void;
}) {
  if (!characters.length) return null;
  return (
    <Card className="p-4">
      <SectionTitle
        hint={"已选 " + selected.size + " / " + characters.length + " 位"}
        action={
          <div className="flex items-center gap-2 text-[11px]">
            <button type="button" className="opacity-60 transition hover:opacity-100" onClick={() => onSetAll(true)}>
              全选
            </button>
            <button type="button" className="opacity-60 transition hover:opacity-100" onClick={() => onSetAll(false)}>
              全不选
            </button>
          </div>
        }
      >
        <span className="inline-flex items-center gap-1.5">
          <Users className="size-3.5" />
          人物
        </span>
      </SectionTitle>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {characters.map((raw, index) => {
          const checked = selected.has(index);
          const voice = raw.voice;
          const tone = pickNested(raw, "voice", "tone", "语气");
          const tics = pickList(voice, "verbalTics", "口癖");
          const voiceText = [tone, tics.length ? "口癖：" + tics.join("、") : ""].filter(Boolean).join(" · ");
          return (
            <div
              key={index}
              className={
                "rounded-xl border p-3 transition " +
                (checked
                  ? "border-black/25 bg-black/[0.03]"
                  : "border-black/5 opacity-55 dark:border-white/5")
              }
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{pick(raw, "name", "姓名") || "未命名人物"}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <Chip size="sm" color="accent">
                      {roleLabel(raw)}
                    </Chip>
                    {pick(raw, "age", "年龄") && <Chip size="sm">{pick(raw, "age", "年龄")}</Chip>}
                  </div>
                </div>
                <PickBox checked={checked} onToggle={() => onToggle(index)} hint="是否把这位人物写进项目" />
              </div>
              {pick(raw, "tagline", "定位") && (
                <p className="mt-2 text-xs leading-relaxed opacity-70">{pick(raw, "tagline", "定位")}</p>
              )}
              <dl className="mt-2 space-y-1 text-[11px]">
                <KV label="欲望" value={pick(raw, "want", "欲望")} />
                <KV label="需要" value={pick(raw, "need", "需要")} />
                <KV label="缺陷" value={pick(raw, "flaw", "缺陷")} />
                <KV label="弧光" value={pick(raw, "arc", "弧光")} />
                <KV label="口吻" value={voiceText} />
              </dl>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/** 世界观条目 + 硬规则 */
function WorldSection({
  entries,
  rules,
  selected,
  onToggle,
  onSetAll,
}: {
  entries: Record<string, unknown>[];
  rules: Record<string, unknown>[];
  selected: Set<number>;
  onToggle: (index: number) => void;
  onSetAll: (checked: boolean) => void;
}) {
  const groups = new Map<string, { raw: Record<string, unknown>; index: number }[]>();
  entries.forEach((raw, index) => {
    const key = categoryOf(raw);
    const list = groups.get(key) ?? [];
    list.push({ raw, index });
    groups.set(key, list);
  });

  if (!entries.length && !rules.length) return null;

  return (
    <Card className="p-4">
      <SectionTitle
        hint={entries.length ? "已选 " + selected.size + " / " + entries.length + " 条，按分类分组" : undefined}
        action={
          entries.length ? (
            <div className="flex items-center gap-2 text-[11px]">
              <button type="button" className="opacity-60 transition hover:opacity-100" onClick={() => onSetAll(true)}>
                全选
              </button>
              <button type="button" className="opacity-60 transition hover:opacity-100" onClick={() => onSetAll(false)}>
                全不选
              </button>
            </div>
          ) : undefined
        }
      >
        <span className="inline-flex items-center gap-1.5">
          <Globe className="size-3.5" />
          世界观
        </span>
      </SectionTitle>

      <div className="space-y-4">
        {Array.from(groups, ([key, list]) => (
          <div key={key}>
            <p className="mb-1.5 text-[11px] font-medium tracking-wide opacity-55">
              {categoryLabel(key)}（{list.length}）
            </p>
            <ul className="space-y-1.5">
              {list.map(({ raw, index }) => {
                const checked = selected.has(index);
                const body = pick(raw, "body", "内容", "description");
                return (
                  <li
                    key={index}
                    className={
                      "rounded-xl border px-3 py-2 transition " +
                      (checked ? "border-black/5 dark:border-white/5" : "border-black/5 opacity-50 dark:border-white/5")
                    }
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0 flex-1 text-sm font-medium">{pick(raw, "title", "条目名", "name")}</span>
                      <PickBox checked={checked} onToggle={() => onToggle(index)} hint="是否把这条设定写进项目" />
                    </div>
                    {body && <p className="mt-1 text-xs leading-relaxed opacity-70">{body}</p>}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

        {rules.length > 0 && (
          <div>
            <p className="mb-1.5 text-[11px] font-medium tracking-wide opacity-55">世界硬规则（{rules.length}）</p>
            <ul className="space-y-1.5">
              {rules.map((raw, index) => (
                <li key={index} className="rounded-xl border border-black/5 px-3 py-2 dark:border-white/5">
                  <p className="text-sm font-medium">{pick(raw, "title", "名称", "name")}</p>
                  <p className="mt-1 text-xs leading-relaxed opacity-70">
                    {pick(raw, "statement", "规则", "description")}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}

/** 分卷结构 */
function StructureSection({ arcs }: { arcs: Arc[] }) {
  if (!arcs.length) return null;
  return (
    <Card className="p-4">
      <SectionTitle hint={arcs.length + " 卷"}>
        <span className="inline-flex items-center gap-1.5">
          <Compass className="size-3.5" />
          分卷结构
        </span>
      </SectionTitle>
      <div className="grid gap-3 md:grid-cols-2">
        {arcs.map((arc, index) => (
          <div key={arc.id} className="rounded-xl border border-black/5 p-3 dark:border-white/5">
            <div className="flex items-center gap-2">
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: arc.color ?? "#7c5cff" }}
                aria-hidden
              />
              <p className="min-w-0 flex-1 truncate text-sm font-medium">
                第 {index + 1} 卷 · {arc.title}
              </p>
            </div>
            {arc.summary && <p className="mt-2 text-xs leading-relaxed opacity-70">{arc.summary}</p>}
            <dl className="mt-2 space-y-1 text-[11px]">
              <KV label="目标" value={arc.goal} />
              <KV label="冲突" value={arc.conflict} />
              <KV label="结果" value={arc.outcome} />
            </dl>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** 章节大纲（按卷分组） */
function ChapterSection({ arcs, chapters }: { arcs: Arc[]; chapters: Chapter[] }) {
  if (!chapters.length) return null;
  const groups: { title: string; list: Chapter[] }[] = [];
  for (const arc of arcs) {
    const list = chapters.filter((c) => c.arcId === arc.id);
    if (list.length) groups.push({ title: arc.title, list });
  }
  const rest = chapters.filter((c) => !arcs.some((a) => a.id === c.arcId));
  if (rest.length) groups.push({ title: "未分卷", list: rest });

  return (
    <Card className="p-4">
      <SectionTitle hint={chapters.length + " 章"}>
        <span className="inline-flex items-center gap-1.5">
          <ListTree className="size-3.5" />
          章节大纲
        </span>
      </SectionTitle>
      <div className="space-y-4">
        {groups.map((group) => (
          <div key={group.title}>
            <p className="mb-1.5 text-[11px] font-medium tracking-wide opacity-55">
              {group.title}（{group.list.length} 章）
            </p>
            <ul className="space-y-1">
              {group.list.map((chapter) => (
                <li
                  key={chapter.id}
                  className="flex items-start gap-3 rounded-xl border border-black/5 px-3 py-2 dark:border-white/5"
                >
                  <span className="tabular mt-0.5 w-8 shrink-0 text-[11px] opacity-40">
                    {String(chapter.order + 1).padStart(2, "0")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{chapter.title}</span>
                      <TensionChip value={chapter.tension} />
                    </div>
                    {chapter.summary && (
                      <p className="mt-1 text-xs leading-relaxed opacity-65">{chapter.summary}</p>
                    )}
                    {chapter.hook && <p className="mt-1 text-[11px] leading-relaxed opacity-45">钩子：{chapter.hook}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** 每个阶段产物的可读预览 */
export function GenesisPreview({
  run,
  selectedChars,
  selectedWorld,
  onToggleChar,
  onToggleWorld,
  onSetAllChars,
  onSetAllWorld,
}: Props) {
  const bible = bibleOf(run);
  const arcs = (run.stages.find((s) => s.kind === "structure" && s.data)?.data ?? []) as Arc[];
  const chapters = (run.stages.find((s) => s.kind === "outline" && s.data)?.data ?? []) as Chapter[];
  const hasAnything = Boolean(
    (bible && (bible.title || bible.premise || bible.logline)) || bible?.characters.length || arcs.length || chapters.length,
  );
  if (!hasAnything) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 px-1 text-xs opacity-50">
        <BookOpen className="size-3.5" />
        下面是为这部作品生成的完整故事圣经，勾选后点「写入项目」才会真正落库。
      </div>
      {bible && <PremiseSection bible={bible} />}
      {bible && (
        <CharacterSection
          characters={bible.characters ?? []}
          selected={selectedChars}
          onToggle={onToggleChar}
          onSetAll={onSetAllChars}
        />
      )}
      {bible && (
        <WorldSection
          entries={bible.world ?? []}
          rules={bible.rules ?? []}
          selected={selectedWorld}
          onToggle={onToggleWorld}
          onSetAll={onSetAllWorld}
        />
      )}
      <StructureSection arcs={arcs} />
      <ChapterSection arcs={arcs} chapters={chapters} />

      {chapters.length > 0 && (
        <p className="flex items-center gap-1.5 px-1 text-[11px] opacity-45">
          <Scroll className="size-3" />
          章节会以「大纲」状态写入，不会覆盖已有正文（除非你勾选覆盖）。
        </p>
      )}
    </div>
  );
}
