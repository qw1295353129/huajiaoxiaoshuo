import type { ID, Timestamped } from './base';
import type { ModelParams, ProviderConfig, TaskRouting } from './ai';

export interface AppSettings {
  /** 当前激活的供应商 */
  activeProviderId?: ID;
  /** 当前激活模型 */
  activeModel?: string;
  /** UI 主题 */
  theme: 'light' | 'dark' | 'system';
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
  /** 遥测（默认全关，纯本地） */
  telemetry: false;
  /** 语言 */
  locale: 'zh-CN' | 'en';
  /** 键盘方案 */
  keymap: 'default' | 'vim';
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
