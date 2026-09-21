import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";

/**
 * 审稿标记扩展。
 *
 * 设计：审稿数据（评论、修订建议）锚定在**纯文本偏移**上，
 * 这里把它们渲染成 ProseMirror 装饰（decoration），不改动文档本身。
 * 好处是接受/拒绝建议时文档结构不会被污染，撤销栈也保持干净。
 */

export interface ReviewMarkData {
  kind: "comment" | "replace" | "delete" | "insert";
  id: string;
  /** 是否已解决（评论）或已处理（建议）——已处理的不再高亮 */
  muted?: boolean;
  label?: string;
}

export interface ReviewMarksOptions {
  /** 当前正文纯文本，用于建立偏移映射 */
  text: string;
  marks: { from: number; to: number; data: ReviewMarkData }[];
}

export const reviewMarksKey = new PluginKey<ReviewMarksOptions>("reviewMarks");

/**
 * 把纯文本偏移映射到 ProseMirror 文档位置。
 * 必须与 doc.textBetween(0, size, "\n") 的口径一致，否则标记会错位。
 */
export function buildOffsetMap(doc: PMNode): number[] {
  const map: number[] = [];
  let pos = 0;
  const pushChar = (p: number) => map.push(p);
  doc.descendants((node, nodePos) => {
    if (node.isTextblock && nodePos > 0 && map.length > 0) {
      // 块之间用 \n 连接（与 textBetween 一致），这个虚拟换行映射到块起点
      pushChar(nodePos);
    }
    if (node.isText && node.text) {
      for (let i = 0; i < node.text.length; i++) pushChar(nodePos + i);
    }
    return true;
  });
  // 末尾位置，便于表示"到最后一个字符结束"
  map.push(doc.content.size);
  return map;
}

function buildDecorations(state: EditorState, opts: ReviewMarksOptions): DecorationSet {
  const map = buildOffsetMap(state.doc);
  const decos: Decoration[] = [];
  for (const m of opts.marks) {
    const from = map[Math.max(0, Math.min(m.from, map.length - 1))];
    const to = map[Math.max(0, Math.min(m.to, map.length - 1))];
    if (from === undefined || to === undefined || to <= from) continue;
    const { kind, id, muted, label } = m.data;
    const cls = [
      "hj-review",
      "hj-review--" + kind,
      muted ? "hj-review--muted" : "",
    ]
      .filter(Boolean)
      .join(" ");
    decos.push(
      Decoration.inline(from, to, {
        class: cls,
        "data-review-id": id,
        "data-review-kind": kind,
        title: label ?? "",
      }),
    );
  }
  return DecorationSet.create(state.doc, decos);
}

/**
 * 扩展本体。
 * 通过 editor.commands.setReviewMarks({ text, marks }) 更新标记。
 */
export const ReviewMarks = Extension.create<{ marks: ReviewMarksOptions["marks"]; text: string }>({
  name: "reviewMarks",

  addOptions() {
    return { marks: [], text: "" };
  },

  addCommands() {
    return {
      setReviewMarks:
        (opts: ReviewMarksOptions) =>
        ({ tr, dispatch }: { tr: import("@tiptap/pm/state").Transaction; dispatch?: (tr: import("@tiptap/pm/state").Transaction) => void }) => {
          if (dispatch) {
            tr.setMeta(reviewMarksKey, opts);
            dispatch(tr);
          }
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<ReviewMarksOptions>({
        key: reviewMarksKey,
        state: {
          init: (_config, state) => ({ text: "", marks: [] }),
          apply: (tr, value, _old, newState) => {
            const meta = tr.getMeta(reviewMarksKey) as ReviewMarksOptions | undefined;
            if (meta) return meta;
            // 文档变了但标记没更新：按新文档重新定位会不准，直接清空更安全（父组件会立刻重设）
            if (tr.docChanged) return value;
            return value;
          },
        },
        props: {
          decorations(state) {
            const value = reviewMarksKey.getState(state) as ReviewMarksOptions | undefined;
            if (!value || !value.marks?.length) return DecorationSet.empty;
            return buildDecorations(state, value);
          },
        },
      }),
    ];
  },
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    reviewMarks: {
      /** 设置/更新审稿标记 */
      setReviewMarks: (opts: ReviewMarksOptions) => ReturnType;
    };
  }
}