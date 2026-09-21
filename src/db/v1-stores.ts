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
