/**
 * Dexie v1 的表结构快照。
 *
 * 保留它是因为 Dexie 要求每个版本都声明当时的完整结构，否则从 v1 升级到 v2 时
 * 无法正确 diff（会误删/重建索引）。**不要修改这个文件**，它只是历史快照。
 */
export const V1_STORES = {
  projects: 'id, title, status, updatedAt, createdAt',
  arcs: 'id, projectId, [projectId+order], order',
  chapters: 'id, projectId, [projectId+order], arcId, status, updatedAt',
  chapterContents: 'chapterId, projectId',
  outlineNodes: 'id, projectId, parentId, [projectId+order]',
  snapshots: 'id, chapterId, [projectId+chapterId], createdAt',
  characters: 'id, projectId, role, status, name',
  relationships: 'id, projectId, fromId, toId',
  characterAppearances: 'id, characterId, chapterId, [characterId+chapterId]',
  worldEntries: 'id, projectId, category, parentId, title',
  factions: 'id, projectId, name',
  entities: 'id, projectId, kind, name, [projectId+name]',
  entityMentions: 'id, projectId, entityId, chapterId, [entityId+chapterId]',
  plotThreads: 'id, projectId, status, kind, plantedChapterId, payoffChapterId',
  timelineEvents: 'id, projectId, orderKey, arcId',
  glossary: 'id, projectId, canonical',
  rules: 'id, projectId, enabled, scope',
  issues: 'id, projectId, chapterId, status, kind, severity, [projectId+status]',
  metrics: 'id, projectId, chapterId, [projectId+order]',
  styles: 'id, projectId, computedAt',
  goals: 'id, projectId',
  sessions: 'id, projectId, startedAt, [projectId+startedAt]',
  pomodoros: 'id, projectId, startedAt',
  aiSessions: 'id, projectId, taskKind, chapterId, updatedAt',
  generations: 'id, projectId, taskKind, chapterId, createdAt',
  suggestions: 'id, projectId, chapterId, status, createdAt',
  embeddings: 'id, projectId, [projectId+kind], refId',
  providers: 'id, kind, enabled',
  routing: 'kind',
  pricing: 'id, key',
  prompts: 'id, taskKind, builtin',
  feedback: 'id, projectId, taskKind, createdAt',
  appState: 'id',
  genesis: 'id, projectId, status, createdAt',
} as const;

/**
 * Dexie v2 的表结构快照（新增审稿两张表）。
 * 同样不要修改 —— 它是从 v2 升级到 v3 时的 diff 基准。
 */
export const V2_STORES = {
  ...V1_STORES,
  comments: 'id, projectId, chapterId, [chapterId+resolved], resolved, createdAt',
  reviewSuggestions: 'id, projectId, chapterId, [chapterId+status], status, createdAt',
} as const;

/**
 * Dexie v3 的表结构快照（新增写作记忆 memory）。
 *
 * 它是从 v3 升级到 v4 的 diff 基准：v4 只多了 memoryUsage 一张表。
 * 之所以要单独冻结一份，是因为一旦直接在 DB_STORES 上继续加表，
 * 老库（v3）升级时 Dexie 会拿"v3 声明"与"v4 声明"做 diff，
 * 而 v3 声明里少了 memory —— Dexie 会认为 memory 是 v4 才新增的，
 * 于是把它当新表处理；更糟的是如果删过索引，老库里已有的索引不会被正确保留。
 * 一句话：**每个版本的完整结构都必须原样留着**，不要图省事直接复用 DB_STORES。
 */
export const V3_STORES = {
  ...V2_STORES,
  memory: 'id, scope, projectId, kind, paused, dedupeKey, [scope+kind], [projectId+kind]',
} as const;

/**
 * Dexie v4 的表结构快照（新增 memoryUsage）。
 *
 * 之前这里缺了一份：版本声明直接从 v3 跳到"最新"，中间没有 v4。
 * Dexie 做 diff 时用的是"已声明版本"的链条，缺一环就意味着老库（v3）升级时
 * 少一个基准点 —— memoryUsage 能不能被正确建出来全看运气。
 * 现在补齐 v4，链条完整：v1 → v2 → v3 → v4 → v5。
 */
export const V4_STORES = {
  ...V3_STORES,
  memoryUsage: 'id, projectId, generationId, factId, createdAt',
} as const;
