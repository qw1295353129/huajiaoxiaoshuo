import { escapeHtml, stripHtml } from "./text";

/**
 * 中文正文文本 → HTML（TipTap 文档）。
 * 约定：中文写作里换行就是分段；空行也当分段，避免用户粘贴双换行时被合并。
 */
export function textToDoc(text: string): string {
  const trimmed = text.replace(/\r\n?/g, "\n").trim();
  if (!trimmed) return "<p></p>";
  const paragraphs = trimmed
    .split(/\n/)
    .map((line) => line.replace(/^[\u3000\s]+/, "").trim())
    .filter((line) => line.length > 0);
  if (!paragraphs.length) return "<p></p>";
  return paragraphs.map((p) => "<p>" + escapeHtml(p) + "</p>").join("");
}

/** HTML → 纯文本（TipTap 用 <p> 分段，这里转成单换行文本） */
export function docToText(html: string): string {
  if (!html) return "";
  if (!html.includes("<")) return html;
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|blockquote)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[\u3000]+/g, "")
    .trim();
}

/** 是否基本为空文档 */
export function isEmptyDoc(html: string): boolean {
  return stripHtml(html).trim().length === 0;
}

/** 把 tipTap 选区文本转成可嵌入的段落 HTML */
export function selectionToHtml(text: string): string {
  return textToDoc(text);
}
