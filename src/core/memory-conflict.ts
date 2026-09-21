import type { ID } from './base';
import type { MemoryFact, MemoryKind } from './memory';

/**
 * 记忆冲突检测（纯本地、纯函数，不调用模型，因此不花 token、也不给写作路径添延迟）。
 *
 * 为什么需要它：记忆是会互相打架的。作者三个月前写下「文风要冷硬」，昨天又写下
 * 「这段要温暖细腻」，两条都会被拼进 system prompt —— 模型只能摇摆，输出一会儿冷一会儿暖。
 * 更糟的是这种摇摆极难归因：作者看到的只是「AI 今天不太对」。
 *
 * 三个设计约束，直接决定了算法长什么样：
 *
 * 1. **不调模型**：加记忆、开面板、扫描都要跑，走模型既慢又花钱，还挡住了"正在打字"的路径。
 * 2. **相似 ≠ 冲突**：「对话不要用解释性台词」与「对话不要用说明性台词」相似度极高，
 *    却是同一个意思。所以相似度只当**必要条件**（筛掉风马牛不相及的两条），
 *    真正的冲突信号必须是"取向相反"：一条禁止一条要求（否定对立），
 *    或命中同一写作维度上的相反两极（冷硬 ↔ 温暖细腻）。
 * 3. **宁可漏报不要误报**：冲突条一旦开始误报，作者就会学会无视它，功能等于没有。
 *    所以每条策略都带否决条件（例如两条分别针对「对话」与「描写」，一冷一暖并不矛盾，直接否决）。
 *
 * 已知能力边界（刻意保留，没有为了"看起来更聪明"而堆规则）：
 * 设定事实类的语义矛盾（「铜钟只在死者出现时响」vs「铜钟每天都会敲响」）检测不到 ——
 * 纯词面规则无法理解"只在"与"都会"的语义对立，硬做只会大面积误报。这类交给 AI 审稿的
 * 一致性检查（consistency），而不是在这里假装能识别。
 */

export type MemoryConflictType =
  /** 否定对立：一条说「不要 X」，另一条说「多用 X」 */
  | 'negation'
  /** 反义维度：同一写作维度上取向相反（冷硬 ↔ 温暖细腻、简洁 ↔ 华丽） */
  | 'antonym';

export const MEMORY_CONFLICT_LABEL: Record<MemoryConflictType, string> = {
  negation: '要求相反',
  antonym: '取向相反',
};

export interface MemoryConflict {
  aId: ID;
  bId: ID;
  type: MemoryConflictType;
  /** 给作者看的理由，直接显示在冲突条上，不出现"相似度 0.83"这种机器话 */
  reason: string;
  /** 归一化文本相似度 0~1，用于排序与展示（越像，越可能是同一件事的两种说法） */
  similarity: number;
  /** 命中的关键词，界面用于高亮 */
  hits: string[];
  /** 排序用 */
  severity: 'high' | 'medium';
}

/* ------------------------------------------------------------------ *
 * 文本归一化
 * ------------------------------------------------------------------ */

const PUNCT = /[\s\u3000，。、；：？！「」『』“”‘’（）()《》〈〉【】〔〕…—–·,.!?;:'"~～\-—_/\\|]+/g;

/** 归一化：全角转半角、去标点空白、统一小写（英文/数字部分） */
export function normalizeMemoryText(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(PUNCT, '');
}

/**
 * 假朋友：这些词里含有否定/程度词的字，但不是那个意思。
 * 「特别」「只要」「多少」如果不先剔除，会被当成分量与要求，制造大量误报。
 */
const FALSE_FRIENDS = /特别|分别|差别|识别|类别|告别|离别|个别|区别|性别|级别|别致|别扭|别称/g;
const FALSE_FRIENDS_2 = /多少|多年|多时|多样|多亏|众多|许多|很多|多种|多数|多余|重要|主要|只要|要是|要害|摘要|简要/g;

/** 否定（禁止）标记。多字优先，避免「不要」被拆成「要」 */
const NEGATIVE_MARKERS = [
  '不要', '不用', '别用', '别写', '别再', '甭', '避免', '禁止', '严禁', '切忌',
  '不能', '不得', '不可', '不该', '不应', '不允许', '不准', '勿', '杜绝', '拒绝', '防止', '戒掉',
  '少用', '少写', '少一些', '少点', '减少', '去掉', '去除', '删除', '取消', '不再',
];

/** 要求（正面）标记 */
const POSITIVE_MARKERS = [
  '多用', '多写', '多描写', '多一些', '多点', '多', '必须', '务必', '一定', '尽量', '需要',
  '应当', '应该', '保持', '坚持', '统一', '采用', '使用', '倾向', '偏好', '喜欢', '增加', '加强',
  '建议', '可以', '要',
];

/** 填充词：不承载"要什么"，参与相似度计算只会稀释信号 */
const FILLER = /尽量|务必|一定|必须|应该|应当|建议|可以|稍微|有点|非常|十分|更加|这种|这类|那种|那些|这些|一下|一些|方面|时候|以及|并且|而且|但是|而是|就是|全部|所有|的|了|着|过|更|最|都|也|还|再|把|被|给|对|和|与|或|在|是|请|得|地|之|其/g;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const NEGATIVE_RE = new RegExp(NEGATIVE_MARKERS.map(escapeRe).join('|'), 'g');
const POSITIVE_RE = new RegExp(POSITIVE_MARKERS.map(escapeRe).join('|'), 'g');

function stripFalseFriends(t: string): string {
  return t.replace(FALSE_FRIENDS, '').replace(FALSE_FRIENDS_2, '');
}

/** 取向：-1 要求"不要"，1 要求"要"，0 中性/陈述（同一句里两者都有也判 0） */
export function polarityOf(text: string): -1 | 0 | 1 {
  const t = stripFalseFriends(normalizeMemoryText(text));
  const neg = NEGATIVE_MARKERS.filter((m) => t.includes(m));
  // 先把否定标记挖掉再找正面标记，否则「不要」里的「要」会被当成正向要求
  const rest = t.replace(NEGATIVE_RE, '');
  const pos = POSITIVE_MARKERS.filter((m) => rest.includes(m));
  if (neg.length && !pos.length) return -1;
  if (pos.length && !neg.length) return 1;
  return 0;
}

/** 取"在要求什么"：剥掉否定/要求/填充词之后剩下的部分，用于判断两条是不是同一件事 */
export function topicOf(text: string): string {
  const t = stripFalseFriends(normalizeMemoryText(text));
  return t.replace(NEGATIVE_RE, '').replace(POSITIVE_RE, '').replace(FILLER, '');
}

/** 命中的取向词，用于理由文案与界面高亮 */
export function polarityWordsOf(text: string): string[] {
  const t = stripFalseFriends(normalizeMemoryText(text));
  const neg = NEGATIVE_MARKERS.filter((m) => t.includes(m));
  const rest = t.replace(NEGATIVE_RE, '');
  const pos = POSITIVE_MARKERS.filter((m) => rest.includes(m));
  return [...neg, ...pos].sort((a, b) => b.length - a.length).slice(0, 2);
}

/* ------------------------------------------------------------------ *
 * 相似度
 * ------------------------------------------------------------------ */

function ngrams(s: string, n: number): Set<string> {
  const out = new Set<string>();
  if (s.length < n) {
    if (s) out.add(s);
    return out;
  }
  for (let i = 0; i + n <= s.length; i++) out.add(s.slice(i, i + n));
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  return inter / (a.size + b.size - inter);
}

/** 编辑距离：只在短文本上算（长文本 O(n·m) 会拖垮面板渲染） */
function levenshteinRatio(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (!maxLen) return 0;
  if (maxLen > 64) return 0;
  const prev = new Array<number>(b.length + 1);
  const cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return 1 - prev[b.length] / maxLen;
}

/** 归一化相似度：二元组 Jaccard 与编辑距离取大（中文短句两者互补：前者看用词，后者看语序） */
export function textSimilarity(a: string, b: string): number {
  const x = normalizeMemoryText(a);
  const y = normalizeMemoryText(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  return Math.max(jaccard(ngrams(x, 2), ngrams(y, 2)), levenshteinRatio(x, y));
}

/**
 * 两条是不是"同一句话的两种说法"（立场一致）。用于提示合并，不作为冲突。
 *
 * 阈值 0.75 是实测出来的：中文短句里改一两个字（「解释性台词」→「说明性台词」）
 * 相似度只有 0.8，用 0.82 会把这种一眼就该合并的重复漏掉；
 * 而误报的代价很低（只是提示"可能重复"，作者点一下就能继续添加）。
 * 真正的护栏是立场必须一致 —— 立场不同的相似文本是冲突，不是重复。
 */
export function isNearDuplicate(a: string, b: string, threshold = 0.75): boolean {
  return textSimilarity(a, b) >= threshold;
}

/* ------------------------------------------------------------------ *
 * 写作维度（反义轴）与话题面（aspect）
 * ------------------------------------------------------------------ */

interface StyleAxis {
  id: string;
  label: string;
  /** 两极的用词表：命中不同极 = 取向相反 */
  poles: [string[], string[]];
}

/**
 * 反义轴不是"通用反义词表"，而是**写作维度**上的两极。
 * 只收那些"同时要求会真的打架"的维度：冷硬/温暖 同时要求，模型必然摇摆；
 * 而"简洁"与"第三人称"不在同一维度，同时要求毫无矛盾。
 */
const STYLE_AXES: StyleAxis[] = [
  {
    id: 'temperature',
    label: '温度',
    poles: [
      ['冷硬', '冷峻', '冷静', '疏离', '克制', '客观', '不动声色', '零度', '抽离', '漠然'],
      ['温暖', '温情', '细腻', '柔软', '抒情', '煽情', '感性', '暖心', '热烈', '深情'],
    ],
  },
  {
    id: 'density',
    label: '密度',
    poles: [
      ['简洁', '简练', '洗练', '惜字如金', '短句', '精炼', '干净利落'],
      ['华丽', '繁复', '铺陈', '长句', '辞藻', '浓墨重彩', '精雕细琢'],
    ],
  },
  {
    id: 'pace',
    label: '节奏',
    poles: [
      ['快节奏', '紧凑', '利落', '加速', '不要拖'],
      ['慢节奏', '舒缓', '从容', '留白', '铺开'],
    ],
  },
  {
    id: 'emotion',
    label: '情绪表达',
    poles: [
      ['收敛', '压住', '不外露', '隐忍', '含蓄'],
      ['外放', '爆发', '强烈', '直白', '宣泄'],
    ],
  },
  {
    id: 'explain',
    label: '解释程度',
    poles: [
      ['不要解释', '不解释', '潜台词', '不明说'],
      ['解释清楚', '交代清楚', '说明白', '讲清楚'],
    ],
  },
];

/**
 * 话题面：两条记忆分别针对不同话题面时，一冷一暖并不矛盾（「对话要克制」+「描写要细腻」
 * 完全可以同时成立），此时否决反义冲突。这是误报率最高的一类，必须挡住。
 */
const ASPECT_GROUPS: { id: string; label: string; words: string[] }[] = [
  { id: 'dialogue', label: '对话', words: ['对话', '台词', '对白', '说话', '口吻'] },
  { id: 'description', label: '描写', words: ['描写', '描述', '叙述', '景物', '环境', '外貌', '动作', '场景'] },
  { id: 'psychology', label: '心理', words: ['心理', '内心', '情绪', '情感', '感受'] },
  { id: 'pacing', label: '节奏', words: ['节奏', '推进', '铺垫', '注水', '拖沓'] },
  { id: 'style', label: '文风', words: ['文风', '文笔', '风格', '语言', '用词', '句式', '腔调', '笔调', '文字'] },
  { id: 'plot', label: '情节', words: ['情节', '剧情', '故事', '结构', '冲突', '转折', '悬念'] },
  { id: 'pov', label: '视角', words: ['视角', '人称', '视点'] },
  { id: 'character', label: '人物', words: ['人物', '角色', '主角', '配角', '性格'] },
  { id: 'setting', label: '设定', words: ['设定', '世界观', '规则', '名词', '称呼', '人名'] },
];

/* ------------------------------------------------------------------ *
 * 预画像与判定
 * ------------------------------------------------------------------ */

export interface MemoryProfile {
  id: ID;
  kind: MemoryKind;
  scope: MemoryFact['scope'];
  projectId?: ID;
  taskKinds?: MemoryFact['taskKinds'];
  /** 暂停的记忆不注入，冲突也就无从谈起 */
  paused: boolean;
  /** 归一化全文 */
  normalized: string;
  /** 剥掉取向词之后"在说什么" */
  topic: string;
  polarity: -1 | 0 | 1;
  polarityWords: string[];
  aspects: string[];
  axes: { axis: string; axisLabel: string; pole: 0 | 1; word: string }[];
}

/**
 * 轴词的有效极性：被否定词修饰的轴词要翻到对面。
 *
 * 为什么必须做这一步：「文风要冷硬，不要抒情」里的"抒情"属于温度轴的另一极，
 * 不做否定判断就会得出"这条记忆自相矛盾"的荒谬结论 —— 而它其实和「文风要冷硬」完全一致。
 * 这类误报一旦出现，冲突条就废了。
 */
function effectivePole(normalized: string, index: number, pole: 0 | 1): 0 | 1 {
  const before = normalized.slice(Math.max(0, index - 3), index);
  const negated = /不|别|避免|勿|禁|少|无|非|莫|去/.test(before);
  if (!negated) return pole;
  return pole === 0 ? 1 : 0;
}

/** 预画像：成对比较是 O(n²)，正则只能跑一次 */
export function profileMemory(fact: MemoryFact): MemoryProfile {
  const normalized = stripFalseFriends(normalizeMemoryText(fact.text));
  const aspects = ASPECT_GROUPS.filter((g) => g.words.some((w) => normalized.includes(w))).map((g) => g.id);
  const axes: MemoryProfile['axes'] = [];
  for (const axis of STYLE_AXES) {
    for (const pole of [0, 1] as const) {
      const word = axis.poles[pole].find((w) => normalized.includes(w));
      if (!word) continue;
      const effective = effectivePole(normalized, normalized.indexOf(word), pole);
      // 同一条记忆在同一轴上只保留一个有效极：它自己的两句话互相覆盖，不构成对外冲突
      if (axes.some((a) => a.axis === axis.id)) continue;
      axes.push({ axis: axis.id, axisLabel: axis.label, pole: effective, word });
    }
  }
  return {
    paused: fact.paused,
    id: fact.id,
    kind: fact.kind,
    scope: fact.scope,
    projectId: fact.projectId,
    taskKinds: fact.taskKinds,
    normalized,
    topic: topicOf(fact.text),
    polarity: polarityOf(fact.text),
    polarityWords: polarityWordsOf(fact.text),
    aspects,
    axes,
  };
}

/** 约束类（偏好/教训）互相冲突才有意义；工作习惯（insight）不进模型，永不参与 */
const KIND_FAMILY: Record<MemoryKind, 'constraint' | 'setting' | 'meta'> = {
  preference: 'constraint',
  lesson: 'constraint',
  fact: 'setting',
  convention: 'setting',
  insight: 'meta',
};

/** 否定对立所需的"在说同一件事"门槛 */
const NEGATION_TOPIC_SIMILARITY = 0.42;

/** 两条记忆是否已经解决过（任一方记录了对方就算） */
export function isConflictResolved(a: MemoryFact, b: MemoryFact): boolean {
  const x = a.conflictsResolvedWith ?? [];
  const y = b.conflictsResolvedWith ?? [];
  return x.includes(b.id) || y.includes(a.id);
}

function sharesAspect(a: MemoryProfile, b: MemoryProfile): boolean {
  return a.aspects.some((x) => b.aspects.includes(x));
}

/** 两条记忆永远不会同时注入 → 不需要报冲突 */
function canCoexistInPrompt(a: MemoryProfile, b: MemoryProfile): boolean {
  if (a.scope === 'project' && b.scope === 'project' && a.projectId && b.projectId && a.projectId !== b.projectId) {
    return false;
  }
  if (a.taskKinds?.length && b.taskKinds?.length && !a.taskKinds.some((k) => b.taskKinds?.includes(k))) {
    return false;
  }
  return true;
}

/**
 * 判定两条记忆是否冲突。返回 null 表示"不冲突"——包含"相似但意思一样"（那是重复，不是冲突）。
 */
export function detectConflictBetween(a: MemoryProfile, b: MemoryProfile): MemoryConflict | null {
  if (a.id === b.id) return null;
  if (a.paused || b.paused) return null;
  if (!a.normalized || !b.normalized) return null;
  if (KIND_FAMILY[a.kind] === 'meta' || KIND_FAMILY[b.kind] === 'meta') return null;
  if (KIND_FAMILY[a.kind] !== KIND_FAMILY[b.kind]) return null;
  if (!canCoexistInPrompt(a, b)) return null;
  // 两条各自锁定不同话题面时，一冷一暖并不矛盾
  if (a.aspects.length && b.aspects.length && !sharesAspect(a, b)) return null;

  const full = textSimilarity(a.normalized, b.normalized);
  const topic = textSimilarity(a.topic, b.topic);

  // ① 否定对立：一条禁止、一条要求，且说的是同一件事
  if (a.polarity * b.polarity === -1 && topic >= NEGATION_TOPIC_SIMILARITY) {
    const negative = a.polarity === -1 ? a : b;
    const positive = a.polarity === -1 ? b : a;
    return {
      aId: a.id,
      bId: b.id,
      type: 'negation',
      reason:
        '两条说的是同一件事，但一条要求「' +
        (negative.polarityWords[0] ?? '不要') +
        '」，另一条要求「' +
        (positive.polarityWords[0] ?? '要') +
        '」，同时注入会让模型摇摆。',
      similarity: Math.max(full, topic),
      hits: [...negative.polarityWords.slice(0, 1), ...positive.polarityWords.slice(0, 1)],
      severity: topic >= 0.7 ? 'high' : 'medium',
    };
  }

  // ② 反义维度：同一条写作轴上取向相反
  for (const x of a.axes) {
    for (const y of b.axes) {
      if (x.axis !== y.axis || x.pole === y.pole) continue;
      return {
        aId: a.id,
        bId: b.id,
        type: 'antonym',
        reason:
          '两条在「' + x.axisLabel + '」这一维度上取向相反：一条要「' + x.word + '」，另一条要「' + y.word + '」。',
        similarity: Math.max(full, topic),
        hits: [x.word, y.word],
        severity: sharesAspect(a, b) || !a.aspects.length || !b.aspects.length ? 'high' : 'medium',
      };
    }
  }

  return null;
}

/** 单对便捷入口（加记忆时的即时提示走这里） */
export function detectMemoryConflict(a: MemoryFact, b: MemoryFact): MemoryConflict | null {
  if (isConflictResolved(a, b)) return null;
  return detectConflictBetween(profileMemory(a), profileMemory(b));
}

function pairKey(x: ID, y: ID): string {
  return x < y ? x + '|' + y : y + '|' + x;
}

/**
 * 全量扫描：先给每条记忆做一次画像，再两两比较。
 * 已解决过的组合直接跳过 —— 这是"不要让同一对冲突反复提示"的关键。
 */
export function findMemoryConflicts(facts: MemoryFact[]): MemoryConflict[] {
  const active = facts.filter((f) => !f.paused);
  const profiles = active.map(profileMemory);
  const resolved = new Set<string>();
  for (const f of facts) {
    for (const other of f.conflictsResolvedWith ?? []) resolved.add(pairKey(f.id, other));
  }

  const out: MemoryConflict[] = [];
  for (let i = 0; i < profiles.length; i++) {
    for (let j = i + 1; j < profiles.length; j++) {
      const a = profiles[i];
      const b = profiles[j];
      if (resolved.has(pairKey(a.id, b.id))) continue;
      const c = detectConflictBetween(a, b);
      if (c) out.push(c);
    }
  }
  return out.sort((m, n) => Number(n.severity === 'high') - Number(m.severity === 'high') || n.similarity - m.similarity);
}

/** 重复检测（不是冲突）：同一句话的两种说法，提示合并即可，不要吓唬作者 */
export function findNearDuplicates(facts: MemoryFact[], threshold = 0.75): { aId: ID; bId: ID; similarity: number }[] {
  const active = facts.filter((f) => !f.paused);
  const out: { aId: ID; bId: ID; similarity: number }[] = [];
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      if (active[i].kind !== active[j].kind) continue;
      const sim = textSimilarity(active[i].text, active[j].text);
      if (sim >= threshold) out.push({ aId: active[i].id, bId: active[j].id, similarity: sim });
    }
  }
  return out.sort((a, b) => b.similarity - a.similarity);
}
