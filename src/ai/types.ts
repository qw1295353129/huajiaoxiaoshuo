import type { AiTaskKind, ChatMessage, ModelParams, ProviderConfig, TokenUsage } from '@/core';

export interface ChatRequest {
  provider: ProviderConfig;
  model: string;
  messages: ChatMessage[];
  params: ModelParams;
  /** 要求模型按 JSON Schema 输出（走 response_format / tool 调用） */
  jsonSchema?: { name: string; schema: unknown };
  /** 是否流式 */
  stream?: boolean;
  signal?: AbortSignal;
  onDelta?: (delta: { text?: string; reasoning?: string }) => void;
}

export interface ChatResult {
  text: string;
  reasoning?: string;
  usage: TokenUsage;
  model: string;
  providerId: string;
  ms: number;
  finishReason?: string;
}

export interface TaskRunOptions {
  taskKind: AiTaskKind;
  projectId?: string;
  chapterId?: string;
  /** 覆盖参数 */
  params?: Partial<ModelParams>;
  /** 显式指定模型 providerId::model */
  model?: string;
  signal?: AbortSignal;
  onDelta?: (delta: { text?: string; reasoning?: string }) => void;
  /** 失败时是否自动降级到备用模型 */
  allowFallback?: boolean;
}

export interface TaskRunResult<T = string> {
  ok: boolean;
  text: string;
  data?: T;
  error?: string;
  /**
   * 失败类型。`aborted` 表示用户主动取消 —— 这不是错误，
   * UI 必须据此显示中性状态，而不是红色失败块（曾经因此把"取消"渲染成"自检没有完成"）。
   */
  errorKind?: ProviderError['kind'];
  usage: TokenUsage;
  model: string;
  providerId: string;
  ms: number;
  attempts: { model: string; ok: boolean; error?: string; ms: number }[];
}

/** 统一的供应商错误类型，UI 可据此给出可操作提示 */
export class ProviderError extends Error {
  readonly kind:
    | 'network' | 'cors' | 'auth' | 'rate-limit' | 'bad-request' | 'server'
    /** 用户主动取消（只有用户点了取消才应该是这个） */
    | 'aborted'
    /** 等待超时：与"取消"完全不同，需要明确告诉用户是慢，不是他取消的 */
    | 'timeout'
    | 'no-provider' | 'unsupported';
  readonly status?: number;
  readonly providerId?: string;
  readonly retryable: boolean;

  constructor(
    kind: ProviderError['kind'],
    message: string,
    opts: { status?: number; providerId?: string; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = 'ProviderError';
    this.kind = kind;
    this.status = opts.status;
    this.providerId = opts.providerId;
    this.retryable = opts.retryable ?? (kind === 'rate-limit' || kind === 'server' || kind === 'network');
  }

  get hint(): string {
    switch (this.kind) {
      case 'cors':
        return [
          '浏览器直连被跨域策略拦截（该服务没有返回 Access-Control-Allow-Origin 响应头）。',
          '两个解决办法：',
          '① 启动本地代理后在设置里点「检测本地代理」：终端执行 npm run proxy；',
          '② 换用支持浏览器直连的服务：DeepSeek、OpenRouter、Ollama、LM Studio。',
        ].join(' ');
      case 'auth':
        return 'API Key 无效或未填写。请到「设置 → 模型与 AI」检查密钥。';
      case 'rate-limit':
        return '触发限流，请稍后再试或切换模型。';
      case 'timeout':
        return [
          '等待模型响应超时（没有收到响应）。',
          '常见原因：任务上下文过大（设定 / 章节太多）、所选模型较慢、或网络不稳定。',
          '可以这样处理：换更快的模型、到大纲把任务拆小、或减少一次发送的上下文量。',
        ].join(' ');
      case 'no-provider':
        return '还没有配置可用的模型。请到「设置 → 模型与 AI」添加供应商并填写 API Key。';
      case 'network':
        return '网络不可达。若使用本地模型，请确认 Ollama / LM Studio 已启动；若是云端服务，请检查网络与地址是否正确。';
      default:
        return this.message;
    }
  }
}

export function isProviderError(e: unknown): e is ProviderError {
  return e instanceof ProviderError;
}
