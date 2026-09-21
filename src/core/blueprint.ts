import type { ISO, Timestamped } from './base';

/**
 * 拆书蓝图：把一本参考书"拆开"，提取出可复用的写作技法与结构。
 *
 * ## 为什么分成两层（这是这个功能的核心设计）
 *
 * 拆书最容易滑向抄袭：把别人的故事换个名字再写一遍。所以这里刻意把分析结果
 * 切成两层，并在流程上强制区分：
 *
 * - **技法层（technique）**：这本书*为什么*好看 —— 视角距离、信息释放节奏、
 *   场景切分方式、钩子位置、对话与叙述配比、情绪曲线。这些是手艺，可以学，
 *   也应该学。它们不包含情节。
 *
 * - **内容层（content）**：这本书*讲了什么* —— 世界规则、人物关系、情节引擎、
 *   关键转折、结局类型。这些必须全部换掉，否则就是洗稿。
 *
 * 生成新作时，技法层原样带走，内容层只作"结构参照"（几幕、几个转折点、
 * 每章承担什么功能），人物、世界观、具体事件一律重新设计。
 */

export interface TechniqueProfile {
  /** 叙述视角与人称，以及镜头离主角多远 */
  pov: string;
  /** 时间处理：顺叙 / 倒叙 / 双线，以及跳转的规律 */
  timeHandling: string;
  /** 语言特征：句子长短、用词倾向、比喻密度、是否有腔调标记 */
  proseStyle: string;
  /** 段落与场景切分：一段多长、场景怎么收 */
  paragraphing: string;
  /**
   * 信息释放节奏 —— 拆书最有价值的一项。
   * 例如"每章结尾抛一个新疑问，答案隔两章才给"。
   */
  informationRelease: string;
  /** 钩子写法：开篇钩、章末钩分别怎么下 */
  hooks: string;
  /** 对话与叙述的配比，以及对话承担什么功能 */
  dialogueRatio: string;
  /** 情绪曲线：张力怎么起伏，高潮怎么铺垫 */
  emotionalCurve: string;
  /** 配角与群像的处理方式 */
  ensembleHandling: string;
  /** 这个作者最值得学的一招（一句话） */
  signatureMove: string;
}

export interface ContentProfile {
  /** 题材与卖点 */
  genre: string;
  /** 世界规则的类型（不记具体设定，只记"有哪几类规则在起作用"） */
  worldRulesShape: string;
  /** 人物关系的拓扑：谁和谁对立、谁欠谁（只记结构，不记人名） */
  relationshipShape: string;
  /** 情节引擎：推动故事不断向前的那台机器是什么 */
  plotEngine: string;
  /** 全书分几幕、每幕承担什么功能 */
  actStructure: { act: string; function: string }[];
  /** 关键转折点的功能（不记具体事件） */
  turningPoints: string[];
  /** 结局类型 */
  endingType: string;
  /** 目标读者与阅读体验 */
  readerExperience: string;
}

export interface StoryBlueprint {
  /** 技法层：生成新作时原样带走 */
  technique: TechniqueProfile;
  /** 内容层：生成新作时全部替换，只作结构参照 */
  content: ContentProfile;
  /** 每章的功能模板（用于新作的章节设计） */
  chapterTemplate: { role: string; function: string; tension: number }[];
  /** 拆书时用到的模型，便于追溯 */
  model?: string;
  /** 拆解时间 */
  analyzedAt: ISO;
  /** 参考书字数（用于判断样本是否够） */
  sampleWords: number;
}

/** 参考书拆解出来的"待替换清单"，生成新作时必须逐条给出替代 */
export const MUST_REPLACE: string[] = [
  '书名与所有人物姓名',
  '世界设定与专有名词',
  '具体事件、场景与情节走向',
  '任何成句的原文表述',
];

/**
 * 原创性自检：找出新作里与参考书雷同的长串文本。
 *
 * 为什么需要它：模型有时会"记得"参考书里的句子并原样吐出来。作者自己很难逐句比对，
 * 所以这里自动扫一遍，把可疑片段标出来让作者决定改不改。
 *
 * 判定用最长公共子串：连续 N 个字与原文完全一致就值得看一眼。
 * 阈值定在 12 字 —— 中文里 12 字连续相同基本不可能是巧合，
 * 而常用的成语、专名不会连续这么长。
 */
export const PLAGIARISM_MIN_RUN = 12;

export interface PlagiarismHit {
  /** 新作里的片段 */
  text: string;
  /** 在参考书里也出现过 */
  fromSource: boolean;
  /** 长度 */
  length: number;
}

/**
 * 找出 a 中所有长度 >= minRun 且出现在 b 中的片段。
 *
 * ## 为什么用滚动哈希而不是朴素逐字比较（这里踩过一个真实的坑）
 *
 * 第一版是"逐起点扩展 + 比较原始字符"，并在比对前把空白删掉。它在空白的处理上是错的：
 * 空白一旦被剔除，原本连续的匹配会被切成几段 —— **只要在当中插几个空格就能绕过查重**。
 * 实测：一段 20 字的雷同，中间插 3 个空格后变成 15 字 + 19 字两段（本该是一段 20 字）；
 * 如果把插空格的间隔改小，就完全测不出来。
 *
 * 现在改成：给两段文本算逐位置的 n-gram 滚动哈希（n = minRun），
 * 用哈希表找出「哈希连续相等」的最长游程，再回原文切片。
 * 空白插入不会打断匹配；复杂度也从 O(n·m) 降到接近 O(n+m)。
 */
export function findOverlaps(a: string, b: string, minRun = PLAGIARISM_MIN_RUN): PlagiarismHit[] {
  const A = stripWhitespace(a);
  const B = stripWhitespace(b);
  const n = Math.max(1, minRun);
  if (!A || !B || A.length < n || B.length < n) return [];

  const MOD = 2147483647;
  const BASE = 131;

  /** 每个位置的 n-gram 哈希（滚动计算） */
  const hashAt = (s: string): number[] => {
    const len = Math.max(0, s.length - n + 1);
    const out = new Array<number>(len).fill(0);
    if (len === 0) return out;
    let h = 0;
    let pow = 1;
    for (let i = 0; i < n; i++) {
      h = (h * BASE + s.charCodeAt(i)) % MOD;
      if (i > 0) pow = (pow * BASE) % MOD;
    }
    out[0] = h;
    for (let i = 1; i + n <= s.length; i++) {
      h = ((h - (s.charCodeAt(i - 1) * pow) % MOD) * BASE + s.charCodeAt(i + n - 1)) % MOD;
      if (h < 0) h += MOD;
      out[i] = h;
    }
    return out;
  };

  const ha = hashAt(A);
  const hb = hashAt(B);
  if (!ha.length || !hb.length) return [];

  // 参考文本：n-gram 哈希 → 出现位置。碰撞极少，真正比对时还会逐字核对。
  const index = new Map<number, number[]>();
  for (let j = 0; j < hb.length; j++) {
    const list = index.get(hb[j]);
    if (list) list.push(j);
    else index.set(hb[j], [j]);
  }

  const hits: PlagiarismHit[] = [];
  let i = 0;
  while (i < ha.length) {
    const cands = index.get(ha[i]);
    let best = 0;
    if (cands) {
      for (const j of cands) {
        if (A[i] !== B[j]) continue; // 排除哈希碰撞
        let k = 0;
        while (i + k < A.length && j + k < B.length && A[i + k] === B[j + k]) k += 1;
        if (k > best) best = k;
      }
    }
    if (best >= n) {
      hits.push({ text: A.slice(i, i + best), fromSource: true, length: best });
      i += best; // 跳过整段，避免同一处被反复上报
    } else {
      i += 1;
    }
  }
  return hits;
}

/** 去掉所有空白字符：中文文本里的空格多是排版换行留下的，不该影响雷同判定 */
function stripWhitespace(s: string): string {
  return s.split(/\s+/).join("").split(String.fromCharCode(0x3000)).join("");
}

export interface BlueprintRecord extends Timestamped {
  id: string;
  projectId: string;
  /** 参考资料的名字，便于作者区分多份拆解 */
  sourceTitle: string;
  /** 原始文本（本地保存，用于原创性自检；不上传） */
  sourceText: string;
  wordCount: number;
  blueprint: StoryBlueprint;
}