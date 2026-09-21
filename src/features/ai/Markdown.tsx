import type { ReactNode } from "react";

/**
 * 极简 Markdown 渲染器（自研，无第三方依赖）。
 * 支持：**加粗**、*斜体*、`行内代码`、代码块、标题、有序/无序列表、引用、分割线。
 * 全部用 React 元素拼装，不做 dangerouslySetInnerHTML，因此天然免疫 XSS。
 */

const INLINE_RE = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\n]+\*)/g;

/** 行内标记 */
function inline(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(INLINE_RE);
  const out: ReactNode[] = [];
  parts.forEach((part, i) => {
    if (!part) return;
    const key = keyPrefix + "-" + i;
    if (part.length > 4 && part.startsWith("**") && part.endsWith("**")) {
      out.push(
        <strong key={key} className="font-semibold">
          {part.slice(2, -2)}
        </strong>,
      );
      return;
    }
    if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) {
      out.push(
        <code key={key} className="rounded bg-black/[0.06] px-1 py-0.5 font-mono text-[0.85em] dark:bg-white/10">
          {part.slice(1, -1)}
        </code>,
      );
      return;
    }
    if (part.length > 2 && part.startsWith("*") && part.endsWith("*")) {
      out.push(
        <em key={key} className="italic opacity-90">
          {part.slice(1, -1)}
        </em>,
      );
      return;
    }
    out.push(<span key={key}>{part}</span>);
  });
  return out;
}

const BULLET_RE = /^\s*[-*+]\s+/;
const ORDERED_RE = /^\s*\d+[.)]\s+/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const QUOTE_RE = /^\s*>\s?/;
const HR_RE = /^\s*([-*_])\1{2,}\s*$/;
const FENCE_RE = /^\s*```/;

export function Markdown({ text, className }: { text: string; className?: string }) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let cursor = 0;
  let seq = 0;
  const key = () => "md-" + seq++;

  while (cursor < lines.length) {
    const line = lines[cursor].trimEnd();

    // 代码块
    if (FENCE_RE.test(line)) {
      const buffer: string[] = [];
      cursor += 1;
      while (cursor < lines.length && !FENCE_RE.test(lines[cursor])) {
        buffer.push(lines[cursor]);
        cursor += 1;
      }
      cursor += 1;
      blocks.push(
        <pre
          key={key()}
          className="my-2 overflow-x-auto rounded-lg bg-black/[0.05] p-3 text-xs leading-relaxed dark:bg-white/[0.06]"
        >
          <code className="font-mono">{buffer.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    if (!line.trim()) {
      cursor += 1;
      continue;
    }

    // 分割线
    if (HR_RE.test(line)) {
      blocks.push(<hr key={key()} className="my-3 border-black/10 dark:border-white/10" />);
      cursor += 1;
      continue;
    }

    // 标题
    const heading = HEADING_RE.exec(line);
    if (heading) {
      const level = heading[1].length;
      const cls =
        level <= 1
          ? "mt-3 mb-1.5 text-base font-semibold"
          : level === 2
            ? "mt-3 mb-1.5 text-sm font-semibold"
            : "mt-2.5 mb-1 text-sm font-medium";
      blocks.push(
        <p key={key()} className={cls}>
          {inline(heading[2], key())}
        </p>,
      );
      cursor += 1;
      continue;
    }

    // 引用
    if (QUOTE_RE.test(line)) {
      const buffer: string[] = [];
      while (cursor < lines.length && QUOTE_RE.test(lines[cursor])) {
        buffer.push(lines[cursor].replace(QUOTE_RE, ""));
        cursor += 1;
      }
      blocks.push(
        <blockquote
          key={key()}
          className="my-2 space-y-1 border-l-2 border-violet-500/40 pl-3 text-[13px] leading-relaxed opacity-75"
        >
          {buffer.map((b, bi) => (
            <p key={bi}>{inline(b, key() + "-" + bi)}</p>
          ))}
        </blockquote>,
      );
      continue;
    }

    // 无序列表
    if (BULLET_RE.test(line)) {
      const items: string[] = [];
      while (cursor < lines.length && BULLET_RE.test(lines[cursor])) {
        items.push(lines[cursor].replace(BULLET_RE, ""));
        cursor += 1;
      }
      blocks.push(
        <ul key={key()} className="my-2 ml-4 list-disc space-y-1">
          {items.map((it, ii) => (
            <li key={ii} className="leading-relaxed">
              {inline(it, key() + "-" + ii)}
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    // 有序列表
    if (ORDERED_RE.test(line)) {
      const items: string[] = [];
      while (cursor < lines.length && ORDERED_RE.test(lines[cursor])) {
        items.push(lines[cursor].replace(ORDERED_RE, ""));
        cursor += 1;
      }
      blocks.push(
        <ol key={key()} className="my-2 ml-4 list-decimal space-y-1">
          {items.map((it, ii) => (
            <li key={ii} className="leading-relaxed">
              {inline(it, key() + "-" + ii)}
            </li>
          ))}
        </ol>,
      );
      continue;
    }

    // 段落：一直吃到空行或下一个块级标记
    const paragraph: string[] = [line];
    cursor += 1;
    while (
      cursor < lines.length &&
      lines[cursor].trim() &&
      !BULLET_RE.test(lines[cursor]) &&
      !ORDERED_RE.test(lines[cursor]) &&
      !HEADING_RE.test(lines[cursor]) &&
      !QUOTE_RE.test(lines[cursor]) &&
      !HR_RE.test(lines[cursor]) &&
      !FENCE_RE.test(lines[cursor])
    ) {
      paragraph.push(lines[cursor].trimEnd());
      cursor += 1;
    }
    blocks.push(
      <p key={key()} className="my-1.5 whitespace-pre-wrap leading-relaxed">
        {inline(paragraph.join("\n"), key())}
      </p>,
    );
  }

  return <div className={className}>{blocks}</div>;
}
