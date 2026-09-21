import { Chip, Tooltip } from "@heroui/react";
import { MapPin, TriangleAlert } from "lucide-react";
import type { Chapter, Character, ID, TimelineEvent, WorldEntry } from "@/core";
import { chapterShortLabel } from "./timelineMeta";
import { CONFLICT_SEVERITY_LABELS, type TimelineConflict } from "./timelineConflicts";

/** 参与人物头像：用 emoji / 姓名首字代替真实头像，避免额外依赖。 */
export function ParticipantAvatars({
  ids,
  characters,
  max = 6,
}: {
  ids: ID[];
  characters: Character[];
  max?: number;
}) {
  const people = ids
    .map((id) => characters.find((c) => c.id === id))
    .filter((c): c is Character => Boolean(c));
  if (people.length === 0) return <span className="text-[11px] opacity-40">未指定参与人物</span>;

  const shown = people.slice(0, max);
  const rest = people.length - shown.length;

  return (
    <div className="flex items-center gap-1">
      {shown.map((c) => (
        <Tooltip key={c.id}>
          <Tooltip.Trigger>
            <span
              className="grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-medium text-white"
              style={{ backgroundColor: c.color || "#8b5cf6" }}
            >
              {c.avatarEmoji || c.name.slice(0, 1)}
            </span>
          </Tooltip.Trigger>
          <Tooltip.Content>
            {c.name}
            {c.tagline ? " · " + c.tagline : ""}
          </Tooltip.Content>
        </Tooltip>
      ))}
      {rest > 0 && <span className="text-[11px] opacity-50">+{rest}</span>}
    </div>
  );
}

/** 事件关联的章节小标签 */
export function EventChapterChips({ event, chapters }: { event: TimelineEvent; chapters: Chapter[] }) {
  if (event.chapterIds.length === 0) {
    return <Chip size="sm" color="warning">未挂章节</Chip>;
  }
  return (
    <div className="flex flex-wrap items-center gap-1">
      {event.chapterIds.map((id) => (
        <Chip key={id} size="sm">
          {chapterShortLabel(chapters, id)}
        </Chip>
      ))}
    </div>
  );
}

/** 地点：找不到条目时退化为提示 */
export function LocationLine({ event, worldEntries }: { event: TimelineEvent; worldEntries: WorldEntry[] }) {
  const entry = event.locationId ? worldEntries.find((w) => w.id === event.locationId) : undefined;
  if (!entry) return null;
  return (
    <span className="flex items-center gap-1 text-[11px] opacity-60">
      <MapPin className="size-3" />
      {entry.title}
    </span>
  );
}

/** 冲突角标 */
export function ConflictBadge({ conflicts }: { conflicts: TimelineConflict[] }) {
  if (conflicts.length === 0) return null;
  const worst = conflicts[0];
  const color = worst.severity === "error" ? "danger" : worst.severity === "warn" ? "warning" : "accent";
  return (
    <Tooltip>
      <Tooltip.Trigger>
        <span>
          <Chip size="sm" color={color}>
            <TriangleAlert className="mr-0.5 inline size-3" />
            {CONFLICT_SEVERITY_LABELS[worst.severity]}
            {conflicts.length > 1 ? " ×" + conflicts.length : ""}
          </Chip>
        </span>
      </Tooltip.Trigger>
      <Tooltip.Content>
        {conflicts.map((c) => c.title).join("；")}
      </Tooltip.Content>
    </Tooltip>
  );
}
