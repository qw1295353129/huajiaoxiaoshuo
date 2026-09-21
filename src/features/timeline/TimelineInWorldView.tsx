import { Button, Card, Chip } from "@heroui/react";
import { Clock, Pencil, Timer, Trash2 } from "lucide-react";
import type { Chapter, Character, TimelineEvent, WorldEntry } from "@/core";
import { ConflictBadge, EventChapterChips, LocationLine, ParticipantAvatars } from "./TimelineEventBits";
import { importanceHex, importanceLabel, importanceTone } from "./timelineMeta";
import { DIVIDER_CLASS } from "./styles";
import type { TimelineConflict } from "./timelineConflicts";

/**
 * 剧情内时间轴：按剧情内时间 + 排序键排列的垂直时间轴，
 * 相同时间标签的事件归到同一个时间节点下。
 */
export function TimelineInWorldView({
  events,
  chapters,
  characters,
  worldEntries,
  conflictMap,
  highlightedId,
  onEdit,
  onDelete,
}: {
  events: TimelineEvent[];
  chapters: Chapter[];
  characters: Character[];
  worldEntries: WorldEntry[];
  conflictMap: Map<string, TimelineConflict[]>;
  highlightedId?: string;
  onEdit: (event: TimelineEvent) => void;
  onDelete: (event: TimelineEvent) => void;
}) {
  /** 连续相同的时间标签合成一组 */
  const groups: { label: string; items: TimelineEvent[] }[] = [];
  for (const event of events) {
    const label = event.inWorldTime.trim() || "时间未标注";
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(event);
    else groups.push({ label, items: [event] });
  }

  return (
    <div className="space-y-6">
      {groups.map((group, groupIndex) => (
        <section key={group.label + "-" + groupIndex}>
          <div className="mb-3 flex items-center gap-2">
            <span className="grid size-6 place-items-center rounded-full bg-neutral-900/12 text-neutral-700">
              <Clock className="size-3.5" />
            </span>
            <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">{group.label}</h3>
            <span className="text-[11px] opacity-45">{group.items.length} 个事件</span>
          </div>

          <div className="relative pl-4">
            <div className="absolute bottom-2 left-[5px] top-2 w-px bg-black/10 dark:bg-white/10" />
            <div className="space-y-3">
              {group.items.map((event) => {
                const conflicts = conflictMap.get(event.id) ?? [];
                const highlighted = highlightedId === event.id;
                return (
                  <div key={event.id} id={"tl-evt-" + event.id} className="relative">
                    <span
                      className="absolute -left-4 top-4 size-2.5 rounded-full ring-4 ring-neutral-50 dark:ring-neutral-950"
                      style={{ backgroundColor: importanceHex(event.importance) }}
                    />
                    <Card className={"p-4 transition " + (highlighted ? "ring-2 ring-neutral-900/60" : "")}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <h4 className="text-sm font-semibold">{event.title}</h4>
                            <Chip size="sm" color={importanceTone(event.importance)}>
                              {"★".repeat(event.importance)} {importanceLabel(event.importance)}
                            </Chip>
                            {event.durationDays !== undefined && event.durationDays > 0 && (
                              <Chip size="sm" color="default">
                                <Timer className="mr-0.5 inline size-3" />
                                {event.durationDays} 天
                              </Chip>
                            )}
                            <ConflictBadge conflicts={conflicts} />
                          </div>
                          {event.description && (
                            <p className="mt-2 text-xs leading-relaxed opacity-70">{event.description}</p>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <Button size="sm" variant="ghost" isIconOnly aria-label="编辑事件" onPress={() => onEdit(event)}>
                            <Pencil className="size-4" />
                          </Button>
                          <Button size="sm" variant="ghost" isIconOnly aria-label="删除事件" onPress={() => onDelete(event)}>
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </div>

                      <div className={"mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-2.5 " + DIVIDER_CLASS}>
                        <ParticipantAvatars ids={event.participantIds} characters={characters} />
                        <LocationLine event={event} worldEntries={worldEntries} />
                        <EventChapterChips event={event} chapters={chapters} />
                        <span className="tabular ml-auto text-[11px] opacity-35">#{event.orderKey}</span>
                      </div>
                    </Card>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}
