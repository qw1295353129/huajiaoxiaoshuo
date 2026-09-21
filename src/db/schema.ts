import type { EntityTable } from 'dexie';
import type {
  AiFeedback, AiGeneration, AiSession, AiSuggestion, AppState, Arc, Chapter, ChapterContent,
  ChapterMetric, Character, CharacterAppearance, ContinuityRule, Entity, EntityMention, Faction,
  GlossaryTerm, Issue, PlotThread, PomodoroRecord, Project, PromptTemplate, ProviderConfig,
  Relationship, Snapshot, StyleFingerprint, TaskRouting, TimelineEvent, WritingGoal, WritingSession,
  WorldEntry, OutlineNode, GenesisRun, ModelPricing, ChapterComment, ReviewSuggestion, MemoryFact,
} from '@/core';

/** 每个 projectId 开头的表都带上项目隔离，便于级联删除 */
export interface HuaJiaoDB {
  projects: EntityTable<Project, 'id'>;
  arcs: EntityTable<Arc, 'id'>;
  chapters: EntityTable<Chapter, 'id'>;
  chapterContents: EntityTable<ChapterContent, 'chapterId'>;
  outlineNodes: EntityTable<OutlineNode, 'id'>;
  snapshots: EntityTable<Snapshot, 'id'>;
  comments: EntityTable<ChapterComment, 'id'>;
  reviewSuggestions: EntityTable<ReviewSuggestion, 'id'>;
  memory: EntityTable<MemoryFact, 'id'>;
  characters: EntityTable<Character, 'id'>;
  relationships: EntityTable<Relationship, 'id'>;
  characterAppearances: EntityTable<CharacterAppearance, 'id'>;
  worldEntries: EntityTable<WorldEntry, 'id'>;
  factions: EntityTable<Faction, 'id'>;
  entities: EntityTable<Entity, 'id'>;
  entityMentions: EntityTable<EntityMention, 'id'>;
  plotThreads: EntityTable<PlotThread, 'id'>;
  timelineEvents: EntityTable<TimelineEvent, 'id'>;
  glossary: EntityTable<GlossaryTerm, 'id'>;
  rules: EntityTable<ContinuityRule, 'id'>;
  issues: EntityTable<Issue, 'id'>;
  metrics: EntityTable<ChapterMetric, 'id'>;
  styles: EntityTable<StyleFingerprint, 'id'>;
  goals: EntityTable<WritingGoal, 'id'>;
  sessions: EntityTable<WritingSession, 'id'>;
  pomodoros: EntityTable<PomodoroRecord, 'id'>;
  aiSessions: EntityTable<AiSession, 'id'>;
  generations: EntityTable<AiGeneration, 'id'>;
  suggestions: EntityTable<AiSuggestion, 'id'>;
  embeddings: EntityTable<{ id: string; projectId: string; kind: string; refId: string; model: string; vector: number[]; text: string }, 'id'>;
  providers: EntityTable<ProviderConfig, 'id'>;
  routing: EntityTable<TaskRouting, 'kind'>;
  pricing: EntityTable<ModelPricing, 'id'>;
  prompts: EntityTable<PromptTemplate, 'id'>;
  feedback: EntityTable<AiFeedback, 'id'>;
  appState: EntityTable<AppState, 'id'>;
  genesis: EntityTable<GenesisRun, 'id'>;
}

/** Dexie 版本定义。加表/加索引时 append 新版本，不要改旧版本。 */
export const DB_NAME = 'huajiao-writer';

export const DB_VERSION = 3;

export const DB_STORES = {
  projects: 'id, title, status, updatedAt, createdAt',
  arcs: 'id, projectId, [projectId+order], order',
  chapters: 'id, projectId, [projectId+order], arcId, status, updatedAt',
  chapterContents: 'chapterId, projectId',
  outlineNodes: 'id, projectId, parentId, [projectId+order]',
  snapshots: 'id, chapterId, [projectId+chapterId], createdAt',
  comments: 'id, projectId, chapterId, [chapterId+resolved], resolved, createdAt',
  reviewSuggestions: 'id, projectId, chapterId, [chapterId+status], status, createdAt',
  memory: 'id, scope, projectId, kind, paused, dedupeKey, [scope+kind], [projectId+kind]',
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

export type StoreName = keyof typeof DB_STORES;
