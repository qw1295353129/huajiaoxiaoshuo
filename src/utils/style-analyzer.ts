import type { StyleFingerprint, StyleMetrics } from "@/core";
import { countWords, isDialogueParagraph, splitParagraphs, splitSentences, stripHtml } from "./text";

/**
 * 离线文风分析：不调用任何模型，纯统计。
 * 作用：给 AI 一个可量化的"你的文风"画像，也给作者看见自己和"AI 味"的距离。
 */
export function analyzeStyle(text: string): StyleMetrics {
  const clean = stripHtml(text);
  const paragraphs = splitParagraphs(clean);
  const sentences = splitSentences(clean);
  const words = countWords(clean);

  const lengths = sentences.map((s) => countWords(s)).filter((n) => n > 0);
  const avgSentenceLength = mean(lengths);
  const sentenceLengthStd = std(lengths, avgSentenceLength);
  const avgParagraphLength = paragraphs.length ? words / paragraphs.length : 0;

  const dialogueParas = paragraphs.filter(isDialogueParagraph).length;
  const dialogueRatio = paragraphs.length ? dialogueParas / paragraphs.length : 0;

  const punctuationProfile: Record<string, number> = {};
  for (const p of ["，", "。", "！", "？", "…", "—", "；", "：", "、", "「", "」"]) {
    punctuationProfile[p] = countOccurrences(clean, p);
  }
  const totalPunct = Object.values(punctuationProfile).reduce((a, b) => a + b, 0) || 1;

  const simileDensity = words ? (countMatches(clean, /像|如同|仿佛|好似|宛如|犹如/g) / words) * 1000 : 0;
  const adjectives = countMatches(clean, /[\u4e00-\u9fff]{1,2}的(?=[\u4e00-\u9fff])/g);
  const adverbDensity = words ? (countMatches(clean, /地(?=[\u4e00-\u9fff])/g) / words) * 1000 : 0;

  const cjkChars = clean.match(/[\u4e00-\u9fff]/g) ?? [];
  const ttr = cjkChars.length ? new Set(cjkChars).size / cjkChars.length : 0;

  const avgWordLength = words ? cjkChars.length / words : 0;

  return {
    avgSentenceLength: round1(avgSentenceLength),
    sentenceLengthStd: round1(sentenceLengthStd),
    avgParagraphLength: round1(avgParagraphLength),
    dialogueRatio: round3(dialogueRatio),
    questionRatio: round3(punctuationProfile["？"] / totalPunct),
    exclamationRatio: round3(punctuationProfile["！"] / totalPunct),
    ellipsisRatio: round3(punctuationProfile["…"] / totalPunct),
    simileDensity: round1(simileDensity),
    ttr: round3(ttr),
    adjectiveDensity: words ? round1((adjectives / words) * 1000) : 0,
    adverbDensity: round1(adverbDensity),
    avgWordLength: round2(avgWordLength),
    punctuationProfile: Object.fromEntries(Object.entries(punctuationProfile).map(([k, v]) => [k, round3(v / totalPunct)])),
    pacingScore: round1(pacingScore(avgSentenceLength, sentenceLengthStd, dialogueRatio)),
  };
}

/** 节奏分：句长适中、长短变化大、对话占比适中 → 分高 */
function pacingScore(avgLen: number, sd: number, dialogueRatio: number): number {
  const lengthScore = 100 - Math.min(100, Math.abs(avgLen - 18) * 3.2);
  const varietyScore = Math.min(100, sd * 7);
  const dialogueScore = 100 - Math.min(100, Math.abs(dialogueRatio - 0.35) * 180);
  return Math.max(0, Math.min(100, lengthScore * 0.42 + varietyScore * 0.33 + dialogueScore * 0.25));
}

export interface TopWord { word: string; count: number; ratio: number }

/** 高频词（中文 2-4 字滑窗去重计数），已过滤虚词 */
export function topWords(text: string, limit = 40): TopWord[] {
  const clean = stripHtml(text);
  const stop = new Set([
    "的时", "了的", "是在", "一个", "这个", "那个", "什么", "可以", "就是", "不是", "没有", "自己",
    "他们", "我们", "你们", "起来", "出来", "时候", "已经", "还是", "但是", "因为", "所以", "如果",
    "这样", "那样", "知道", "觉得", "看着", "说道", "一样", "一切", "有些", "这些", "那些", "而且",
  ]);
  const counts = new Map<string, number>();
  const cjk = clean.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  for (const seg of cjk) {
    for (let n = 2; n <= 4; n++) {
      for (let i = 0; i + n <= seg.length; i++) {
        const w = seg.slice(i, i + n);
        if (stop.has(w)) continue;
        counts.set(w, (counts.get(w) ?? 0) + 1);
      }
    }
  }
  const total = countWords(clean) || 1;
  const arr = Array.from(counts, ([word, count]) => ({ word, count, ratio: count / total }))
    .sort((a, b) => b.count - a.count);
  // 去掉被更长词包含的短词
  const kept: TopWord[] = [];
  for (const w of arr) {
    if (kept.some((k) => k.word.includes(w.word) && k.count >= w.count)) continue;
    kept.push(w);
    if (kept.length >= limit) break;
  }
  return kept;
}

/** 标志性短语：4 字及以上的高频片段 */
export function signaturePhrases(text: string, limit = 20): { phrase: string; count: number }[] {
  const clean = stripHtml(text).replace(/[\s\u3000]/g, "");
  const counts = new Map<string, number>();
  for (let n = 5; n <= 8; n++) {
    for (let i = 0; i + n <= clean.length; i++) {
      const g = clean.slice(i, i + n);
      if (!/[\u4e00-\u9fff]/.test(g)) continue;
      counts.set(g, (counts.get(g) ?? 0) + 1);
    }
  }
  const arr = Array.from(counts, ([phrase, count]) => ({ phrase, count })).filter((x) => x.count >= 3);
  arr.sort((a, b) => b.count - a.count || b.phrase.length - a.phrase.length);
  const kept: { phrase: string; count: number }[] = [];
  for (const x of arr) {
    if (kept.some((k) => k.phrase.includes(x.phrase))) continue;
    kept.push(x);
    if (kept.length >= limit) break;
  }
  return kept;
}

/** 生成给 AI 用的文风描述 */
export function stylePrompt(metrics: StyleMetrics, top: TopWord[]): string {
  const bits: string[] = [];
  bits.push("平均句长约 " + metrics.avgSentenceLength + " 字" + (metrics.sentenceLengthStd > 9 ? "，长短句交错明显" : "，句式较均匀"));
  bits.push("对话占比约 " + Math.round(metrics.dialogueRatio * 100) + "%");
  if (metrics.simileDensity > 6) bits.push("比喻使用频繁");
  else if (metrics.simileDensity < 2) bits.push("极少使用比喻，偏白描");
  if (metrics.exclamationRatio > 0.05) bits.push("感叹号使用偏多，情绪外放");
  if (metrics.ellipsisRatio > 0.05) bits.push("常用省略号，语感留白");
  if (metrics.adverbDensity > 12) bits.push("副词（地）偏多，注意克制");
  if (metrics.adjectiveDensity > 45) bits.push("形容词密度偏高，建议多用具体名词");
  bits.push("节奏评分 " + metrics.pacingScore + "/100");
  const words = top.slice(0, 12).map((w) => w.word).join("、");
  return bits.join("；") + "。" + (words ? "作者高频用词：" + words + "。" : "");
}

export function buildFingerprint(input: {
  projectId: string;
  sampleChapters: number;
  sampleWords: number;
  text: string;
}): StyleFingerprint {
  const metrics = analyzeStyle(input.text);
  const top = topWords(input.text, 40);
  const phrases = signaturePhrases(input.text, 20);
  return {
    id: input.projectId,
    projectId: input.projectId,
    sampleChapters: input.sampleChapters,
    sampleWords: input.sampleWords,
    computedAt: new Date().toISOString(),
    metrics,
    topWords: top,
    sentenceHistogram: histogram(splitSentences(input.text).map((s) => countWords(s))),
    signaturePhrases: phrases,
    prompt: stylePrompt(metrics, top),
  };
}

export function histogram(values: number[], buckets: number[] = [0, 5, 10, 15, 20, 25, 30, 40, 50, 80]): number[] {
  const out = new Array(buckets.length).fill(0);
  for (const v of values) {
    let idx = 0;
    for (let i = 0; i < buckets.length; i++) if (v >= buckets[i]) idx = i;
    out[idx] += 1;
  }
  return out;
}

/** AI 味检测：纯启发式，快速给出可疑句子 */
export interface AiSmellHit { quote: string; reason: string; score: number }
const AI_PATTERNS: { re: RegExp; reason: string; weight: number }[] = [
  { re: /总而言之|综上所述|值得注意的是|不难看出|由此可见/, reason: "总结腔", weight: 3 },
  { re: /在这个[^，。]{0,6}(世界|时代|城市)里/, reason: "空泛引入", weight: 3 },
  { re: /不仅仅是[^，。]{0,10}更是/, reason: "对仗式排比腔", weight: 2 },
  { re: /仿佛(在诉说着?|在诉说|诉说着)/, reason: "拟人套话", weight: 2 },
  { re: /(空气|气氛|氛围)(仿佛|似乎)?(凝固|凝滞|安静得)/, reason: "俗套描写", weight: 2 },
  { re: /心中(不禁)?(涌起|泛起)一股/, reason: "情绪直陈", weight: 2 },
  { re: /(深深地?|久久地?)(吸了口气|叹了口气|看了一眼)/, reason: "动作填充", weight: 1 },
  { re: /眼(神|眸)(中|里)(闪过|掠过)一丝/, reason: "眼神套话", weight: 2 },
  { re: /嘴角(勾起|扬起)(一抹|一丝)/, reason: "微笑套话", weight: 2 },
  { re: /不[由经]得(自主)?地?/, reason: "赘余副词", weight: 1 },
  { re: /的的|了了|地地/, reason: "重复助词", weight: 3 },
  { re: /[\u4e00-\u9fff]{2,4}的[\u4e00-\u9fff]{2,4}的[\u4e00-\u9fff]{2,4}的/, reason: "长串定语", weight: 2 },
];

export function detectAiSmell(text: string, limit = 20): AiSmellHit[] {
  const clean = stripHtml(text);
  const sentences = splitSentences(clean);
  const hits: AiSmellHit[] = [];
  for (const s of sentences) {
    let score = 0;
    const reasons: string[] = [];
    for (const p of AI_PATTERNS) {
      if (p.re.test(s)) {
        score += p.weight;
        reasons.push(p.reason);
      }
    }
    if (score > 0) hits.push({ quote: s.trim(), reason: Array.from(new Set(reasons)).join("、"), score });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** 中文常见错别字/易错词（启发式，命中给提示而非判定） */
export const COMMON_TYPOS: { wrong: string; right: string; note: string }[] = [
  { wrong: "的话说", right: "的话，说", note: "缺逗号易歧义" },
  { wrong: "做为", right: "作为", note: "常见误写" },
  { wrong: "即使如此如此", right: "即使如此", note: "重复" },
  { wrong: "必须要", right: "必须", note: "语义重复" },
  { wrong: "涉及到", right: "涉及", note: "语义重复" },
  { wrong: "原因是因為", right: "因为", note: "语义重复" },
  { wrong: "竟然意然", right: "竟然", note: "错别字" },
  { wrong: "按耐不住", right: "按捺不住", note: "成语误写" },
  { wrong: "迫不急待", right: "迫不及待", note: "成语误写" },
  { wrong: "一如继往", right: "一如既往", note: "成语误写" },
  { wrong: "走头无路", right: "走投无路", note: "成语误写" },
  { wrong: "鬼计多端", right: "诡计多端", note: "成语误写" },
  { wrong: "夜暮降临", right: "夜幕降临", note: "误写" },
  { wrong: "愁怅", right: "惆怅", note: "误写" },
  { wrong: "燥热不安", right: "躁动不安", note: "易混（燥/躁）" },
  { wrong: "辩认", right: "辨认", note: "误写" },
  { wrong: "幅射", right: "辐射", note: "误写" },
  { wrong: "似乎好像", right: "似乎", note: "语义重复" },
  { wrong: "大约左右", right: "大约", note: "语义重复" },
  { wrong: "唯一一个", right: "唯一", note: "语义重复" },
];

export function detectTypos(text: string): { wrong: string; right: string; note: string; index: number }[] {
  const clean = stripHtml(text);
  const out: { wrong: string; right: string; note: string; index: number }[] = [];
  for (const t of COMMON_TYPOS) {
    let idx = clean.indexOf(t.wrong);
    while (idx >= 0) {
      out.push({ ...t, index: idx });
      idx = clean.indexOf(t.wrong, idx + t.wrong.length);
    }
  }
  return out;
}

/** 标点体检：破折号、省略号是否规范 */
export function punctuationCheck(text: string): { kind: string; count: number; advice: string }[] {
  const clean = stripHtml(text);
  const out: { kind: string; count: number; advice: string }[] = [];
  const ellipsis = countOccurrences(clean, "...") + countOccurrences(clean, "。。。");
  if (ellipsis > 0) out.push({ kind: "省略号写成三个句点", count: ellipsis, advice: "统一为中文省略号「……」" });
  const dash = countOccurrences(clean, "--") + countOccurrences(clean, "——") * 0;
  if (dash > 0) out.push({ kind: "破折号写成两个连字符", count: dash, advice: "统一为中文破折号「——」" });
  const halfComma = countOccurrences(clean, ",");
  if (halfComma > 2) out.push({ kind: "混入半角逗号", count: halfComma, advice: "中文正文应使用全角「，」" });
  const halfPeriod = countOccurrences(clean, ".");
  if (halfPeriod > 2) out.push({ kind: "混入半角句点", count: halfPeriod, advice: "中文正文应使用全角「。」" });
  const repeated = countMatches(clean, /[！？]{2,}/g);
  if (repeated > 0) out.push({ kind: "连续感叹号/问号", count: repeated, advice: "建议最多一个，多余的情绪靠内容承载" });
  return out;
}

function mean(arr: number[]): number {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}
function std(arr: number[], m: number): number {
  if (arr.length < 2) return 0;
  return Math.sqrt(arr.reduce((a, b) => a + (b - m) * (b - m), 0) / arr.length);
}
function countOccurrences(hay: string, needle: string): number {
  let c = 0;
  let i = hay.indexOf(needle);
  while (i >= 0) {
    c += 1;
    i = hay.indexOf(needle, i + needle.length);
  }
  return c;
}
function countMatches(hay: string, re: RegExp): number {
  return (hay.match(re) ?? []).length;
}
function round1(n: number): number { return Math.round(n * 10) / 10; }
function round2(n: number): number { return Math.round(n * 100) / 100; }
function round3(n: number): number { return Math.round(n * 1000) / 1000; }
