import { useState, type KeyboardEvent, type ReactNode } from "react";
import { Button, Card, Modal } from "@heroui/react";
import { Plus, X } from "lucide-react";
import type { Character } from "@/core";
import { avatarClass, avatarInitial, splitTags } from "./meta";

/**
 * 人物模块内部的小组件：原生表单 + Tailwind，HeroUI 只用来做卡片/按钮/弹窗。
 * 不放进 components/common，因为只有人物页在用。
 */

const FIELD_BASE =
  "w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm leading-relaxed outline-none transition " +
  "placeholder:text-black/30 focus:border-violet-400 focus:ring-2 focus:ring-violet-500/15 " +
  "disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-neutral-900 dark:placeholder:text-white/25";

export const inputClass = FIELD_BASE;
export const selectClass = FIELD_BASE + " cursor-pointer";
export const textareaClass = FIELD_BASE + " resize-y";

/** 圆形头像：优先 emoji，其次名字首字 + 稳定配色 */
export function CharacterAvatar({
  character,
  size = 40,
  className,
}: {
  character: Pick<Character, "id" | "name" | "avatarEmoji">;
  size?: number;
  className?: string;
}) {
  const emoji = character.avatarEmoji?.trim();
  return (
    <span
      className={
        "grid shrink-0 select-none place-items-center rounded-full font-semibold " +
        avatarClass(character.id) +
        " " +
        (className ?? "")
      }
      style={{ width: size, height: size, fontSize: Math.round(size * (emoji ? 0.5 : 0.42)) }}
      aria-hidden
    >
      {emoji || avatarInitial(character.name)}
    </span>
  );
}

/** 表单行：标签 + 控件 + 说明 */
export function Labeled({
  label,
  hint,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={"block " + (className ?? "")}>
      <span className="mb-1 block text-xs font-medium opacity-60">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] leading-relaxed opacity-45">{hint}</span> : null}
    </label>
  );
}

/**
 * 标签式多行输入：Enter / 逗号 / 顿号 分隔，退格删最后一个。
 * 用于能力、别名、爱用词、绝不会说的话这类数组字段。
 */
export function TagEditor({
  value,
  onChange,
  placeholder = "输入后回车添加",
  emptyHint,
  tone = "default",
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  emptyHint?: string;
  tone?: "default" | "danger";
}) {
  const [text, setText] = useState("");

  const add = (raw: string) => {
    const parts = splitTags(raw);
    if (!parts.length) return;
    const next = [...value];
    for (const p of parts) if (!next.includes(p)) next.push(p);
    onChange(next);
    setText("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // 中文输入法回车确认候选词时不要当作提交
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter") {
      e.preventDefault();
      add(text);
      return;
    }
    if (e.key === "Backspace" && !text && value.length) {
      onChange(value.slice(0, -1));
    }
  };

  const chipTone =
    tone === "danger"
      ? "border-rose-500/25 bg-rose-500/10 text-rose-600 dark:text-rose-300"
      : "border-black/10 bg-black/[0.04] dark:border-white/10 dark:bg-white/[0.06]";

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {value.map((tag) => (
          <span
            key={tag}
            className={"inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs " + chipTone}
          >
            {tag}
            <button
              type="button"
              aria-label={"删除 " + tag}
              className="opacity-45 transition hover:opacity-100"
              onClick={() => onChange(value.filter((t) => t !== tag))}
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="mt-1.5 flex items-center gap-1.5">
        <input
          className={inputClass}
          value={text}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => add(text)}
        />
        <Button
          size="sm"
          variant="ghost"
          isIconOnly
          aria-label="添加"
          isDisabled={!text.trim()}
          onPress={() => add(text)}
        >
          <Plus className="size-4" />
        </Button>
      </div>
      {emptyHint && !value.length ? <p className="mt-1 text-[11px] opacity-45">{emptyHint}</p> : null}
    </div>
  );
}

/** 分部编辑卡片：右上角保存按钮按区块提交 */
export function SectionCard({
  title,
  hint,
  icon,
  actions,
  dirty,
  saving,
  onSave,
  saveLabel = "保存",
  accent,
  children,
}: {
  title: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  dirty?: boolean;
  saving?: boolean;
  onSave?: () => void;
  saveLabel?: string;
  accent?: boolean;
  children: ReactNode;
}) {
  return (
    <Card
      className={
        "p-4 " +
        (accent ? "ring-1 ring-violet-500/25 dark:ring-violet-400/20" : "")
      }
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-sm font-semibold tracking-tight">
            {icon}
            <span className="truncate">{title}</span>
            {dirty ? <span className="size-1.5 rounded-full bg-violet-500" title="有未保存的修改" /> : null}
          </div>
          {hint ? <p className="mt-0.5 text-xs leading-relaxed opacity-55">{hint}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {actions}
          {onSave ? (
            <Button
              size="sm"
              variant={dirty ? "primary" : "ghost"}
              isDisabled={!dirty}
              isPending={saving}
              onPress={onSave}
            >
              {dirty ? saveLabel : "已保存"}
            </Button>
          ) : null}
        </div>
      </div>
      {children}
    </Card>
  );
}

/** 二次确认弹窗（删除人物 / 删除关系等破坏性操作） */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "删除",
  isPending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  isPending?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Modal isOpen={open} onOpenChange={onOpenChange}>
      <Modal.Backdrop>
        <Modal.Container size="sm">
          <Modal.Dialog aria-label={title}>
            <Modal.Header>
              <Modal.Heading>{title}</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <div className="text-sm leading-relaxed opacity-70">{description}</div>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="ghost" size="sm" onPress={() => onOpenChange(false)} isDisabled={isPending}>
                取消
              </Button>
              <Button variant="danger" size="sm" isPending={isPending} onPress={onConfirm}>
                {confirmLabel}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

/** 空数据提示行（面板里的小空态，比整块 EmptyHint 轻） */
export function MiniEmpty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-black/10 px-3 py-4 text-center text-xs leading-relaxed opacity-50 dark:border-white/10">
      {children}
    </p>
  );
}
