import type { ID, Timestamped } from './base';
import type { ModelParams, ProviderConfig, TaskRouting } from './ai';

export interface AppSettings {
  /** 当前激活的供应商 */
  activeProviderId?: ID;
  /** 当前激活模型 */
  activeModel?: string;
  /** UI 主题 */
  /**
   * 界面主题。
   * - light/dark/system：中性配色（白 / 黑 / 浅灰），默认
   * - warm：暖阳 —— 奶油底 + 近黑字 + 琥珀/橙强调
   * - soft：柔彩 —— 淡蓝白底 + 莓粉强调 + 极淡氛围渐变
   * - vivid：仪表盘 —— 干净白底 + 珊瑚橙强调 + 明显的多色卡片渐变
   */
  theme: 'light' | 'dark' | 'system' | 'warm' | 'soft' | 'vivid';
  /** 编辑器字号 */
  editorFontSize: number;
  /** 编辑器宽度 px，0 = 自适应 */
  editorMaxWidth: number;
  /** 自动保存间隔 ms */
  autosaveMs: number;
  /** 自动快照间隔（分钟），0 关闭 */
  snapshotIntervalMin: number;
  /** 心流模式默认开启 */
  flowByDefault: boolean;
  /** 打字机滚动 */
  typewriterScroll: boolean;
  /** AI 上下文预算 tokens */
  contextBudget: number;
  /** 每次生成候选数 */
  candidateCount: number;
  /** 是否默认流式输出 */
  stream: boolean;
  /** 隐私：是否允许把正文发给云模型（关闭后仅本地模型） */
  allowCloud: boolean;

  // ---------- 创作者档案：会进入所有 AI 调用的 system prompt ----------
  /** 笔名，生成时用于署名与自称 */
  penName?: string;
  /** 惯用体裁，影响 AI 的题材要点提示 */
  defaultGenres: string[];
  /** 惯用视角 */
  defaultPov?: 'first' | 'third-limited' | 'third-omniscient' | 'second' | 'mixed';
  /** 一以贯之的写作原则，逐条进入 system prompt */
  writingPrinciples: string[];
  /** 全局禁用词/表达（比单本书的 forbidden 优先级更高） */
  globalForbidden: string[];
  /** 给 AI 的长期补充指令 */
  globalInstructions?: string;

  // ---------- 语义召回（可选，默认关闭） ----------
  semanticRecall?: SemanticRecallSettings;
}

/** 向量来源：本地 Ollama，或任意 OpenAI 兼容的 /embeddings 端点 */
export type EmbeddingSource = 'ollama' | 'provider';

export interface SemanticRecallSettings {
  /**
   * 默认 false：不配好 embedding 就完全走原来的规则排序。
   * 这一点是刻意的 —— 语义召回是"锦上添花"，绝不能让没装 Ollama 的作者
   * 每次生成都白等一次网络超时。
   */
  enabled: boolean;
  source: EmbeddingSource;
  /** source = provider 时指向「模型与 AI」里已配置的供应商（复用 key / 代理设置） */
  providerId?: ID;
  model: string;
  /** source = ollama 时的地址：可以是完整端点，也可以只写主机名（自动补 /api/embeddings） */
  endpoint: string;
  /** 每次召回的条数 */
  topK: number;
}

export const DEFAULT_SEMANTIC_RECALL: SemanticRecallSettings = {
  enabled: false,
  source: 'ollama',
  model: 'nomic-embed-text',
  endpoint: 'http://127.0.0.1:11434/api/embeddings',
  topK: 8,
};

/** 补全缺省值：老版本存下来的 settings 里没有 semanticRecall */
export function resolveSemanticRecall(settings?: Partial<AppSettings> | null): SemanticRecallSettings {
  const raw = settings?.semanticRecall;
  return {
    ...DEFAULT_SEMANTIC_RECALL,
    ...(raw ?? {}),
    // topK 用 0 会让召回失效，兜回默认值
    topK: raw?.topK && raw.topK > 0 ? Math.min(raw.topK, 24) : DEFAULT_SEMANTIC_RECALL.topK,
  };
}

export interface ModelPricing {
  id: ID;
  /** providerId::model */
  key: string;
  /** 每百万 token 价格（元） */
  inputPerM: number;
  outputPerM: number;
}

export interface AppState extends Timestamped {
  id: 'singleton';
  lastProjectId?: ID;
  lastChapterId?: ID;
  recentProjectIds: ID[];
  onboardingDone: boolean;
}

export interface ProviderBundle {
  providers: ProviderConfig[];
  routing: TaskRouting[];
  pricing: ModelPricing[];
  defaults: ModelParams;
}
