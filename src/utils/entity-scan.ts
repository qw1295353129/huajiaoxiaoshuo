import { countWords, normalizeForCompare, splitParagraphs, splitSentences, stripHtml } from "./text";

export interface KnownName {
  id?: string;
  name: string;
  aliases: string[];
  kind?: string;
}

export interface NameHit {
  /** 命中的规范名 */
  name: string;
  refId?: string;
  count: number;
  firstOffset: number;
  sample: string;
  matchedAs: string;
}

/**
 * 本地名称扫描：在正文里找已知名词出现的次数与位置。
 * 完全离线，用于人物出场统计、名词一致性、伏笔"太久没提"告警。
 */
export function scanKnownNames(text: string, names: KnownName[]): NameHit[] {
  const clean = stripHtml(text);
  const lower = clean.toLowerCase();
  const hits = new Map<string, NameHit>();

  for (const n of names) {
    const forms = [n.name, ...n.aliases].filter((x) => x && x.length >= 1);
    let best: NameHit | undefined;
    for (const form of forms) {
      let idx = lower.indexOf(form.toLowerCase());
      if (idx < 0) continue;
      let count = 0;
      let first = idx;
      while (idx >= 0) {
        count += 1;
        idx = lower.indexOf(form.toLowerCase(), idx + form.length);
      }
      if (!best || count > best.count) {
        best = {
          name: n.name,
          refId: n.id,
          count,
          firstOffset: first,
          sample: clean.slice(Math.max(0, first - 30), first + form.length + 50),
          matchedAs: form,
        };
      }
    }
    if (best) {
      const existing = hits.get(n.name);
      if (existing) {
        existing.count += best.count;
        if (best.firstOffset < existing.firstOffset) {
          existing.firstOffset = best.firstOffset;
          existing.sample = best.sample;
        }
      } else {
        hits.set(n.name, best);
      }
    }
  }
  return Array.from(hits.values()).sort((a, b) => b.count - a.count);
}

/** 名词一致性：找出写错的变体（如"林远"被写成"林 Yuan"或"林渊"） */
export interface VariantHit {
  canonical: string;
  variant: string;
  count: number;
  sample: string;
}

export function scanNameVariants(text: string, names: KnownName[]): VariantHit[] {
  const clean = stripHtml(text);
  const out: VariantHit[] = [];
  for (const n of names) {
    if (n.name.length < 2) continue;
    // 同音/形近字替换检测：保留首字，末字换成常见混淆集合
    const first = n.name[0];
    const re = new RegExp(first + "[\\u4e00-\\u9fff]", "g");
    const seen = new Map<string, number>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(clean)) !== null) {
      const cand = m[0];
      if (cand === n.name) continue;
      const cn = normalizeForCompare(cand);
      const nn = normalizeForCompare(n.name);
      if (cn === nn) continue;
      if (cand.length !== n.name.length) continue;
      seen.set(cand, (seen.get(cand) ?? 0) + 1);
    }
    for (const [cand, count] of seen) {
      if (count >= 2) {
        out.push({
          canonical: n.name,
          variant: cand,
          count,
          sample: clean.slice(Math.max(0, clean.indexOf(cand) - 25), clean.indexOf(cand) + cand.length + 35),
        });
      }
    }
  }
  return out;
}

/** 对话归属统计：谁说的话最多 */
export interface DialogueStat {
  speaker: string;
  lines: number;
  chars: number;
}

export function dialogueStats(text: string, names: KnownName[]): DialogueStat[] {
  const clean = stripHtml(text);
  const paragraphs = splitParagraphs(clean);
  const stats = new Map<string, DialogueStat>();
  const ensure = (name: string) => {
    let s = stats.get(name);
    if (!s) {
      s = { speaker: name, lines: 0, chars: 0 };
      stats.set(name, s);
    }
    return s;
  };

  for (const p of paragraphs) {
    const quoted = p.match(/[「“"]([^」”"]{2,})[」”"]/g);
    if (!quoted) continue;
    const total = quoted.reduce((n, q) => n + q.length, 0);
    let speaker = "";
    // 优先"某某说/道"结构
    const sayer = p.match(/([\u4e00-\u9fff]{2,4})(?:说道|说|道|问|答|喊|叫|笑道|冷笑道|低声说|开口)/);
    if (sayer) speaker = sayer[1];
    if (!speaker) {
      for (const n of names) {
        if (p.includes(n.name)) {
          speaker = n.name;
          break;
        }
      }
    }
    if (!speaker) speaker = "（未标明）";
    // 归并到已知规范名
    const canonical = names.find((n) => n.name === speaker || n.aliases.includes(speaker));
    const finalName = canonical ? canonical.name : speaker;
    const s = ensure(finalName);
    s.lines += quoted.length;
    s.chars += total;
  }
  return Array.from(stats.values()).sort((a, b) => b.chars - a.chars);
}

/** 从正文里启发式发现疑似人名（新角色候选） */
export function discoverNames(text: string, known: KnownName[], limit = 30): { name: string; count: number; sample: string }[] {
  const clean = stripHtml(text);
  const knownSet = new Set<string>();
  for (const k of known) {
    knownSet.add(k.name);
    for (const a of k.aliases) knownSet.add(a);
  }
  const counts = new Map<string, { count: number; sample: string }>();

  // 模式 1：对话标签 "XX说/道/问"
  for (const m of clean.matchAll(/([\u4e00-\u9fff]{2,4})(?=说道|说|道|问道|答道|喊道|笑道|冷哼|低声道|开口)/g)) {
    const name = m[1];
    if (knownSet.has(name)) continue;
    if (isCommonWord(name)) continue;
    add(counts, name, clean, m.index ?? 0);
  }
  // 模式 2：动作主语 "XX的/XX把/XX被/XX向"
  for (const m of clean.matchAll(/([\u4e00-\u9fff]{2,3})(?=的[\u4e00-\u9fff]|把|被|向|朝|从|对|看着|走了|站|坐)/g)) {
    const name = m[1];
    if (knownSet.has(name) || isCommonWord(name)) continue;
    add(counts, name, clean, m.index ?? 0);
  }

  return Array.from(counts, ([name, v]) => ({ name, ...v }))
    .filter((x) => x.count >= 3)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function add(map: Map<string, { count: number; sample: string }>, name: string, text: string, index: number) {
  const cur = map.get(name);
  if (cur) cur.count += 1;
  else map.set(name, { count: 1, sample: text.slice(Math.max(0, index - 20), index + name.length + 40) });
}

const COMMON = new Set([
  "他们", "我们", "你们", "她们", "这里", "那里", "此时", "这个", "那个", "什么", "怎么", "因为",
  "所以", "但是", "然后", "已经", "还是", "可是", "如果", "或者", "于是", "不过", "忽然", "突然",
  "终于", "一直", "这样", "那样", "自己", "大家", "别人", "有人", "没有", "不是", "就是", "只有",
  "仿佛", "似乎", "好像", "真的", "一定", "必须", "应该", "可能", "知道", "觉得", "看着", "听着",
]);

function isCommonWord(w: string): boolean {
  return COMMON.has(w);
}

/** 章节体检测量：全部离线计算 */
export interface ChapterMeasure {
  wordCount: number;
  dialogueRatio: number;
  avgSentenceLength: number;
  newNames: number;
}

export function measureChapter(text: string): ChapterMeasure {
  const clean = stripHtml(text);
  const paragraphs = splitParagraphs(clean);
  const sentences = splitSentences(clean);
  const words = countWords(clean);
  const dialogueParas = paragraphs.filter((p) => /[「“"]/.test(p)).length;
  const lens = sentences.map((s) => countWords(s)).filter((n) => n > 0);
  return {
    wordCount: words,
    dialogueRatio: paragraphs.length ? dialogueParas / paragraphs.length : 0,
    avgSentenceLength: lens.length ? lens.reduce((a, b) => a + b, 0) / lens.length : 0,
    newNames: 0,
  };
}
