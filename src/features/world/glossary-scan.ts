import type { ID } from "@/core";
import { db } from "@/db/database";
import { scanKnownNames, scanNameVariants, type KnownName } from "@/utils/entity-scan";
import { normalizeForCompare, stripHtml } from "@/utils/text";

/**
 * 名词表辅助：把项目正文里可疑的写法扫出来。
 *
 * 说明：这里的读取是本页唯一一处直接访问 db 的地方（只读），
 * 因为要拿全项目的章节正文做词形比对，hooks 没有对应的订阅入口。
 */

export interface VariantRow {
  /** 标准写法（已有的条目名 / 人物名 / 名词） */
  canonical: string;
  /** 正文里出现的可疑写法 */
  variant: string;
  count: number;
  sample: string;
  /** suspect = 形近疑似写错；alias = 已登记的别名在正文里出现 */
  source: "suspect" | "alias";
}

export interface VariantScanResult {
  rows: VariantRow[];
  /** 有正文的章节数 */
  chapters: number;
  /** 实际参与扫描的字符数 */
  chars: number;
  /** 因为体量过大被截断 */
  truncated: boolean;
}

/** 单次扫描的正文上限（约 80 万字，够覆盖长篇的前中期） */
const MAX_CHARS = 800000;
/** 参与扫描的名字上限，避免几千个名字把主线程拖死 */
const MAX_NAMES = 400;

/** 扫描全项目正文，找出可疑的名词变体 */
export async function scanProjectVariants(projectId: ID, names: KnownName[]): Promise<VariantScanResult> {
  const contents = await db.chapterContents.where("projectId").equals(projectId).toArray();
  const parts: string[] = [];
  let chars = 0;
  let truncated = false;

  for (const content of contents) {
    const text = content.text || "";
    if (!text.trim()) continue;
    if (chars + text.length > MAX_CHARS) {
      truncated = true;
      break;
    }
    parts.push(text);
    chars += text.length;
  }

  if (!parts.length || !names.length) {
    return { rows: [], chapters: contents.length, chars: chars, truncated: truncated };
  }
  return { rows: collectRows(parts.join("\n"), names), chapters: contents.length, chars: chars, truncated: truncated };
}

function collectRows(text: string, names: KnownName[]): VariantRow[] {
  const picked = names.slice(0, MAX_NAMES);
  const known = new Set<string>();
  for (const name of picked) {
    known.add(normalizeForCompare(name.name));
    for (const alias of name.aliases) known.add(normalizeForCompare(alias));
  }

  const rows = new Map<string, VariantRow>();
  const push = (row: VariantRow) => {
    if (!row.variant || !row.canonical) return;
    const key = rowKey(row.canonical, row.variant);
    const exist = rows.get(key);
    if (exist) {
      exist.count += row.count;
      if (!exist.sample) exist.sample = row.sample;
      return;
    }
    rows.set(key, { ...row });
  };

  // 1) 项目自带工具：同长度、首字相同的形近写法（主要覆盖两字名）
  for (const hit of scanNameVariants(text, picked)) {
    if (known.has(normalizeForCompare(hit.variant))) continue;
    push({ canonical: hit.canonical, variant: hit.variant, count: hit.count, sample: hit.sample, source: "suspect" });
  }
  // 2) 三字以上的名字：同长度、首字相同、只差一个字（工具覆盖不到，这里补上）
  for (const hit of nearMisses(text, picked, known)) push(hit);
  // 3) 已登记的别名：正文里实际出现过，提示补进名词表
  for (const hit of scanKnownNames(text, picked)) {
    if (hit.matchedAs === hit.name) continue;
    push({ canonical: hit.name, variant: hit.matchedAs, count: hit.count, sample: hit.sample, source: "alias" });
  }

  return Array.from(rows.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 80);
}

/** 常见虚词：出现在候选词里就基本不是专有名词 */
const FUNCTION_CHARS = /[的了是在和也都就还又很更最把被给对从向与及或但而着过呢吗吧]/;

/** 同长度、首字相同、只差一个字的写法（按出现次数过滤噪声） */
function nearMisses(text: string, names: KnownName[], known: Set<string>, minCount = 3): VariantRow[] {
  const clean = stripHtml(text);
  const counts = new Map<string, { count: number; sample: string }>();

  for (const name of names) {
    const length = name.name.length;
    if (length < 3) continue;
    if (!/^[\u4e00-\u9fff]+$/.test(name.name)) continue;
    const first = name.name[0];
    let idx = clean.indexOf(first);
    while (idx >= 0) {
      const candidate = clean.slice(idx, idx + length);
      if (
        candidate.length === length &&
        candidate !== name.name &&
        /^[\u4e00-\u9fff]+$/.test(candidate) &&
        !FUNCTION_CHARS.test(candidate.slice(1)) &&
        diffCount(name.name, candidate) === 1 &&
        !known.has(normalizeForCompare(candidate))
      ) {
        const key = rowKey(name.name, candidate);
        const exist = counts.get(key);
        if (exist) exist.count += 1;
        else counts.set(key, { count: 1, sample: clean.slice(Math.max(0, idx - 25), idx + length + 30) });
      }
      idx = clean.indexOf(first, idx + 1);
    }
  }

  const out: VariantRow[] = [];
  for (const [key, value] of counts) {
    if (value.count < minCount) continue;
    const [canonical, variant] = key.split("||");
    out.push({ canonical: canonical, variant: variant, count: value.count, sample: value.sample, source: "suspect" });
  }
  return out;
}

function diffCount(a: string, b: string): number {
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      diff += 1;
      if (diff > 1) return diff;
    }
  }
  return diff;
}

export function rowKey(canonical: string, variant: string): string {
  return normalizeForCompare(canonical) + "||" + normalizeForCompare(variant);
}
