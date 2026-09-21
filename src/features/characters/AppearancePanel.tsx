import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Button, Card } from "@heroui/react";
import { BarChart3 } from "lucide-react";
import type { ID } from "@/core";
import { useChapters } from "@/app/hooks";
import { listAppearances } from "@/db/repo/cast";
import { Loading } from "@/components/common/ui";
import { MiniEmpty } from "./parts";

/** 一次最多画多少章的柱子，剩下的折叠（上千章时避免 DOM 过大） */
const MAX_BARS = 60;

/**
 * 出场统计：读 characterAppearances（由章节索引写入）+ 章节列表，
 * 用纯 div 柱状图展示每章的提及次数与台词数。
 */
export function AppearancePanel({ characterId, projectId }: { characterId: ID; projectId: ID }) {
  const chapters = useChapters(projectId);
  const rows = useLiveQuery(() => listAppearances(characterId), [characterId], undefined);
  const [showAll, setShowAll] = useState(false);

  const stats = useMemo(() => {
    const byId = new Map(chapters.map((c) => [c.id, c]));
    const list = (rows ?? [])
      .map((row) => ({ row, chapter: byId.get(row.chapterId) }))
      .filter((x) => Boolean(x.chapter))
      .sort((a, b) => (a.chapter?.order ?? 0) - (b.chapter?.order ?? 0));
    const totals = list.reduce(
      (acc, x) => ({
        mentioned: acc.mentioned + (x.row.mentioned ?? 0),
        dialogue: acc.dialogue + (x.row.dialogueLines ?? 0),
        words: acc.words + (x.row.words ?? 0),
      }),
      { mentioned: 0, dialogue: 0, words: 0 },
    );
    const maxMentioned = Math.max(1, ...list.map((x) => x.row.mentioned ?? 0));
    const maxDialogue = Math.max(1, ...list.map((x) => x.row.dialogueLines ?? 0));
    return { list, totals, maxMentioned, maxDialogue };
  }, [rows, chapters]);

  const visible = showAll ? stats.list : stats.list.slice(0, MAX_BARS);

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center gap-1.5 text-sm font-semibold tracking-tight">
        <BarChart3 className="size-4 opacity-60" />
        出场统计
      </div>

      {rows === undefined ? (
        <Loading label="正在统计出场…" />
      ) : stats.list.length === 0 ? (
        <MiniEmpty>
          还没有出场数据。在 AI 工坊对章节跑一次「章节索引」，系统会自动统计每个角色的提及次数、台词数与字数。
        </MiniEmpty>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              { label: "出场章节", value: stats.list.length },
              { label: "被提及", value: stats.totals.mentioned },
              { label: "台词", value: stats.totals.dialogue },
            ].map((s) => (
              <div key={s.label} className="rounded-lg bg-black/[0.03] py-2 dark:bg-white/[0.04]">
                <p className="tabular text-lg font-semibold">{s.value}</p>
                <p className="text-[11px] opacity-55">{s.label}</p>
              </div>
            ))}
          </div>

          <div className="mt-3 flex items-center gap-3 text-[11px] opacity-55">
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-full bg-neutral-900" />
              被提及
            </span>
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-full bg-emerald-500" />
              台词
            </span>
          </div>

          <div className="mt-2 max-h-80 space-y-2 overflow-y-auto pr-1">
            {visible.map(({ row, chapter }) => (
              <div key={row.id}>
                <div className="flex items-baseline justify-between gap-2 text-[11px]">
                  <span className="truncate opacity-70">
                    第{(chapter?.order ?? 0) + 1}章 {chapter?.title ?? ""}
                  </span>
                  <span className="tabular shrink-0 opacity-50">
                    {row.mentioned ?? 0} 次 · {row.dialogueLines ?? 0} 句
                  </span>
                </div>
                <div className="mt-1 space-y-0.5">
                  <div className="h-1.5 overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/10">
                    <div
                      className="h-full rounded-full bg-neutral-900"
                      style={{ width: Math.round(((row.mentioned ?? 0) / stats.maxMentioned) * 100) + "%" }}
                    />
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/10">
                    <div
                      className="h-full rounded-full bg-emerald-500"
                      style={{ width: Math.round(((row.dialogueLines ?? 0) / stats.maxDialogue) * 100) + "%" }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {stats.list.length > MAX_BARS && (
            <Button className="mt-3" variant="ghost" size="sm" fullWidth onPress={() => setShowAll((v) => !v)}>
              {showAll ? "收起" : "显示全部 " + stats.list.length + " 章"}
            </Button>
          )}
        </>
      )}
    </Card>
  );
}
