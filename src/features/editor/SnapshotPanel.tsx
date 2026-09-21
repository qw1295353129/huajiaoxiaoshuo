import { useState } from "react";
import { Button, Chip } from "@heroui/react";
import { Camera, RotateCcw, Trash2, X } from "lucide-react";
import type { Chapter, Snapshot } from "@/core";
import { useAppStore } from "@/app/store";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db/database";
import { createSnapshot, deleteSnapshot, restoreSnapshot } from "@/db/repo/outline";
import { formatDateTime, formatWords } from "@/utils/format";
import { useEditorStore } from "./editorStore";

const KIND_LABEL: Record<Snapshot["kind"], string> = {
  manual: "手动",
  auto: "自动",
  "pre-ai": "AI 前",
  "post-ai": "AI 后",
  import: "导入",
};

/** 版本快照面板：手动存档、对比、恢复 */
export function SnapshotPanel({
  chapter,
  onClose,
  onRestore,
}: {
  chapter: Chapter;
  onClose: () => void;
  onRestore: (snapshotId: string) => Promise<void>;
}) {
  const notify = useAppStore((s) => s.notify);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Snapshot | null>(null);
  const snapshots = useLiveQuery(
    () => db.snapshots.where("chapterId").equals(chapter.id).reverse().sortBy("createdAt"),
    [chapter.id],
    [] as Snapshot[],
  );

  const handleCreate = async () => {
    setBusy(true);
    try {
      const s = await createSnapshot(chapter.id, "手动存档", "manual");
      if (s) notify("success", "已创建快照", formatWords(s.wordCount));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full w-[380px] flex-col border-l border-black/5 dark:border-white/5">
      <div className="flex shrink-0 items-center justify-between border-b border-black/5 px-4 py-3 dark:border-white/5">
        <div>
          <p className="text-sm font-medium">版本快照</p>
          <p className="text-[11px] opacity-50">{snapshots.length} 个版本</p>
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" isPending={busy} onPress={() => void handleCreate()}>
            <Camera className="size-3.5" />
            存档
          </Button>
          <Button isIconOnly size="sm" variant="ghost" onPress={onClose}>
            <X className="size-4" />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {snapshots.length === 0 && (
          <p className="px-3 py-10 text-center text-xs leading-relaxed opacity-50">
            还没有快照。
            <br />
            写作过程中每 {useEditorStore.getState().wordCount > 0 ? "若干" : ""} 分钟会自动存档，
            也可以在重要改动前手动存一个。
          </p>
        )}

        <ul className="space-y-2">
          {snapshots.map((s) => (
            <li
              key={s.id}
              className="rounded-xl border border-black/8 p-3 transition hover:border-black/25 dark:border-white/10"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium">{s.label}</p>
                  <p className="mt-0.5 text-[10px] opacity-50">
                    {formatDateTime(s.createdAt)} · {formatWords(s.wordCount)}
                  </p>
                </div>
                <Chip size="sm" color={s.kind === "manual" ? "accent" : "default"}>
                  {KIND_LABEL[s.kind]}
                </Chip>
              </div>
              <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed opacity-60">{s.text.slice(0, 120)}</p>
              <div className="mt-2 flex items-center gap-1.5">
                <Button
                  size="sm"
                  variant="ghost"
                  onPress={async () => {
                    if (!confirm("恢复到该版本？当前内容会先自动备份。")) return;
                    await onRestore(s.id);
                  }}
                >
                  <RotateCcw className="size-3" />
                  恢复
                </Button>
                <Button size="sm" variant="ghost" onPress={() => setPreview(s)}>
                  预览
                </Button>
                <Button
                  isIconOnly
                  size="sm"
                  variant="ghost"
                  onPress={async () => {
                    await deleteSnapshot(s.id);
                  }}
                >
                  <Trash2 className="size-3" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {preview && (
        <div className="absolute inset-0 z-50 flex flex-col bg-white/98 backdrop-blur dark:bg-neutral-950/98">
          <div className="flex shrink-0 items-center justify-between border-b border-black/5 px-4 py-3 dark:border-white/5">
            <p className="text-sm font-medium">{preview.label}</p>
            <Button isIconOnly size="sm" variant="ghost" onPress={() => setPreview(null)}>
              <X className="size-4" />
            </Button>
          </div>
          <div className="manuscript min-h-0 flex-1 overflow-y-auto px-5 py-4 text-[13px]">{preview.text}</div>
          <div className="shrink-0 border-t border-black/5 p-3 dark:border-white/5">
            <Button
              size="sm"
              variant="primary"
              fullWidth
              onPress={async () => {
                if (confirm("恢复到该版本？")) {
                  await restoreSnapshot(preview.id);
                  setPreview(null);
                  await onRestore(preview.id);
                }
              }}
            >
              恢复到该版本
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
