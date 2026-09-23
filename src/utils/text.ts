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

/**
 * 实体单次扫描解码：`&amp;lt;` → `&lt;`，不会被后续规则二次解码成 `<`。
 * 逐条 replace 串联（&amp; 先、&lt; 后）会让中间结果再次命中，必须用带分发回调的单次 replace。
 */
const ENTITY_DECODE: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(?:amp|lt|gt|quot|nbsp|#39);/g, (m) => ENTITY_DECODE[m.slice(1, -1)] ?? m);
}

export function stripHtml(html: string): string {
  if (!html) return '';
  // 没有标签也没有实体时才是纯文本（仅有 &lt; 这类实体、没有 < 的输入必须走解码）
  if (!html.includes('<') && !html.includes('&')) return html;
  return decodeEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h[1-6]|li|blockquote|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\n{3,}/g, '\n\n'),
  ).trim();
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 整串形如 HTML 文档（以 <p>/<div> 开头）才按受信文档透传；子串中的 <p 不算 */
const HTML_DOC_START = /^\s*<(?:p|div)(?=[\s/>])/i;

/** 纯文本段落 → 简单 HTML（默认一律 escapeHtml；受信 HTML 文档仅整串形如 <p…/<div… 才透传） */
export function textToHtml(text: string): string {
  if (!text) return '<p></p>';
  if (HTML_DOC_START.test(text)) return text;
  return text
    .split(/\n{2,}/)
    .map((para) => `<p>${escapeHtml(para.replace(/\n/g, ' ')).trim()}</p>`)
    .filter((p) => p !== '<p></p>')
    .join('');
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
  const preLines: string[] = [];
  const chapters: { title: string; lines: string[] }[] = [];
  let current: { title: string; lines: string[] } | null = null;

  for (const line of lines) {
    const m = CHAPTER_HEAD_RE.exec(line);
    if (m) {
      current = { title: line.trim(), lines: [] };
      chapters.push(current);
      continue;
    }
    if (current) current.lines.push(line);
    else preLines.push(line);
  }

  const parts: { title: string; content: string }[] = chapters.map((c) => ({
    title: c.title,
    content: c.lines.join('\n').trim(),
  }));
  const preamble = preLines.join('\n').trim();
  if (preamble) {
    if (parts.length > 0) {
      // 序言并入第一章：既不丢内容，也不让导入凭空多出一章、标题错位
      parts[0].content = parts[0].content ? preamble + '\n' + parts[0].content : preamble;
    } else {
      parts.unshift({ title: '', content: preamble });
    }
  }

  const meaningful = parts.filter((c) => c.content.length > 0 || c.title);
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

/** 中文数字 → 阿拉伯数字（逐位年份二零二五→2025、十/百/千位权）；解析失败返回 undefined 而非 0 */
const CN_NUM: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const CN_UNIT: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };
export function cnToNumber(cn: string): number | undefined {
  if (!cn) return undefined;
  if (/^\d+$/.test(cn)) return Number(cn);
  const chars = [...cn];
  if (chars.every((c) => CN_NUM[c] !== undefined)) {
    // 逐位读法（年份常见）：二零二五 → 2025
    return chars.reduce((n, c) => n * 10 + CN_NUM[c], 0);
  }
  if (!chars.every((c) => CN_NUM[c] !== undefined || CN_UNIT[c] !== undefined)) return undefined;
  let total = 0;
  let current = 0;
  for (const c of chars) {
    if (CN_NUM[c] !== undefined) {
      current = CN_NUM[c];
    } else {
      // 十/百/千前面没有数字时按 1（十三、千二）
      total += (current === 0 ? 1 : current) * CN_UNIT[c];
      current = 0;
    }
  }
  return total + current;
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
