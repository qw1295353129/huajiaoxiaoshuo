import { useMemo, useState } from "react";
import { Button, Card, Tooltip } from "@heroui/react";
import { ChevronLeft, ChevronRight, Loader2, ScanSearch } from "lucide-react";
import type { Chapter, PlotThread } from "@/core";
import { getChapterContent } from "@/db/repo/outline";
import { scanKnownNames, type KnownName } from "@/utils/entity-scan";
import { useAppStore } from "@/app/store";
import { THREAD_KIND_LABELS, THREAD_PRIORITY_LABELS, chapterOrder } from "./threadMeta";
import { DIVIDER_CLASS } from "./styles";

/** 每页显示的章节数（横轴窗口） */
const PAGE_SIZE = 36;
/** 单次扫描的最大章节数，避免一次性读入上千章正文 */
const SCAN_LIMIT = 120;

type CellKind = "plant" | "payoff" | "planned" | "mentioned" | "gap" | "before" | "plain";

const CELL_CLASS: Record<CellKind, string> = {
  plant: "bg-neutral-900",
  payoff: "bg-emerald-500",
  planned: "bg-amber-400/80 ring-1 ring-inset ring-amber-600/70",
  mentioned: "bg-black/25",
  gap: "bg-rose-400/25",
  before: "bg-black/[0.035] dark:bg-white/[0.04]",
  plain: "bg-black/[0.07] dark:bg-white/[0.07]",
};

const LEGEND: { kind: CellKind; label: string }[] = [
  { kind: "plant", label: "埋设点" },
  { kind: "planned", label: "计划回收" },
  { kind: "payoff", label: "实际回收" },
  { kind: "mentioned", label: "正文有提及" },
  { kind: "gap", label: "埋下后未再提及" },
  { kind: "before", label: "埋设之前" },
];

/**
 * 伏笔热力图：横轴章节序号、纵轴每条伏笔。
 * 埋设 / 计划回收 / 实际回收 / 正文是否提及用不同颜色区分，中间的空档一眼可见。
 */
export function ThreadHeatmap({
  threads,
  chapters,
  onEditThread,
}: {
  threads: PlotThread[];
  chapters: Chapter[];
  onEditThread: (thread: PlotThread) => void;
}) {
  const notify = useAppStore((s) => s.notify);
  const [page, setPage] = useState(0);
  const [mentionMap, setMentionMap] = useState<Record<string, string[]>>({});
  const [scannedIds, setScannedIds] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);

  /** 按 order 升序的章节 */
  const ordered = useMemo(() => [...chapters].sort((a, b) => a.order - b.order), [chapters]);
  const pageCount = Math.max(1, Math.ceil(ordered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const windowChapters = useMemo(
    () => ordered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE),
    [ordered, safePage],
  );

  /** 行：按优先级排序后的伏笔 */
  const rows = useMemo(() => {
    const weight: Record<PlotThread["priority"], number> = { main: 0, major: 1, minor: 2 };
    return [...threads].sort((a, b) => weight[a.priority] - weight[b.priority] || a.title.localeCompare(b.title, "zh"));
  }, [threads]);

  /** 扫描窗口内章节正文，统计每条伏笔是否被提到 */
  const runScan = async () => {
    if (rows.length === 0) {
      notify("info", "还没有伏笔可以扫描");
      return;
    }
    if (windowChapters.length > SCAN_LIMIT) {
      notify("warning", "本页章节过多，请分页后再扫描");
      return;
    }
    setScanning(true);
    const names: KnownName[] = rows.map((t) => ({ id: t.id, name: t.title, aliases: [] }));
    const next = { ...mentionMap };
    const scanned: string[] = [];
    try {
      for (const chapter of windowChapters) {
        const content = await getChapterContent(chapter.id);
        const text = content?.text ?? "";
        next[chapter.id] = text ? scanKnownNames(text, names).map((h) => h.refId ?? "").filter(Boolean) : [];
        scanned.push(chapter.id);
      }
      setMentionMap(next);
      setScannedIds((prev) => Array.from(new Set([...prev, ...scanned])));
      const hits = scanned.reduce((sum, id) => sum + (next[id]?.length ?? 0), 0);
      notify("success", "正文提及扫描完成", "本页 " + scanned.length + " 章共命中 " + hits + " 处提及");
    } catch (e) {
      notify("danger", "扫描失败", e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  };

  const classify = (thread: PlotThread, chapter: Chapter): CellKind => {
    if (thread.plantedChapterId === chapter.id) return "plant";
    if (thread.payoffChapterId === chapter.id) return "payoff";
    if (thread.plannedPayoffChapterId === chapter.id) return "planned";

    const order = chapter.order;
    const planted = chapterOrder(chapters, thread.plantedChapterId);
    const end = chapterOrder(chapters, thread.payoffChapterId) ?? chapterOrder(chapters, thread.plannedPayoffChapterId);
    const mentioned = (mentionMap[chapter.id] ?? []).includes(thread.id);

    if (planted !== undefined && order < planted) return "before";
    if (mentioned) return "mentioned";
    if (planted !== undefined && end !== undefined && order > planted && order < end) return "gap";
    if (planted !== undefined && end === undefined && order > planted) return "gap";
    return "plain";
  };

  if (ordered.length === 0) {
    return (
      <Card className="p-6 text-center text-sm opacity-60">
        还没有章节，先在大纲里建立章节，热力图才有可对照的横轴。
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <Card className="p-6 text-center text-sm opacity-60">
        当前筛选条件下没有伏笔，清空筛选或新建一条伏笔后再看热力图。
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">伏笔热力图</p>
          <p className="mt-0.5 text-xs opacity-55">
            横轴为章节序号（每页 {PAGE_SIZE} 章），纵轴为伏笔；点击左侧标题即可编辑。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" isPending={scanning} onPress={runScan}>
            {scanning ? <Loader2 className="size-4" /> : <ScanSearch className="size-4" />}
            扫描正文提及
          </Button>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" isIconOnly aria-label="上一页章节" isDisabled={safePage <= 0} onPress={() => setPage(Math.max(0, safePage - 1))}>
              <ChevronLeft className="size-4" />
            </Button>
            <span className="tabular min-w-[86px] text-center text-xs opacity-60">
              {safePage * PAGE_SIZE + 1}–{Math.min(ordered.length, (safePage + 1) * PAGE_SIZE)} / {ordered.length} 章
            </span>
            <Button
              size="sm"
              variant="ghost"
              isIconOnly
              aria-label="下一页章节"
              isDisabled={safePage >= pageCount - 1}
              onPress={() => setPage(Math.min(pageCount - 1, safePage + 1))}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-max">
          {/* 表头：章节序号 */}
          <div className="flex items-center">
            <div className="w-56 shrink-0" />
            <div className="flex gap-[2px] pl-2">
              {windowChapters.map((c) => (
                <Tooltip key={c.id}>
                  <Tooltip.Trigger>
                    <div className="tabular w-5 cursor-default text-center text-[10px] opacity-45">{c.order + 1}</div>
                  </Tooltip.Trigger>
                  <Tooltip.Content>
                    第{c.order + 1}章 {c.title}
                  </Tooltip.Content>
                </Tooltip>
              ))}
            </div>
          </div>

          {/* 每行一条伏笔 */}
          <div className={"mt-1 max-h-[62vh] space-y-[3px] overflow-y-auto border-t pt-2 " + DIVIDER_CLASS}>
            {rows.map((thread) => (
              <div key={thread.id} className="flex items-center rounded-lg transition hover:bg-black/[0.03] dark:hover:bg-white/[0.04]">
                <button
                  type="button"
                  onClick={() => onEditThread(thread)}
                  className="flex w-56 shrink-0 items-center gap-1.5 pr-2 text-left"
                  title={THREAD_KIND_LABELS[thread.kind] + " · " + THREAD_PRIORITY_LABELS[thread.priority]}
                >
                  <span className="truncate text-xs">{thread.title}</span>
                  <span className="shrink-0 text-[10px] opacity-35">{THREAD_KIND_LABELS[thread.kind]}</span>
                </button>
                <div className="flex gap-[2px] pl-2">
                  {windowChapters.map((chapter) => {
                    const kind = classify(thread, chapter);
                    const label =
                      "第" + (chapter.order + 1) + "章 " + chapter.title + " · " + cellLabel(kind, thread.title);
                    return <div key={chapter.id} title={label} className={"h-5 w-5 rounded-[3px] " + CELL_CLASS[kind]} />;
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className={"mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-3 " + DIVIDER_CLASS}>
        {LEGEND.map((item) => (
          <span key={item.kind} className="flex items-center gap-1.5 text-[11px] opacity-65">
            <span className={"inline-block size-3 rounded-[3px] " + CELL_CLASS[item.kind]} />
            {item.label}
          </span>
        ))}
        <span className="text-[11px] opacity-45">
          已扫描 {scannedIds.length} 章正文；「正文有提及」按伏笔标题在正文中匹配，标题与正文用词不同时会漏检。
        </span>
      </div>
    </Card>
  );
}

function cellLabel(kind: CellKind, title: string): string {
  switch (kind) {
    case "plant":
      return "「" + title + "」埋设于此";
    case "planned":
      return "计划回收「" + title + "」";
    case "payoff":
      return "「" + title + "」在此回收";
    case "mentioned":
      return "正文提到「" + title + "」";
    case "gap":
      return "埋下后未再提到「" + title + "」";
    case "before":
      return "「" + title + "」尚未埋设";
    default:
      return "未提及「" + title + "」";
  }
}
