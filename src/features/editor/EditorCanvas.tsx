import { useEffect, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import CharacterCount from "@tiptap/extension-character-count";
import Highlight from "@tiptap/extension-highlight";
import Typography from "@tiptap/extension-typography";
import { countWords, stripHtml } from "@/utils/text";
import { ReviewMarks, type ReviewMarkData } from "./extensions/ReviewMarks";

export interface ReviewMarkInput {
  from: number;
  to: number;
  data: ReviewMarkData;
}

export interface EditorCanvasHandle {
  insertText: (text: string, mode?: "cursor" | "end" | "replace-selection") => void;
  replaceRange: (from: number, to: number, text: string) => void;
  getSelection: () => { text: string; from: number; to: number };
  /**
   * 当前选区的**纯文本偏移**（不是 ProseMirror 位置）。
   * 审稿锚点用的是纯文本偏移，所以这里做一次换算，避免各处重复实现。
   */
  getSelectionOffsets: () => { from: number; to: number; text: string } | null;
  /** 把一段纯文本偏移滚动到视野内并选中 */
  selectRange: (from: number, to: number) => void;
  focus: () => void;
}

interface Props {
  /** 章节切换时用于重载内容 */
  chapterKey: string;
  initialHtml: string;
  editable?: boolean;
  fontSize: number;
  maxWidth: number;
  fontFamily?: string;
  typewriter?: boolean;
  /** 审稿标记（批注 + 修订建议），以装饰形式叠加在正文上，不改动文档 */
  reviewMarks?: ReviewMarkInput[];
  onReady?: (handle: EditorCanvasHandle) => void;
  onChange: (html: string, words: number) => void;
  onSelectionChange?: (text: string, range: { from: number; to: number }) => void;
  onStats?: (counts: { words: number; chars: number }) => void;
}

/**
 * 正文编辑区。职责边界：
 * - 只负责编辑与回调，不直接读写数据库（保存交给 EditorPage）。
 * - 章节切换通过 chapterKey 触发内容重载，避免光标被外部更新打断。
 */
export function EditorCanvas({
  chapterKey,
  initialHtml,
  editable = true,
  fontSize,
  maxWidth,
  fontFamily,
  typewriter = false,
  reviewMarks,
  onReady,
  onChange,
  onSelectionChange,
  onStats,
}: Props) {
  const loadedKey = useRef<string>("");
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSelectionRef = useRef(onSelectionChange);
  onSelectionRef.current = onSelectionChange;
  const onStatsRef = useRef(onStats);
  onStatsRef.current = onStats;

  const editor = useEditor({
    editable,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        codeBlock: false,
        horizontalRule: false,
      }),
      Placeholder.configure({ placeholder: "从这里开始写…（⌘J 唤起 AI 续写）" }),
      CharacterCount,
      Highlight.configure({ multicolor: false }),
      Typography,
      ReviewMarks,
    ],
    content: initialHtml || "<p></p>",
    editorProps: {
      attributes: {
        class: "manuscript focus:outline-none",
        spellcheck: "false",
      },
    },
    onUpdate: ({ editor: ed }) => {
      const html = ed.getHTML();
      const words = countWords(stripHtml(html));
      onChangeRef.current(html, words);
    },
    onSelectionUpdate: ({ editor: ed }) => {
      const { from, to } = ed.state.selection;
      const text = ed.state.doc.textBetween(from, to, "\n");
      onSelectionRef.current?.(text, { from, to });
    },
    onCreate: ({ editor: ed }) => {
      const text = ed.getText();
      onStatsRef.current?.({ words: countWords(text), chars: text.replace(/\s/g, "").length });
    },
  });

  // 章节切换：只在 key 变化时替换内容
  useEffect(() => {
    if (!editor) return;
    if (loadedKey.current === chapterKey) return;
    loadedKey.current = chapterKey;
    editor.commands.setContent(initialHtml || "<p></p>", { emitUpdate: false });
    const text = editor.getText();
    onStatsRef.current?.({ words: countWords(text), chars: text.replace(/\s/g, "").length });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, chapterKey]);

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  // 审稿标记：正文内容变化后重新下发，保证偏移映射基于最新文档
  useEffect(() => {
    if (!editor) return;
    const plain = editor.state.doc.textBetween(0, editor.state.doc.content.size, "\n");
    editor.commands.setReviewMarks({ text: plain, marks: reviewMarks ?? [] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, reviewMarks, chapterKey, initialHtml]);

  // 暴露命令式接口给父组件
  useEffect(() => {
    if (!editor || !onReady) return;
    onReady({
      insertText(text, mode = "cursor") {
        const chain = editor.chain().focus();
        if (mode === "end") chain.setTextSelection(editor.state.doc.content.size).run();
        if (mode === "replace-selection") chain.deleteSelection().run();
        const paragraphs = text
          .split(/\n+/)
          .map((p) => p.trim())
          .filter(Boolean);
        for (const p of paragraphs) {
          editor.chain().focus().insertContent({ type: "paragraph", content: [{ type: "text", text: p }] }).run();
        }
      },
      replaceRange(from, to, text) {
        editor
          .chain()
          .focus()
          .setTextSelection({ from, to })
          .deleteSelection()
          .insertContent(
            text
              .split(/\n+/)
              .filter(Boolean)
              .map((p) => ({ type: "paragraph", content: [{ type: "text", text: p.trim() }] })),
          )
          .run();
      },
      getSelection() {
        const { from, to } = editor.state.selection;
        return { text: editor.state.doc.textBetween(from, to, "\n"), from, to };
      },
      getSelectionOffsets() {
        const { from, to } = editor.state.selection;
        if (from === to) return null;
        const text = editor.state.doc.textBetween(from, to, "\n");
        return { from: pmPosToOffset(editor.state.doc, from), to: pmPosToOffset(editor.state.doc, to), text };
      },
      selectRange(from, to) {
        const start = offsetToPmPos(editor.state.doc, from);
        const end = offsetToPmPos(editor.state.doc, to);
        editor.chain().focus().setTextSelection({ from: start, to: end }).run();
        const dom = editor.view.domAtPos(start);
        const el = dom.node instanceof Element ? dom.node : dom.node.parentElement;
        el?.scrollIntoView({ block: "center", behavior: "smooth" });
      },
      focus() {
        editor.commands.focus();
      },
    });
  }, [editor, onReady]);

  // 打字机滚动：让光标行保持在视口中间
  useEffect(() => {
    if (!typewriter || !editor) return;
    const onUpdate = () => {
      const sel = window.getSelection();
      const node = sel?.anchorNode;
      const el = node instanceof Element ? node : node?.parentElement;
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
    };
    editor.on("update", onUpdate);
    return () => {
      editor.off("update", onUpdate);
    };
  }, [editor, typewriter]);

  return (
    <div className="mx-auto w-full px-6 py-8" style={{ maxWidth: maxWidth || 760 }}>
      <EditorContent
        editor={editor}
        style={{ fontSize: fontSize + "px", fontFamily: fontFamily }}
      />
    </div>
  );
}

/**
 * ProseMirror 位置 → 纯文本偏移。
 * 口径必须与 doc.textBetween(0, size, "\n") 一致：块之间算一个换行，行内叶子节点算一个字符。
 */
function pmPosToOffset(doc: import("@tiptap/pm/model").Node, target: number): number {
  let offset = 0;
  let result = -1;
  doc.descendants((node, pos) => {
    if (result >= 0) return false;
    if (node.isTextblock && pos > 0) {
      if (target <= pos) {
        result = offset;
        return false;
      }
      offset += 1;
    }
    if (node.isText && node.text) {
      const end = pos + node.text.length;
      if (target <= end) {
        result = offset + Math.max(0, target - pos);
        return false;
      }
      offset += node.text.length;
    } else if (node.isLeaf && !node.isTextblock) {
      if (target <= pos + 1) {
        result = offset;
        return false;
      }
      offset += 1;
    }
    return true;
  });
  return result >= 0 ? result : offset;
}

/** 纯文本偏移 → ProseMirror 位置 */
function offsetToPmPos(doc: import("@tiptap/pm/model").Node, offset: number): number {
  let seen = 0;
  let result = -1;
  doc.descendants((node, pos) => {
    if (result >= 0) return false;
    if (node.isTextblock && pos > 0) {
      if (offset <= seen) {
        result = pos;
        return false;
      }
      seen += 1;
    }
    if (node.isText && node.text) {
      const len = node.text.length;
      if (offset <= seen + len) {
        result = pos + (offset - seen);
        return false;
      }
      seen += len;
    } else if (node.isLeaf && !node.isTextblock) {
      if (offset <= seen) {
        result = pos;
        return false;
      }
      seen += 1;
    }
    return true;
  });
  return result >= 0 ? result : doc.content.size;
}
