import type {
  Chapter, Character, ContextSource, ID, Project, PlotThread, SemanticRecallSettings, TimelineEvent, WorldEntry,
} from '@/core';
import { db } from '@/db/database';
import { loadSettings } from '@/db/repo/settings';
import { buildRecallQuery, memoryForProject } from '@/db/repo/memory';
import { recallMemories, rerankBySimilarity, splitPassages } from './recall';
import { embedOne, embeddingSettings, passageVectors, sectionVectors } from './embedding';
import { estimateTokens, fillBudget, type BudgetPiece } from '@/utils/tokens';
import { headContext, tailContext, truncate } from '@/utils/text';
import { POV_LABEL } from './prompts';

export interface BuildContextOptions {
  /** 需要哪些上下文板块；不传用默认集合 */
  sections?: ContextSection[];
  projectId: ID;
  chapterId?: ID;
  /** tokens 上限，默认取设置里的 contextBudget */
  budget?: number;
  /** 需要哪些板块 */
  include?: ContextSection[];
  /** 选中文本（改写/润色时用） */
  selection?: string;
  /** 检索查询词，用于召回相关历史片段 */
  query?: string;
  /** 检索召回的片段数 */
  recall?: number;
}

export type ContextSection =
  | 'profile' | 'outline' | 'characters' | 'world' | 'threads'
  | 'timeline' | 'rules' | 'history' | 'style' | 'retrieval' | 'negative' | 'memory';

export interface BuiltContext {
  /** 最终拼好的上下文文本 */
  text: string;
  sources: ContextSource[];
  tokens: number;
  dropped: string[];
  /** 当前章节（如有） */
  chapter?: Chapter;
  project?: Project;
}

const SECTION_LABEL: Record<ContextSection, string> = {
  profile: '作品档案',
  outline: '大纲结构',
  characters: '人物设定',
  world: '世界观设定',
  threads: '伏笔与支线',
  timeline: '时间线',
  rules: '写作规则',
  history: '前文脉络',
  style: '文风样本',
  retrieval: '相关历史片段',
  negative: '作者反馈（避免重犯）',
  memory: '写作记忆（长期积累的设定与约定）',
};

/**
 * 语义重排用的条目向量文本。与 embedding 缓存判据（文本+模型）绑定：
 * 改动拼接方式会让对应缓存整体失效并惰性重算（预期行为，无需迁移）。
 * verify-recall 的浏览器验收也用它独立复算期望顺序，避免两边各写一份拼接逻辑。
 */
export const VEC_TEXT = {
  character: (c: Character) => [c.name, c.tagline, c.personality, c.want, c.background].filter(Boolean).join('｜'),
  world: (e: WorldEntry) => [e.title, e.aliases.join('、'), e.body].filter(Boolean).join('｜'),
  thread: (t: PlotThread) => [t.title, t.description].filter(Boolean).join('｜'),
  event: (e: TimelineEvent) => [e.title, e.description].filter(Boolean).join('｜'),
};

/** 默认板块：创作类任务要人物和世界观；分析类也要 */
const DEFAULT_SECTIONS: ContextSection[] = [
  'profile', 'outline', 'characters', 'world', 'threads', 'rules', 'memory', 'history', 'style', 'negative',
];

export async function buildContext(opts: BuildContextOptions): Promise<BuiltContext> {
  const settings = loadSettings();
  const budget = opts.budget ?? settings.contextBudget;
  const sections = opts.sections ?? opts.include ?? DEFAULT_SECTIONS;

  const project = await db.projects.get(opts.projectId);
  if (!project) return { text: '', sources: [], tokens: 0, dropped: [], };

  const chapter = opts.chapterId ? await db.chapters.get(opts.chapterId) : undefined;
  const allChapters = (await db.chapters.where('projectId').equals(opts.projectId).toArray()).sort((a, b) => a.order - b.order);
  const currentIndex = chapter ? allChapters.findIndex((c) => c.id === chapter.id) : allChapters.length;

  // 并发拉取所有可能的素材，后面按需使用
  const [characters, worldEntries, threads, rules, arcs, metrics, style] = await Promise.all([
    db.characters.where('projectId').equals(opts.projectId).toArray(),
    db.worldEntries.where('projectId').equals(opts.projectId).toArray(),
    db.plotThreads.where('projectId').equals(opts.projectId).toArray(),
    db.rules.where('projectId').equals(opts.projectId).toArray(),
    db.arcs.where('projectId').equals(opts.projectId).toArray(),
    db.metrics.where('projectId').equals(opts.projectId).toArray(),
    db.styles.where('projectId').equals(opts.projectId).toArray(),
  ]);

  const pieces: BudgetPiece[] = [];

  // ---------- 语义重排准备 ----------
  // 开关关闭 / query 为空 / 向量服务不可用 → queryVec 为 null，下面所有板块
  // 走原规则顺序（与不开语义时逐字节一致），且不发任何网络请求。
  const sem = embeddingSettings();
  const rerankable =
    sections.some((s) => s === 'characters' || s === 'world' || s === 'threads' || s === 'timeline') ||
    (sections.includes('retrieval') && !!opts.query);
  let queryVec: number[] | null = null;
  if (sem.enabled && rerankable) {
    let q = (opts.query ?? '').trim();
    if (!q) {
      try {
        q = (await buildRecallQuery(opts.projectId, opts.chapterId)).trim();
      } catch {
        q = '';
      }
    }
    if (q) queryVec = await embedOne(q, sem);
  }

  const push = (key: string, label: string, text: string, priority: number, required = false) => {
    if (!text.trim()) return;
    pieces.push({ key, label, text: text.trim(), priority, required });
  };

  // ---------- 1. 作品档案（必选） ----------
  if (sections.includes('profile')) {
    push('profile', SECTION_LABEL.profile, profileBlock(project), 0, true);
  }

  // ---------- 2. 当前章节任务 ----------
  if (chapter) {
    const task = chapterBlock(chapter, arcs.find((a) => a.id === chapter.arcId));
    push('chapter-task', `当前章节：${chapter.title}`, task, 1, true);
  }

  // ---------- 3. 人物 ----------
  if (sections.includes('characters')) {
    const relevant = pickRelevantCharacters(characters, chapter, currentIndex, allChapters);
    // 主角团 = 硬成员（本章出场 / POV），不进重排；配角在候选内部按语义重排
    let supporting = relevant.supporting;
    if (queryVec && supporting.length) {
      const { vectors } = await sectionVectors(
        opts.projectId,
        supporting.map((c) => ({ id: c.id, text: VEC_TEXT.character(c) })),
        sem,
      );
      const rr = rerankBySimilarity(supporting.map((c) => c.id), vectors, queryVec);
      if (rr.applied) {
        const byId = new Map(supporting.map((c) => [c.id, c]));
        supporting = rr.ids.flatMap((id) => byId.get(id) ?? []);
      }
    }
    if (relevant.primary.length) {
      push('characters-main', `${SECTION_LABEL.characters}（核心）`, relevant.primary.map((c) => characterBlock(c, 'full')).join('\n\n'), 2, true);
    }
    if (supporting.length) {
      push('characters-sub', `${SECTION_LABEL.characters}（配角）`, supporting.map((c) => characterBlock(c, 'brief')).join('\n'), 6);
    }
  }

  // ---------- 4. 世界观 ----------
  if (sections.includes('world') && worldEntries.length) {
    const relevant = pickRelevantWorld(worldEntries, chapter, opts.query);
    let hot = relevant.hot;
    let worldVecs: Map<string, number[]> | null = null;
    if (queryVec) {
      worldVecs = (await sectionVectors(
        opts.projectId,
        worldEntries.map((e) => ({ id: e.id, text: VEC_TEXT.world(e) })),
        sem,
      )).vectors;
      // 硬成员 = 本章地点 / 章节梗概点名的条目；其余（query 命中、重要度≥4）参与重排
      const isHard = (e: WorldEntry) =>
        !!chapter && (chapter.locationIds.includes(e.id) || !!chapter.summary?.includes(e.title));
      const hard = hot.filter(isHard);
      const soft = hot.filter((e) => !isHard(e));
      const rr = rerankBySimilarity(soft.map((e) => e.id), worldVecs, queryVec);
      if (rr.applied) {
        const byId = new Map(worldEntries.map((e) => [e.id, e]));
        hot = [...hard, ...rr.ids.flatMap((id) => byId.get(id) ?? [])].slice(0, 10);
      }
    }
    if (hot.length) {
      push('world-hot', `${SECTION_LABEL.world}（相关条目）`, hot.map((e) => worldBlock(e, 'full')).join('\n\n'), 3, true);
    }
    // 冷索引池：开着语义时按相似度取前 24（被重排挤出 hot 的条目会落回这里），否则维持原顺序
    let cold = worldEntries.filter((e) => !hot.includes(e));
    if (queryVec && worldVecs) {
      const rr = rerankBySimilarity(cold.map((e) => e.id), worldVecs, queryVec, { limit: 24 });
      if (rr.applied) {
        const byId = new Map(worldEntries.map((e) => [e.id, e]));
        cold = rr.ids.flatMap((id) => byId.get(id) ?? []);
      } else {
        cold = cold.slice(0, 24);
      }
    } else {
      cold = cold.slice(0, 24);
    }
    if (cold.length) {
      push('world-index', `${SECTION_LABEL.world}（其他条目索引）`, cold.map((e) => `- [${e.category}] ${e.title}：${truncate(e.body.replace(/\n/g, ' '), 60)}`).join('\n'), 8);
    }
  }

  // ---------- 5. 伏笔 ----------
  if (sections.includes('threads') && threads.length) {
    const active = threads.filter((t) => t.status !== 'resolved' && t.status !== 'abandoned');
    const due = active.filter((t) => t.plannedPayoffChapterId && chapter && t.plannedPayoffChapterId === chapter.id);
    let others = active.filter((t) => !due.includes(t));
    // 计划回收 = 硬成员；其余伏笔在候选内部按语义重排
    if (queryVec && others.length) {
      const { vectors } = await sectionVectors(
        opts.projectId,
        others.map((t) => ({ id: t.id, text: VEC_TEXT.thread(t) })),
        sem,
      );
      const rr = rerankBySimilarity(others.map((t) => t.id), vectors, queryVec, { limit: 30 });
      if (rr.applied) {
        const byId = new Map(others.map((t) => [t.id, t]));
        others = rr.ids.flatMap((id) => byId.get(id) ?? []);
      }
    }
    const lines: string[] = [];
    if (due.length) lines.push('【本章计划回收】\n' + due.map(threadLine).join('\n'));
    if (others.length) lines.push('【进行中伏笔】\n' + others.slice(0, 30).map(threadLine).join('\n'));
    push('threads', SECTION_LABEL.threads, lines.join('\n'), 4);
  }

  // ---------- 6. 时间线 ----------
  if (sections.includes('timeline')) {
    const events = (await db.timelineEvents.where('projectId').equals(opts.projectId).toArray()).sort((a, b) => a.orderKey - b.orderKey);
    if (events.length) {
      const near = events.filter((e) => chapter && e.chapterIds.includes(chapter.id));
      const recent = events.slice(-18);
      let merged = Array.from(new Map([...near, ...recent].map((e) => [e.id, e])).values());
      // 含本章的事件 = 硬成员；其余在合并集内部按语义重排
      if (queryVec) {
        const nearIds = new Set(near.map((e) => e.id));
        const soft = merged.filter((e) => !nearIds.has(e.id));
        if (soft.length) {
          const { vectors } = await sectionVectors(
            opts.projectId,
            soft.map((e) => ({ id: e.id, text: VEC_TEXT.event(e) })),
            sem,
          );
          const rr = rerankBySimilarity(soft.map((e) => e.id), vectors, queryVec);
          if (rr.applied) {
            const byId = new Map(merged.map((e) => [e.id, e]));
            merged = [...merged.filter((e) => nearIds.has(e.id)), ...rr.ids.flatMap((id) => byId.get(id) ?? [])];
          }
        }
      }
      push('timeline', SECTION_LABEL.timeline, merged.map((e) => `- ${e.inWorldTime ? `[${e.inWorldTime}] ` : ''}${e.title}${e.description ? `：${truncate(e.description, 60)}` : ''}`).join('\n'), 5);
    }
  }

  // ---------- 7. 规则 ----------
  if (sections.includes('rules')) {
    const enabled = rules.filter((r) => r.enabled);
    if (enabled.length) {
      push('rules', SECTION_LABEL.rules, enabled.map((r) => `- [${r.severity === 'error' ? '硬性' : r.severity === 'warn' ? '建议' : '参考'}] ${r.name}：${r.description}${r.value ? `（${r.value}）` : ''}`).join('\n'), 3);
    }
  }

  // ---------- 7.5 写作记忆（事实与约定） ----------
  // 偏好与教训在 system prompt 里（那里才是硬约束）；这里放"需要知道的事实"：
  // 设定事实、名词约定，以及作者手动置顶但还没进 prompt 上限的条目。
  if (sections.includes('memory')) {
    const memories = await memoryForProject(opts.projectId);
    // 进入上下文的记忆有三类：设定事实、名词约定、置顶的偏好/教训。
    // 语义召回（默认关闭）只在这批候选内部重排：与当前章节最相关的优先进入预算，
    // 关闭时 recallMemories 原样返回候选，顺序与改动前一致。
    const candidates = memories.filter(
      (m) => m.kind === 'fact' || m.kind === 'convention' || (m.pinned && (m.kind === 'preference' || m.kind === 'lesson')),
    );
    const recall = await recallMemories({
      projectId: opts.projectId,
      facts: candidates,
      chapterId: opts.chapterId,
      query: opts.query,
    });
    const ordered = recall.facts;
    const facts = ordered.filter((m) => m.kind === 'fact' || m.kind === 'convention');
    const pinnedExtra = ordered.filter(
      (m) => m.pinned && (m.kind === 'preference' || m.kind === 'lesson'),
    );
    const lines: string[] = [];
    if (facts.length) {
      for (const m of facts.slice(0, 24)) {
        lines.push(`- [${m.kind === 'fact' ? '设定' : '约定'}] ${m.text}${m.confidence >= 0.8 ? '' : '（待确认）'}`);
      }
    }
    if (pinnedExtra.length) {
      lines.push('', '作者特别强调：');
      for (const m of pinnedExtra.slice(0, 8)) lines.push(`- ${m.text}`);
    }
    if (lines.length) push('memory', SECTION_LABEL.memory, lines.join('\n'), 4);
  }

  // ---------- 8. 前文脉络 ----------
  if (sections.includes('history')) {
    const history = historyBlock(allChapters, currentIndex, metrics);
    push('history', SECTION_LABEL.history, history, 7);
  }

  // ---------- 9. 文风样本 ----------
  if (sections.includes('style')) {
    const styleBlockText = await buildStyleBlock(opts.projectId, allChapters, currentIndex, style);
    push('style', SECTION_LABEL.style, styleBlockText, 9);
  }

  // ---------- 10. 检索召回 ----------
  // 向量优先：分片全部有向量且有正相似度时按余弦取前 k；任一步不满足则回退 BM25，
  // 保证「开了开关但服务不可用 / 索引还在暖机」时行为不劣于现状。
  if (sections.includes('retrieval') && opts.query) {
    let recalled: string | null = null;
    if (queryVec) {
      recalled = await recallPassagesByVector(opts.projectId, queryVec, allChapters, currentIndex, opts.recall ?? 4, sem);
    }
    if (recalled === null) {
      recalled = await recallPassages(opts.projectId, opts.query, allChapters, currentIndex, opts.recall ?? 4);
    }
    if (recalled) push('retrieval', SECTION_LABEL.retrieval, recalled, 10);
  }

  // ---------- 11. 作者负反馈 ----------
  if (sections.includes('negative')) {
    const neg = await db.feedback.where('projectId').equals(opts.projectId).toArray();
    const notes = neg.filter((f) => f.rating === -1 && f.note).slice(-6).map((f) => `- ${f.note}`);
    if (notes.length) push('negative', SECTION_LABEL.negative, notes.join('\n'), 11);
  }

  // ---------- 预算裁剪 ----------
  const result = fillBudget(pieces, budget);
  const text = result.parts
    .map((p) => {
      const key = p.key;
      if (key === 'profile' || key === 'chapter-task' || key === 'rules' || key === 'negative') return p.text;
      return `## ${p.label}\n${p.text}`;
    })
    .join('\n\n');

  const sources: ContextSource[] = result.parts.map((p) => ({
    kind: kindOf(p.key),
    label: p.label,
    tokens: p.tokens,
    trimmed: p.trimmed,
  }));

  return {
    text,
    sources,
    tokens: result.used,
    dropped: result.dropped,
    chapter,
    project,
  };
}

function kindOf(key: string): ContextSource['kind'] {
  if (key.startsWith('character')) return 'character';
  if (key.startsWith('world')) return 'world';
  if (key.startsWith('thread')) return 'thread';
  if (key.startsWith('timeline')) return 'timeline';
  if (key.startsWith('rules')) return 'rule';
  if (key.startsWith('retrieval')) return 'retrieval';
  if (key.startsWith('memory')) return 'user-note';
  if (key.startsWith('history') || key.startsWith('style')) return 'summary';
  if (key.startsWith('chapter')) return 'chapter';
  return 'user-note';
}

// ================= 各板块渲染 =================

function profileBlock(p: Project): string {
  const lines = [
    '## 作品档案',
    `书名：${p.title}${p.subtitle ? `（${p.subtitle}）` : ''}`,
  ];
  if (p.genres.length) lines.push(`体裁：${p.genres.join('、')}`);
  if (p.themes.length) lines.push(`主题：${p.themes.join('、')}`);
  lines.push(`视角：${POV_LABEL[p.pov]}；时态：${p.tense === 'past' ? '过去时' : '现在时'}`);
  if (p.logline) lines.push(`一句话故事：${p.logline}`);
  if (p.synopsis) lines.push(`故事梗概：${p.synopsis}`);
  if (p.styleGuide) lines.push(`文风要求：${p.styleGuide}`);
  if (p.forbidden.length) lines.push(`禁止出现：${p.forbidden.join('、')}`);
  if (p.customInstructions) lines.push(`作者补充要求：${p.customInstructions}`);
  return lines.join('\n');
}

function chapterBlock(c: Chapter, arc?: { title: string }): string {
  const lines = [`## 本章任务（第${c.order + 1}章）`];
  if (arc) lines.push(`所属卷：${arc.title}`);
  lines.push(`章节名：${c.title}`);
  if (c.summary) lines.push(`本章梗概：${c.summary}`);
  if (c.goals.length) lines.push(`必须完成：\n${c.goals.map((g) => `- ${g}`).join('\n')}`);
  if (c.hook) lines.push(`开篇钩子：${c.hook}`);
  if (c.cliffhanger) lines.push(`结尾钩子：${c.cliffhanger}`);
  if (c.storyTime) lines.push(`剧情内时间：${c.storyTime}`);
  if (c.beats.length) {
    lines.push(`场景节拍：\n${c.beats.map((b, i) => `${i + 1}. [${b.kind}] ${b.summary}`).join('\n')}`);
  }
  return lines.join('\n');
}

function characterBlock(c: Character, mode: 'full' | 'brief'): string {
  if (mode === 'brief') {
    const bits = [c.tagline, c.personality && truncate(c.personality, 50)].filter(Boolean);
    return `- ${c.name}${c.aliases.length ? `（${c.aliases.join('/')}）` : ''}｜${ROLE_LABEL[c.role]}${bits.length ? `｜${bits.join('｜')}` : ''}`;
  }
  const lines = [`### ${c.name}${c.aliases.length ? `（别称：${c.aliases.join('、')}）` : ''}`];
  const kv: [string, string | undefined][] = [
    ['身份', ROLE_LABEL[c.role]],
    ['年龄', c.age],
    ['性别', c.gender],
    ['定位', c.tagline],
    ['外貌', c.appearance],
    ['性格', c.personality],
    ['欲望', c.want],
    ['需要', c.need],
    ['恐惧', c.fear],
    ['缺陷', c.flaw],
    ['弧光', c.arc],
    ['秘密', c.secrets],
    ['能力', c.abilities?.length ? c.abilities.join('、') : undefined],
    ['背景', c.background],
  ];
  for (const [k, v] of kv) if (v) lines.push(`- ${k}：${v}`);
  if (c.voice) {
    const v = c.voice;
    const voiceBits = [
      v.tone && `语气${v.tone}`,
      v.register && `语域${v.register}`,
      v.verbalTics?.length && `口癖「${v.verbalTics.join('」「')}」`,
      v.favoriteWords?.length && `爱用词：${v.favoriteWords.join('、')}`,
      v.neverSays?.length && `绝不会说：${v.neverSays.join('、')}`,
    ].filter(Boolean) as string[];
    if (voiceBits.length) lines.push(`- 说话方式：${voiceBits.join('；')}`);
    if (v.sampleLines?.length) lines.push(`- 台词样例：\n${v.sampleLines.map((s) => `  · ${s}`).join('\n')}`);
  }
  if (c.writingNotes) lines.push(`- 写作提示：${c.writingNotes}`);
  return lines.join('\n');
}

const ROLE_LABEL: Record<Character['role'], string> = {
  protagonist: '主角', antagonist: '反派', deuteragonist: '第二主角', mentor: '导师',
  foil: '对照角色', 'love-interest': '情感线角色', sidekick: '伙伴', minor: '配角', cameo: '龙套',
};

function worldBlock(e: WorldEntry, mode: 'full' | 'brief'): string {
  if (mode === 'brief') return `- [${e.category}] ${e.title}：${truncate(e.body.replace(/\n/g, ' '), 70)}`;
  const lines = [`### ${e.title}（${e.category}）`];
  if (e.aliases.length) lines.push(`别称：${e.aliases.join('、')}`);
  lines.push(e.body);
  for (const r of e.rules.filter((x) => x.enabled)) {
    lines.push(`- 【${r.severity === 'error' ? '硬规则' : '规则'}】${r.statement}`);
  }
  return lines.join('\n');
}

function threadLine(t: PlotThread): string {
  const status = t.status === 'planted' ? '已埋设' : t.status === 'partially-paid' ? '部分回收' : t.status === 'overdue' ? '已超期' : '计划中';
  return `- ${t.title}（${t.priority === 'main' ? '主线' : t.priority === 'major' ? '重要' : '次要'}｜${status}）${t.description ? `：${truncate(t.description, 60)}` : ''}`;
}

/** 人物选取：本章出场 > 主角团 > 其他 */
function pickRelevantCharacters(
  all: Character[],
  chapter: Chapter | undefined,
  currentIndex: number,
  chapters: Chapter[],
): { primary: Character[]; supporting: Character[] } {
  const inChapter = new Set(chapter?.characterIds ?? []);
  const povId = chapter?.povCharacterId;
  const primary: Character[] = [];
  const supporting: Character[] = [];

  const byId = new Map(all.map((c) => [c.id, c]));

  // 本章出场
  for (const id of inChapter) {
    const c = byId.get(id);
    if (c) primary.push(c);
  }
  if (povId && !inChapter.has(povId)) {
    const c = byId.get(povId);
    if (c) primary.unshift(c);
  }

  // 叙事人（第一人称）
  const narrator = all.find((c) => c.role === 'protagonist' && !primary.includes(c));
  if (primary.length === 0 && narrator) primary.push(narrator);

  // 出场次数排序，取前 8 作为常驻配角
  const counts = new Map<ID, number>();
  for (const ch of chapters.slice(Math.max(0, currentIndex - 30), currentIndex + 1)) {
    for (const id of ch.characterIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const ranked = all
    .filter((c) => !primary.includes(c) && c.role !== 'cameo')
    .sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) || roleRank(a.role) - roleRank(b.role));
  for (const c of ranked) {
    if (supporting.length >= 10) break;
    if ((counts.get(c.id) ?? 0) > 0 || c.role === 'antagonist' || c.role === 'deuteragonist' || c.role === 'mentor') supporting.push(c);
  }

  return { primary: primary.slice(0, 6), supporting };
}

function roleRank(r: Character['role']): number {
  const order: Character['role'][] = ['protagonist', 'antagonist', 'deuteragonist', 'mentor', 'love-interest', 'foil', 'sidekick', 'minor', 'cameo'];
  return order.indexOf(r);
}

/** 世界观条目选取：本章地点 > 关键词命中 > 高重要度 */
function pickRelevantWorld(all: WorldEntry[], chapter: Chapter | undefined, query?: string): { hot: WorldEntry[] } {
  const hot: WorldEntry[] = [];
  const inChapter = new Set(chapter?.locationIds ?? []);
  for (const e of all) {
    if (inChapter.has(e.id) || (chapter && chapter.summary?.includes(e.title))) hot.push(e);
  }
  if (query) {
    for (const e of all) {
      if (hot.includes(e)) continue;
      if (query.includes(e.title) || e.aliases.some((a) => query.includes(a))) hot.push(e);
      if (hot.length >= 12) break;
    }
  }
  const rest = all.filter((e) => !hot.includes(e)).sort((a, b) => b.importance - a.importance);
  for (const e of rest) {
    if (hot.length >= 10) break;
    if (e.importance >= 4) hot.push(e);
  }
  return { hot: hot.slice(0, 10) };
}

/** 前文脉络：每章一行摘要 + 最近一章的结尾原文 */
function historyBlock(chapters: Chapter[], currentIndex: number, metrics: { chapterId: ID; tension: number }[]): string {
  const past = chapters.slice(0, currentIndex);
  if (!past.length) return '';
  const tensionMap = new Map(metrics.map((m) => [m.chapterId, m.tension]));
  const lines = past.map((c) => {
    const t = tensionMap.get(c.id);
    return `第${c.order + 1}章 ${c.title}：${c.summary ? truncate(c.summary, 70) : '（无梗概）'}${t !== undefined ? `（张力${t}）` : ''}`;
  });
  return lines.join('\n');
}

/** 文风样本：从最近章节里摘一段作者自己的原文 */
async function buildStyleBlock(
  projectId: ID,
  chapters: Chapter[],
  currentIndex: number,
  fingerprints: { prompt: string; computedAt: string }[],
): Promise<string> {
  const parts: string[] = [];
  const fp = fingerprints.sort((a, b) => (a.computedAt < b.computedAt ? 1 : -1))[0];
  if (fp?.prompt) parts.push(`【文风画像】${fp.prompt}`);

  const candidates = chapters.slice(0, currentIndex).filter((c) => c.wordCount > 200).slice(-3);
  for (const c of candidates.reverse().slice(0, 2)) {
    const content = await db.chapterContents.get(c.id);
    if (!content?.text) continue;
    parts.push(`【作者原文样本 · ${c.title}】\n${tailContext(content.text, 600)}`);
  }
  void projectId;
  return parts.join('\n\n');
}

/**
 * 向量检索：段落分片按余弦取前 k。
 *
 * 返回 null 表示"向量链路没生效"（分片没齐 / 无正相似度 / 服务不可达），
 * 调用方收到 null 就回退 BM25 —— 与 rerankBySimilarity 的整体回退约定一致，
 * 暖机期宁可先用关键词召回，也不把没向量的段落当成"不相关"丢掉。
 */
async function recallPassagesByVector(
  projectId: ID,
  queryVec: number[],
  chapters: Chapter[],
  currentIndex: number,
  k: number,
  cfg: SemanticRecallSettings,
): Promise<string | null> {
  const past = chapters.slice(0, currentIndex);
  if (!past.length) return null;

  const chunks: { id: string; text: string; chapter: Chapter }[] = [];
  for (const c of past) {
    const content = await db.chapterContents.get(c.id);
    if (!content?.text) continue;
    for (const sp of splitPassages(c.id, content.text)) {
      chunks.push({ id: sp.id, text: sp.text, chapter: c });
    }
  }
  if (!chunks.length) return null;

  const { vectors } = await passageVectors(
    projectId,
    chunks.map((x) => ({ id: x.id, text: x.text })),
    cfg,
  );
  const rr = rerankBySimilarity(
    chunks.map((x) => x.id),
    vectors,
    queryVec,
    { limit: k },
  );
  if (!rr.applied) return null;

  const byId = new Map(chunks.map((x) => [x.id, x]));
  return rr.ids
    .flatMap((id) => {
      const hit = byId.get(id);
      if (!hit) return [];
      return [`- （第${hit.chapter.order + 1}章 ${hit.chapter.title}）${truncate(hit.text, 220)}`];
    })
    .join('\n');
}

/** 轻量检索：BM25 风格打分，召回与查询最相关的历史段落（向量链路失败时的兜底） */
async function recallPassages(
  projectId: ID,
  query: string,
  chapters: Chapter[],
  currentIndex: number,
  k: number,
): Promise<string> {
  const terms = extractTerms(query);
  if (!terms.length) return '';
  const past = chapters.slice(0, currentIndex);
  if (!past.length) return '';

  const scored: { chapter: Chapter; score: number; snippet: string }[] = [];
  for (const c of past) {
    const content = await db.chapterContents.get(c.id);
    if (!content?.text) continue;
    const paras = content.text.split(/\n+/).filter((p) => p.trim().length > 20);
    let best = { score: 0, snippet: '' };
    for (const p of paras) {
      let score = 0;
      for (const t of terms) {
        const n = countOccurrences(p, t);
        if (n > 0) score += 1 + Math.log(n);
      }
      if (score > best.score) best = { score, snippet: p.trim() };
    }
    if (best.score > 0) scored.push({ chapter: c, score: best.score, snippet: best.snippet });
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, k);
  if (!top.length) return '';
  void projectId;
  return top
    .map((s) => `- （第${s.chapter.order + 1}章 ${s.chapter.title}）${truncate(s.snippet, 220)}`)
    .join('\n');
}

function extractTerms(q: string): string[] {
  const out = new Set<string>();
  // 中文按 2-4 字滑窗取词，同时保留英文单词
  const cjk = q.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  for (const seg of cjk) {
    for (let n = 2; n <= 4; n++) {
      for (let i = 0; i + n <= seg.length; i++) out.add(seg.slice(i, i + n));
    }
  }
  for (const w of q.match(/[A-Za-z]{3,}/g) ?? []) out.add(w.toLowerCase());
  // 去掉过于常见的虚词组合
  const stop = new Set(['的时', '了的', '是在', '一个', '这个', '什么', '可以', '就是']);
  return Array.from(out).filter((t) => !stop.has(t)).slice(0, 40);
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx >= 0) {
    count += 1;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

/** 便捷函数：只要文本 */
export async function contextText(opts: BuildContextOptions): Promise<string> {
  return (await buildContext(opts)).text;
}

/** 取章节正文的尾部（作为续写的断点） */
export async function chapterTail(chapterId: ID, chars = 1200): Promise<string> {
  const content = await db.chapterContents.get(chapterId);
  if (!content?.text) return '';
  return tailContext(content.text, chars);
}

/** 取章节正文的头部 */
export async function chapterHead(chapterId: ID, chars = 800): Promise<string> {
  const content = await db.chapterContents.get(chapterId);
  if (!content?.text) return '';
  return headContext(content.text, chars);
}

export { estimateTokens };
