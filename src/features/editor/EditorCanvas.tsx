import { useEffect, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import CharacterCount from "@tiptap/extension-character-count";
import Highlight from "@tiptap/extension-highlight";
import Typography from "@tiptap/extension-typography";
import { countWords, stripHtml } from "@/utils/text";

export interface EditorCanvasHandle {
  insertText: (text: string, mode?: "cursor" | "end" | "replace-selection") => void;
  replaceRange: (from: number, to: number, text: string) => void;
  getSelection: () => { text: string; from: number; to: number };
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
