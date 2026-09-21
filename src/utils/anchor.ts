/**
 * 文本锚点定位：把"引用原文 + 偏移"重新落到当前文本上。
 *
 * 为什么需要它：作者会不断改稿，任何一次性记录的字符偏移都会失效。
 * 所以定位时以 **quote（引用原文）为权威**，偏移只作提示：
 *   1. 先看原偏移处是否仍是这段文字（命中率最高，且最省）
 *   2. 否则全文搜索；多处命中时用 prefix/suffix 消歧
 *   3. 再不行就模糊匹配（去掉标点空白后比对）
 *   4. 全部失败返回 null —— 调用方据此把评论标成"已失效"而不是错位显示
 */

export interface AnchorLike {
  from: number;
  to: number;
  quote: string;
  prefix?: string;
  suffix?: string;
}

export interface Located {
  from: number;
  to: number;
  /** 命中方式，便于调试与展示置信度 */
  via: 'exact-offset' | 'unique-quote' | 'context' | 'fuzzy';
}

const NORMALIZE = (s: string) => s.replace(/[\s\u3000，。、；：？！""''（）《》【】…—·,.!?;:"'()<>\[\]\-]/g, '');

export function locateAnchor(text: string, anchor: AnchorLike): Located | null {
  const quote = anchor.quote ?? '';
  if (!text || !quote) return null;

  // 1. 原偏移仍然是这段文字
  if (anchor.from >= 0 && anchor.from + quote.length <= text.length) {
    if (text.slice(anchor.from, anchor.from + quote.length) === quote) {
      return { from: anchor.from, to: anchor.from + quote.length, via: 'exact-offset' };
    }
  }

  // 2. 全文搜索
  const hits: number[] = [];
  let idx = text.indexOf(quote);
  while (idx >= 0) {
    hits.push(idx);
    idx = text.indexOf(quote, idx + 1);
    if (hits.length > 50) break;
  }
  if (hits.length === 1) return { from: hits[0], to: hits[0] + quote.length, via: 'unique-quote' };

  // 3. 多处命中：用上下文消歧
  if (hits.length > 1 && (anchor.prefix || anchor.suffix)) {
    let best: number | null = null;
    let bestScore = -1;
    for (const h of hits) {
      let score = 0;
      if (anchor.prefix && text.slice(Math.max(0, h - anchor.prefix.length), h) === anchor.prefix) score += 2;
      if (anchor.suffix && text.slice(h + quote.length, h + quote.length + anchor.suffix.length) === anchor.suffix) score += 2;
      if (score > bestScore) {
        bestScore = score;
        best = h;
      }
    }
    if (best !== null && bestScore > 0) return { from: best, to: best + quote.length, via: 'context' };
    // 上下文也对不上就取最靠近原偏移的一个
    if (best !== null) {
      let nearest = hits[0];
      for (const h of hits) if (Math.abs(h - anchor.from) < Math.abs(nearest - anchor.from)) nearest = h;
      return { from: nearest, to: nearest + quote.length, via: 'context' };
    }
  }
  if (hits.length > 1) {
    let nearest = hits[0];
    for (const h of hits) if (Math.abs(h - anchor.from) < Math.abs(nearest - anchor.from)) nearest = h;
    return { from: nearest, to: nearest + quote.length, via: 'context' };
  }

  // 4. 模糊匹配：忽略标点与空白后找，再映射回原文偏移
  const flat = NORMALIZE(quote);
  if (flat.length >= 4) {
    let flatText = '';
    const map: number[] = [];
    for (let i = 0; i < text.length; i++) {
      if (!/[\s\u3000，。、；：？！""''（）《》【】…—·,.!?;:"'()<>\[\]\-]/.test(text[i])) {
        flatText += text[i];
        map.push(i);
      }
    }
    const at = flatText.indexOf(flat);
    if (at >= 0) {
      const start = map[at];
      const endIdx = at + flat.length - 1;
      const end = endIdx < map.length ? map[endIdx] + 1 : text.length;
      return { from: start, to: end, via: 'fuzzy' };
    }
  }

  return null;
}

/** 由一段选区生成锚点 */
export function makeAnchor(text: string, from: number, to: number, contextLen = 20): AnchorLike {
  const quote = text.slice(from, to);
  return {
    from,
    to,
    quote,
    prefix: from > 0 ? text.slice(Math.max(0, from - contextLen), from) : undefined,
    suffix: text.slice(to, Math.min(text.length, to + contextLen)) || undefined,
  };
}

/**
 * 应用一条修订建议，返回新正文。
 *
 * 关键点：**从后往前应用**。如果先改前面的，后面的偏移就全错了。
 */
export function applySuggestions(
  text: string,
  suggestions: { kind: 'replace' | 'delete' | 'insert'; from: number; to: number; proposed: string }[],
): string {
  const sorted = [...suggestions].sort((a, b) => b.from - a.from);
  let out = text;
  for (const s of sorted) {
    const from = Math.max(0, Math.min(s.from, out.length));
    const to = Math.max(from, Math.min(s.to, out.length));
    if (s.kind === 'delete') out = out.slice(0, from) + out.slice(to);
    else out = out.slice(0, from) + s.proposed + out.slice(to);
  }
  return out;
}

/**
 * 计算去掉一条建议后的偏移变化，用于"接受一条建议后其余建议的重新定位"。
 * 返回偏移调整量（后续建议需要据此平移）。
 */
export function deltaAfterApply(kind: 'replace' | 'delete' | 'insert', removedLen: number, insertedLen: number): number {
  if (kind === 'insert') return insertedLen;
  return insertedLen - removedLen;
}
