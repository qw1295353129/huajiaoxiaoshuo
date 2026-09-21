/** 中英混排文本工具：字数统计、分句、分章、归一化。 */

const segmenterCache = new Map<string, Intl.Segmenter>();

function segmenter(locale: string): Intl.Segmenter | null {
  if (typeof Intl === 'undefined' || !('Segmenter' in Intl)) return null;
  let s = segmenterCache.get(locale);
  if (!s) {
    s = new Intl.Segmenter(locale, { granularity: 'word' });
    segmenterCache.set(locale, s);
  }
  return s;
}

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff]/;
const CJK_G = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff]/g;
const LATIN_WORD = /[A-Za-z0-9][A-Za-z0-9'’\-]*/g;

export function hasCJK(text: string): boolean {
  return CJK.test(text);
}

/**
 * 字数统计（中文写作习惯）：
 * - 每个 CJK 字符计 1
 * - 每个拉丁/数字词计 1
 * - 标点与空白不计
 * 同时兼容无 Intl.Segmenter 的环境（正则回退）。
 */
export function countWords(input: string): number {
  if (!input) return 0;
  const text = stripHtml(input);
  if (!text) return 0;
  // 中文写作平台的通行口径：一个汉字算一个字（不是把多字词算作一个"词"）。
  // 所以不能直接用 Intl.Segmenter 的 isWordLike 计数 —— 它会把「雨下了整夜」算成 3 个词。
  const cjk = text.match(CJK_G)?.length ?? 0;
  const rest = text.replace(CJK_G, ' ');
  const seg = segmenter('zh-CN');
  let latin = 0;
  if (seg) {
    for (const part of seg.segment(rest)) {
      if (part.isWordLike) latin += 1;
    }
  } else {
    latin = rest.match(LATIN_WORD)?.length ?? 0;
  }
  return cjk + latin;
}

/** 仅统计字符数（含标点），用于状态栏的"字符"显示 */
export function countChars(input: string): number {
  return stripHtml(input).replace(/\s/g, '').length;
}

export function stripHtml(html: string): string {
  if (!html) return '';
  if (!html.includes('<')) return html;
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|blockquote|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 纯文本段落 → 简单 HTML */
export function textToHtml(text: string): string {
  if (!text) return '<p></p>';
  if (text.includes('<p') || text.includes('<div')) return text;
  return text
    .split(/\n{2,}/)
    .map((para) => `<p>${escapeHtml(para.replace(/\n/g, ' ')).trim()}</p>`)
    .filter((p) => p !== '<p></p>')
    .join('');
}

/** Markdown → 段落 HTML（仅支持段落/加粗/斜体，写作场景够用） */
export function markdownToHtml(md: string): string {
  const body = md
    .replace(/^#{1,6}\s+(.*)$/gm, (_m, t) => `\n<h2>${t}</h2>\n`)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(?<!\*)\*(?!\s)(.+?)(?<!\s)\*/g, '<em>$1</em>');
  return textToHtml(body);
}

/**
 * 按空行 / 缩进 / 标题把文本切成章节。
 * 返回的 title 为空字符串时表示没有识别到章节名。
 */
export interface SplitChapter {
  title: string;
  content: string;
  order: number;
}

const CHAPTER_HEAD_RE =
  /^\s{0,6}(?:第\s*[0-9零一二三四五六七八九十百千万两]+\s*[章节回卷篇幕]|Chapter\s+\d+|CHAPTER\s+\d+|卷\s*[0-9零一二三四五六七八九十]+)\s*[:：.、\s]?(.{0,40})$/;

export function splitIntoChapters(raw: string): SplitChapter[] {
  const lines = raw.replace(/\r\n?/g, '\n').split('\n');
  const chapters: SplitChapter[] = [];
  let current: { title: string; lines: string[] } | null = null;

  for (const line of lines) {
    const m = CHAPTER_HEAD_RE.exec(line);
    if (m) {
      if (current) chapters.push({ title: current.title, content: current.lines.join('\n').trim(), order: chapters.length });
      const suffix = (m[2] ?? '').trim();
      current = { title: suffix ? `${line.trim()}` : line.trim(), lines: [] };
      continue;
    }
    if (current) current.lines.push(line);
  }
  if (current) chapters.push({ title: current.title, content: current.lines.join('\n').trim(), order: chapters.length });

  const meaningful = chapters.filter((c) => c.content.length > 0 || c.title);
  if (meaningful.length === 0) {
    // 没识别到章节标记：整篇作为一章
    const content = raw.trim();
    return content ? [{ title: '', content, order: 0 }] : [];
  }
  return meaningful.map((c, i) => ({ ...c, order: i }));
}

/** 分句：中英文标点都认 */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？!?…；;\n])|(?<=[.!?]\s)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n|\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** 归一化用于比对：全角转半角、去标点空格、小写 */
export function normalizeForCompare(s: string): string {
  return s
    .replace(/[\uff01-\uff5e]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\s\u3000]+/g, '')
    .replace(/[，。、；：？！""''（）《》【】—…·,.!?;:"'()<>\[\]\-]/g, '')
    .toLowerCase();
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + '…';
}

/** 取文本末尾 n 个字符，尽量对齐到句边界 */
export function tailContext(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const slice = text.slice(-maxChars);
  const idx = slice.search(/[。！？!?…\n]/);
  return idx > 0 ? slice.slice(idx + 1) : slice;
}

/** 取文本开头 n 个字符 */
export function headContext(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : text.slice(0, maxChars);
}

/** 中文数字 → 阿拉伯数字（用于第X章排序） */
const CN_NUM: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
export function cnToNumber(cn: string): number {
  if (/^\d+$/.test(cn)) return Number(cn);
  if (/^十/.test(cn)) return 10 + (CN_NUM[cn[1]] ?? 0);
  if (cn.length === 1) return CN_NUM[cn] ?? 0;
  if (cn.length === 2 && cn[1] === '十') return (CN_NUM[cn[0]] ?? 0) * 10;
  if (cn.length === 3 && cn[1] === '十') return (CN_NUM[cn[0]] ?? 0) * 10 + (CN_NUM[cn[2]] ?? 0);
  return 0;
}

/** 高亮命中片段（返回 [前, 中, 后]） */
export function highlightParts(text: string, query: string): [string, string, string] {
  if (!query) return [text, '', ''];
  const i = text.toLowerCase().indexOf(query.toLowerCase());
  if (i < 0) return [text, '', ''];
  return [text.slice(0, i), text.slice(i, i + query.length), text.slice(i + query.length)];
}

/** 生成上下文片段（用于检索结果预览） */
export function snippetAround(text: string, query: string, radius = 60): string {
  const i = text.toLowerCase().indexOf(query.toLowerCase());
  if (i < 0) return truncate(text, radius * 2);
  const start = Math.max(0, i - radius);
  const end = Math.min(text.length, i + query.length + radius);
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
}

/** 简单可见性检测：段落是否以对话开头 */
export function isDialogueParagraph(p: string): boolean {
  const t = p.trim();
  return /^[""'「『（(]|^[^。！？]{1,14}(?:说道|问道|答道|喊道|笑道|低声|开口)/.test(t) || /[""'」』]$/.test(t);
}
