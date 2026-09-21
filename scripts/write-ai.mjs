import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const files = {};

files['src/ai/json.ts'] = String.raw`/**
 * 从模型输出里可靠地抠出 JSON。
 * 现实里模型会：加代码块、加前后解释、被 max_tokens 截断、用中文引号、漏逗号。
 * 这里逐级降级，尽量把能救的都救回来。
 */

export interface ParseResult<T = unknown> {
  ok: boolean;
  data?: T;
  /** 修复过程说明，便于调试与展示 */
  repairs: string[];
  error?: string;
  /** 是否疑似被截断 */
  truncated?: boolean;
  raw: string;
}

export function parseJson<T = unknown>(raw: string): ParseResult<T> {
  const repairs: string[] = [];
  if (!raw || !raw.trim()) return { ok: false, error: '模型没有返回内容', repairs, raw };

  let text = raw.trim();

  // 1. 去掉 \`\`\`json 包裹
  const fence = text.match(/\`\`\`(?:json|JSON)?(.*?)\`\`\`/s);
  if (fence) {
    text = fence[1].trim();
    repairs.push('剥离 Markdown 代码块');
  }

  // 2. 直接解析
  const direct = tryParse<T>(text);
  if (direct.ok) return { ok: true, data: direct.data, repairs, raw };

  // 3. 截取第一个 { 到最后一个 }
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const sliced = text.slice(firstBrace, lastBrace + 1);
    if (sliced !== text) {
      const r = tryParse<T>(sliced);
      if (r.ok) return { ok: true, data: r.data, repairs: [...repairs, '截取花括号区间'], raw };
      text = sliced;
      repairs.push('截取花括号区间');
    }
  }

  // 4. 常见修复：去尾逗号、中文标点
  const fixed = text
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\uff1a/g, ':')
    .replace(/\uff0c/g, ',');
  if (fixed !== text) {
    const r = tryParse<T>(fixed);
    if (r.ok) return { ok: true, data: r.data, repairs: [...repairs, '修正标点与尾逗号'], raw };
    text = fixed;
    repairs.push('修正标点与尾逗号');
  }

  // 5. 补全被截断的括号
  const balanced = closeBrackets(text);
  if (!balanced.closed) {
    const r = tryParse<T>(balanced.text);
    if (r.ok) return { ok: true, data: r.data, repairs: [...repairs, '补全截断的括号'], truncated: true, raw };
    repairs.push('补全截断的括号（失败）');
  }

  return {
    ok: false,
    error: 'JSON 解析失败',
    repairs,
    truncated: looksTruncated(text),
    raw,
  };
}

function tryParse<T>(s: string): { ok: boolean; data?: T } {
  try {
    return { ok: true, data: JSON.parse(s) as T };
  } catch {
    return { ok: false };
  }
}

function looksTruncated(s: string): boolean {
  const opens = (s.match(/[{\[]/g) ?? []).length;
  const closes = (s.match(/[}\]]/g) ?? []).length;
  return opens > closes;
}

/** 在字符串外补全缺失的 } 和 ] */
function closeBrackets(s: string): { text: string; closed: boolean } {
  let inString = false;
  let escaped = false;
  const stack: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') stack.pop();
  }
  if (!stack.length && !inString) return { text: s, closed: true };
  let out = s;
  if (inString) out += '"';
  // 去掉半截成员，如  "key":  或  "key": "val
  out = out.replace(/,\s*"[^"]*"\s*:\s*$/, '').replace(/,\s*$/, '').replace(/"\s*:\s*$/, '');
  while (stack.length) out += stack.pop();
  return { text: out, closed: false };
}

/** 取对象里的数组字段，兼容模型把数组写成对象的情况 */
export function asArray<T = unknown>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of ['items', 'list', 'data', 'results', 'entries']) {
      if (Array.isArray(obj[key])) return obj[key] as T[];
    }
    return Object.values(obj).filter((v) => v !== null && typeof v === 'object') as T[];
  }
  return [];
}

export function asString(v: unknown, fallback = ''): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return fallback;
}

export function asNumber(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v.replace(/[^\d.\-]/g, ''));
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

export function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => asString(x)).filter(Boolean);
  if (typeof v === 'string' && v.trim()) return v.split(/[,，、;；\n]/).map((s) => s.trim()).filter(Boolean);
  return [];
}

export function pick(obj: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) if (obj[k] !== undefined) return obj[k];
  return undefined;
}

export function pickStr(obj: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

export function pickArr(obj: Record<string, unknown>, ...keys: string[]): unknown[] {
  for (const k of keys) {
    const v = obj[k];
    if (Array.isArray(v)) return v;
  }
  return [];
}

export function normalizeSeverity(v: unknown): 'blocker' | 'error' | 'warn' | 'info' {
  const s = asString(v).toLowerCase();
  if (/blocker|致命|阻断/.test(s)) return 'blocker';
  if (/error|严重|错误|高/.test(s)) return 'error';
  if (/warn|警告|中/.test(s)) return 'warn';
  return 'info';
}
`;

for (const [path, content] of Object.entries(files)) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
  console.log('wrote', path, content.length);
}
