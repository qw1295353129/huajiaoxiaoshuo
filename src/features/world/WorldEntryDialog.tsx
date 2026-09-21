import { Button } from "@heroui/react";
import { X } from "lucide-react";
import type { ID, WorldEntry } from "@/core";
import { EntryEditor } from "./EntryEditor";
import type { TitleIndex } from "./world-links";

/**
 * 世界观条目的编辑弹窗。
 *
 * ## 为什么从右侧面板改成弹窗
 *
 * 原来编辑区是列表右边的一栏。问题是：**列表被挤窄、编辑区又太宽**。
 * 调过列宽（列表 380 / 编辑上限 680）之后仍然别扭 —— 因为只要编辑区常驻，
 * 列表就永远要让出一大块横向空间，而作者在浏览条目时并不需要编辑区。
 *
 * 改成弹窗后：**列表占满整页**，编辑时才浮出来。浏览和编辑彻底分开。
 *
 * 内容直接复用 EntryEditor（flat 模式），不复制表单 ——
 * 字段有二十来个，两份必然会改漏。
 */
export function WorldEntryDialog({
  open,
  onClose,
  projectId,
  entry,
  isNew,
  entries,
  titleIndex,
  incoming,
  outgoing,
  onSelect,
  onSaved,
  onDeleted,
  onQuickCreate,
}: {
  open: boolean;
  onClose: () => void;
  projectId: ID;
  entry?: WorldEntry;
  isNew: boolean;
  entries: WorldEntry[];
  titleIndex: TitleIndex;
  incoming: Map<ID, ID[]>;
  outgoing: Map<ID, ID[]>;
  onSelect: (id: ID) => void;
  onSaved: (id: ID) => void;
  onDeleted: () => void;
  onQuickCreate: (title: string) => Promise<void>;
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-black/5 px-5 py-3 dark:border-white/5">
          <h3 className="text-sm font-semibold">{isNew ? "新建条目" : "编辑条目"}</h3>
          <Button isIconOnly size="sm" variant="ghost" aria-label="关闭" onPress={onClose}>
            <X className="size-4" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <EntryEditor
            flat
            projectId={projectId}
            entry={entry}
            isNew={isNew}
            entries={entries}
            titleIndex={titleIndex}
            incoming={incoming}
            outgoing={outgoing}
            onSelect={onSelect}
            onSaved={(id) => {
              onSaved(id);
              onClose();
            }}
            onDeleted={() => {
              onDeleted();
              onClose();
            }}
            onQuickCreate={onQuickCreate}
          />
        </div>
      </div>
    </div>
  );
}
