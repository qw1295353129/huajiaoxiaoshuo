/** 轻量 diff / 相似度工具：用于版本对比与 AI 改写预览。 */

export type DiffOp = { type: 'equal' | 'insert' | 'delete'; text: string };

/** 词级 LCS diff（中文按字符，英文按词） */
export function diffWords(a: string, b: string): DiffOp[] {
  const ta = tokenize(a);
  const tb = tokenize(b);
  const n = ta.length;
  const m = tb.length;

  // 大文本降级：超过 4000 段用前后缀裁剪
  if (n * m > 16_000_000) return coarseDiff(ta, tb);

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = ta[i] === tb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  const push = (type: DiffOp['type'], text: string) => {
    const last = ops[ops.length - 1];
    if (last && last.type === type) last.text += text;
    else ops.push({ type, text });
  };
  while (i < n && j < m) {
    if (ta[i] === tb[j]) { push('equal', ta[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { push('delete', ta[i]); i++; }
    else { push('insert', tb[j]); j++; }
  }
  while (i < n) push('delete', ta[i++]);
  while (j < m) push('insert', tb[j++]);
  return ops;
}

function tokenize(s: string): string[] {
  // \s+ 必须作为独立 token：否则英文词间空格被丢掉，ops 拼接无法还原原文
  return s.match(/[\u3400-\u9fff]|\s+|[A-Za-z0-9']+|[^\s]/g) ?? [];
}

function coarseDiff(ta: string[], tb: string[]): DiffOp[] {
  let prefix = 0;
  while (prefix < ta.length && prefix < tb.length && ta[prefix] === tb[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < ta.length - prefix && suffix < tb.length - prefix &&
    ta[ta.length - 1 - suffix] === tb[tb.length - 1 - suffix]
  ) suffix++;
  const ops: DiffOp[] = [];
  if (prefix) ops.push({ type: 'equal', text: ta.slice(0, prefix).join('') });
  if (ta.length - prefix - suffix > 0) ops.push({ type: 'delete', text: ta.slice(prefix, ta.length - suffix).join('') });
  if (tb.length - prefix - suffix > 0) ops.push({ type: 'insert', text: tb.slice(prefix, tb.length - suffix).join('') });
  if (suffix) ops.push({ type: 'equal', text: ta.slice(ta.length - suffix).join('') });
  return ops;
}

/** 段落级 diff，用于版本对比面板 */
export interface ParaDiff { type: DiffOp['type']; text: string; }
export function diffParagraphs(a: string, b: string): ParaDiff[] {
  const pa = a.split(/\n+/).filter(Boolean);
  const pb = b.split(/\n+/).filter(Boolean);
  const setA = new Map<string, number>();
  pa.forEach((p, i) => setA.set(p, i));
  const setB = new Map<string, number>();
  pb.forEach((p, i) => setB.set(p, i));
  const out: ParaDiff[] = [];
  const max = Math.max(pa.length, pb.length);
  for (let i = 0; i < max; i++) {
    const x = pa[i];
    const y = pb[i];
    if (x === y) { if (x) out.push({ type: 'equal', text: x }); continue; }
    if (x !== undefined && !setB.has(x)) out.push({ type: 'delete', text: x });
    if (y !== undefined && !setA.has(y)) out.push({ type: 'insert', text: y });
  }
  return out;
}

/** 两段文本相似度 0..1（基于 3-gram 的 Dice 系数） */
export function similarity(a: string, b: string): number {
  const A = grams(a);
  const B = grams(b);
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return (2 * inter) / (A.size + B.size);
}

function grams(s: string, n = 3): Set<string> {
  const t = s.replace(/\s/g, '');
  const out = new Set<string>();
  for (let i = 0; i + n <= t.length; i++) out.add(t.slice(i, i + n));
  return out;
}

/** n-gram 重复检测：找出文中重复出现的片段（灌水检测） */
export interface RepeatHit { phrase: string; count: number; positions: number[] }
export function findRepeats(text: string, n = 8, minCount = 3, limit = 30): RepeatHit[] {
  const t = text.replace(/[\s\u3000]/g, '');
  const map = new Map<string, number[]>();
  for (let i = 0; i + n <= t.length; i++) {
    const g = t.slice(i, i + n);
    const arr = map.get(g);
    if (arr) arr.push(i);
    else map.set(g, [i]);
  }
  const hits: RepeatHit[] = [];
  for (const [phrase, positions] of map) {
    if (positions.length >= minCount) hits.push({ phrase, count: positions.length, positions });
  }
  // 去掉被更长命中包含的短命中
  hits.sort((a, b) => b.count - a.count || b.phrase.length - a.phrase.length);
  const kept: RepeatHit[] = [];
  for (const h of hits) {
    if (kept.some((k) => k.phrase.includes(h.phrase))) continue;
    kept.push(h);
    if (kept.length >= limit) break;
  }
  return kept;
}
