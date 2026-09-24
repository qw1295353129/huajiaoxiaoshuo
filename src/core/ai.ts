import type { ID, ISO, Timestamped } from './base';

export type ProviderKind =
  | 'openai' | 'deepseek' | 'moonshot' | 'zhipu' | 'qwen' | 'siliconflow'
  | 'openrouter' | 'ollama' | 'lmstudio' | 'xiaomi' | 'custom';

export interface ProviderConfig extends Timestamped {
  id: ID;
  /** 展示名 */
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  apiKey?: string;
  /** 可用模型（可手动维护或从 /models 拉取） */
  models: string[];
  /** 浏览器直连可能被 CORS 拦截 */
  corsBlocked?: boolean;
  enabled: boolean;
  /** 该供应商的请求头补充 */
  headers?: Record<string, string>;
  lastCheckedAt?: ISO;
  lastCheckOk?: boolean;
  lastCheckMessage?: string;
}

export type AiTaskKind =
  // 生成类
  | 'genesis' | 'outline' | 'chapter-outline' | 'continue' | 'expand'
  | 'rewrite' | 'polish' | 'describe' | 'dialogue' | 'brainstorm'
  /** 按需补人物（人物页的 AI 生成） */
  | 'cast-gen'
  /** 按需补世界观条目（世界观页的 AI 生成） */
  | 'world-gen'
  /** 拆书：分析参考书，提取技法与结构 */
  | 'blueprint'
  /** 仿书：按拆解出的技法生成全新故事 */
  | 'imitate'
  // 分析类
  | 'consistency' | 'style-check' | 'voice-check' | 'pacing'
  | 'character-arc' | 'foreshadow-audit' | 'reader-sim' | 'critique'
  // 抽取类
  | 'extract-entities' | 'extract-characters' | 'extract-timeline' | 'summarize'
  | 'state-diff' | 'chapter-summary'
  // 对话类
  | 'chat' | 'agent';

export interface ModelParams {
  temperature: number;
  topP: number;
  maxTokens: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  /** 允许模型思考（部分供应商） */
  reasoning?: boolean;
  stop?: string[];
}

/** 每个 AI 任务的角色分配 */
export interface TaskRouting {
  kind: AiTaskKind;
  /** 首选模型：providerId::model */
  primary?: string;
  /** 备用模型链 */
  fallbacks: string[];
  params: Partial<ModelParams>;
  /** 是否启用深度思考（多轮自检） */
  deep?: boolean;
  /** 是否启用多候选 */
  candidates?: number;
}

export interface ChatMessage {
  id: ID;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** 推理过程（DeepSeek-R1 / o系列） */
  reasoning?: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
  /** 引用了哪些实体，用于引用追溯 UI */
  citations?: Citation[];
  createdAt: ISO;
  /** token 统计 */
  usage?: TokenUsage;
  error?: string;
  /** 该消息由哪个任务产生 */
  taskKind?: AiTaskKind;
  /**
   * 生成本条消息时实际送入模型的上下文来源清单。
   * 落库保存，刷新页面后仍能看到"AI 到底看到了什么"以及各自的 token 占用。
   */
  contextSources?: ContextSource[];
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface Citation {
  entityId?: ID;
  chapterId?: ID;
  worldEntryId?: ID;
  threadId?: ID;
  label: string;
  /** 原文片段 */
  quote?: string;
}

export interface TokenUsage {
  prompt: number;
  completion: number;
  total: number;
  /** 估算成本（元），仅当模型配了价格 */
  cost?: number;
}

export interface AiSession extends Timestamped {
  id: ID;
  projectId: ID;
  title: string;
  taskKind: AiTaskKind;
  chapterId?: ID;
  messages: ChatMessage[];
  /** 上下文快照，便于复现 */
  contextDigest?: string;
  archived?: boolean;
}

export interface AiGeneration extends Timestamped {
  id: ID;
  projectId: ID;
  chapterId?: ID;
  taskKind: AiTaskKind;
  providerId: ID;
  model: string;
  params: ModelParams;
  promptPreview: string;
  /** 组装进 prompt 的上下文来源清单 */
  contextSources: ContextSource[];
  promptTokens: number;
  completionTokens: number;
  ms: number;
  ok: boolean;
  error?: string;
  cost?: number;
}

export interface ContextSource {
  kind: 'chapter' | 'summary' | 'character' | 'world' | 'thread' | 'timeline' | 'rule' | 'user-note' | 'retrieval';
  refId?: ID;
  label: string;
  tokens: number;
  /** 是否因预算被裁剪 */
  trimmed?: boolean;
}

/** 可作为正文候选的生成结果 */
export interface AiSuggestion extends Timestamped {
  id: ID;
  projectId: ID;
  chapterId?: ID;
  taskKind: AiTaskKind;
  /** 展示名 */
  label: string;
  content: string;
  /** 变体候选 */
  variants?: { id: ID; content: string; note?: string }[];
  /** 插入位置锚点 */
  anchor?: { from: number; to: number; quote?: string };
  status: 'pending' | 'accepted' | 'rejected' | 'partial';
  generationId?: ID;
  citations?: Citation[];
  /** 质量自评 */
  selfScore?: number;
  selfNotes?: string;
}

export type IssueSeverity = 'info' | 'warn' | 'error' | 'blocker';
export type IssueKind =
  | 'continuity' | 'character-voice' | 'timeline' | 'world-rule' | 'name-variant'
  | 'pov' | 'style' | 'pacing' | 'repetition' | 'logic' | 'foreshadow' | 'grammar' | 'sensitive';

/** 一致性 / 质量问题的统一模型 */
export interface Issue {
  id: ID;
  projectId: ID;
  chapterId?: ID;
  kind: IssueKind;
  severity: IssueSeverity;
  title: string;
  detail: string;
  /** 原文证据 */
  evidence?: { quote: string; from?: number; to?: number };
  /** 冲突的另一方（如另一个章节） */
  conflictsWith?: { chapterId?: ID; quote?: string; label?: string };
  /** 修复建议 */
  suggestion?: string;
  /** 一键修复用的 prompt */
  fixPrompt?: string;
  status: 'open' | 'ignored' | 'fixed' | 'false-positive';
  /** 检测来源 */
  source: 'rule' | 'llm' | 'heuristic';
  detector?: string;
  createdAt: ISO;
  updatedAt: ISO;
}

/** 文风指纹 */
export interface StyleFingerprint {
  id: ID;
  projectId: ID;
  /** 采样章节数 */
  sampleChapters: number;
  sampleWords: number;
  computedAt: ISO;
  metrics: StyleMetrics;
  /** 常用词 Top N */
  topWords: { word: string; count: number; ratio: number }[];
  /** 句长分布 */
  sentenceHistogram: number[];
  /** 高频四字格 / 短语 */
  signaturePhrases: { phrase: string; count: number }[];
  /** 给 AI 用的文风描述 */
  prompt: string;
}

export interface StyleMetrics {
  avgSentenceLength: number;
  sentenceLengthStd: number;
  avgParagraphLength: number;
  dialogueRatio: number;
  questionRatio: number;
  exclamationRatio: number;
  ellipsisRatio: number;
  /** 比喻密度（每千字"像/如/仿佛"） */
  simileDensity: number;
  /** 词汇丰富度 type-token ratio */
  ttr: number;
  adjectiveDensity: number;
  adverbDensity: number;
  /** 平均词长（中文按字符，英文按字母） */
  avgWordLength: number;
  /** 破折号 / 省略号 / 感叹号 频次 */
  punctuationProfile: Record<string, number>;
  /** 对话与叙述比例下的节奏值 */
  pacingScore: number;
}

/** 章节的量化指标（用于曲线图） */
export interface ChapterMetric {
  id: ID;
  projectId: ID;
  chapterId: ID;
  order: number;
  wordCount: number;
  dialogueRatio: number;
  avgSentenceLength: number;
  tension: number;
  /** 出场角色 id */
  castIds: ID[];
  /** 新引入实体数 */
  newEntities: number;
  /** 冲突强度（AI 评分 1..10） */
  conflictScore?: number;
  computedAt: ISO;
}

export interface AiFeedback {
  id: ID;
  projectId: ID;
  taskKind: AiTaskKind;
  generationId?: ID;
  rating: 1 | -1;
  note?: string;
  /** 生成时的 prompt 摘要，用于学习偏好 */
  promptDigest?: string;
  createdAt: ISO;
}

/** 提示词模板（可在设置里编辑） */
export interface PromptTemplate extends Timestamped {
  id: ID;
  taskKind: AiTaskKind;
  name: string;
  /** 支持 {{variable}} 插值 */
  system: string;
  user: string;
  /** 输出格式约束 */
  schema?: unknown;
  builtin: boolean;
  /** 用户是否覆盖了内置模板 */
  overridden?: boolean;
}
