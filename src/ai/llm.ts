import type { ChatMessage, ModelParams } from '@/core';
import { classifyFetchError, classifyResponseError, resolveEndpoint } from './providers';
import { shouldUseProxy } from './proxy';
import { ProviderError, type ChatRequest, type ChatResult } from './types';

/** 上下文超长时给用户的可读提示 */
function isContextLengthError(msg: string): boolean {
  return /context length|maximum context|too many tokens|context_length_exceeded|reduce the length/i.test(msg);
}

interface WireMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  name?: string;
}

function toWire(messages: ChatMessage[]): WireMessage[] {
  return messages
    .filter((m) => m.content || m.role === 'assistant')
    .map((m) => {
      const base: WireMessage = { role: m.role === 'tool' ? 'tool' : m.role, content: m.content ?? '' };
      if (m.role === 'tool' && m.toolCallId) base.tool_call_id = m.toolCallId;
      return base;
    });
}

interface ChatCompletionRequest {
  model: string;
  messages: WireMessage[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string[];
  stream?: boolean;
  response_format?: { type: 'json_object' } | { type: 'json_schema'; json_schema: { name: string; schema: unknown; strict?: boolean } };
}

function buildBody(req: ChatRequest, stream: boolean): ChatCompletionRequest {
  const p: ModelParams = req.params;
  const body: ChatCompletionRequest = {
    model: req.model,
    messages: toWire(req.messages),
    temperature: clamp(p.temperature, 0, 2),
    top_p: p.topP,
    max_tokens: Math.max(64, Math.min(p.maxTokens, 32000)),
  };
  if (p.frequencyPenalty !== undefined) body.frequency_penalty = p.frequencyPenalty;
  if (p.presencePenalty !== undefined) body.presence_penalty = p.presencePenalty;
  if (p.stop?.length) body.stop = p.stop;
  if (stream) body.stream = true;
  if (req.jsonSchema) {
    // 大部分 OpenAI 兼容服务支持 json_object；少数支持 json_schema，失败时上层会降级为文本解析
    body.response_format = { type: 'json_object' };
  }
  return body;
}

function clamp(n: number, min: number, max: number): number {
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
}

export interface CallOptions {
  useProxy?: boolean;
  proxyBase?: string;
  /** 重试次数（针对 429 / 5xx / 网络错误） */
  retries?: number;
  timeoutMs?: number;
}

/** 非流式调用 */
export async function chat(req: ChatRequest, opts: CallOptions = {}): Promise<ChatResult> {
  const started = performance.now();
  const body = buildBody(req, false);
  const res = await requestWithRetry(req, body, opts);
  const json = (await res.json()) as {
    choices?: { message?: { content?: string; reasoning_content?: string }; finish_reason?: string }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };
  const choice = json.choices?.[0];
  const text = choice?.message?.content ?? '';
  const reasoning = choice?.message?.reasoning_content;
  return {
    text,
    reasoning,
    usage: normalizeUsage(json.usage, req.messages, text),
    model: req.model,
    providerId: req.provider.id,
    ms: performance.now() - started,
    finishReason: choice?.finish_reason,
  };
}

/** 流式调用：逐块回调，最后返回完整结果 */
export async function chatStream(req: ChatRequest, opts: CallOptions = {}): Promise<ChatResult> {
  const started = performance.now();
  const body = buildBody(req, true);
  const res = await requestWithRetry(req, body, opts);

  if (!res.body) {
    // 极少数环境不支持流，退回非流式
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    const text = json.choices?.[0]?.message?.content ?? '';
    req.onDelta?.({ text });
    return {
      text,
      usage: normalizeUsage(json.usage, req.messages, text),
      model: req.model,
      providerId: req.provider.id,
      ms: performance.now() - started,
    };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let reasoning = '';
  let finishReason: string | undefined;
  let usage: ChatResult['usage'] | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith(':')) continue;
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') continue;
      try {
        const chunk = JSON.parse(payload) as {
          choices?: { delta?: { content?: string; reasoning_content?: string }; finish_reason?: string }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
        };
        if (chunk.usage) usage = normalizeUsage(chunk.usage, req.messages, text);
        const delta = chunk.choices?.[0]?.delta;
        if (chunk.choices?.[0]?.finish_reason) finishReason = chunk.choices[0].finish_reason;
        if (delta?.reasoning_content) {
          reasoning += delta.reasoning_content;
          req.onDelta?.({ reasoning: delta.reasoning_content });
        }
        if (delta?.content) {
          text += delta.content;
          req.onDelta?.({ text: delta.content });
        }
      } catch {
        /* 跳过无法解析的分片 */
      }
    }
  }

  return {
    text,
    reasoning: reasoning || undefined,
    usage: usage ?? normalizeUsage(undefined, req.messages, text),
    model: req.model,
    providerId: req.provider.id,
    ms: performance.now() - started,
    finishReason,
  };
}

async function requestWithRetry(req: ChatRequest, body: unknown, opts: CallOptions): Promise<Response> {
  const retries = opts.retries ?? 2;
  // 先探测本地代理再决定路径：能用就走代理，不能用就直接连。
  // 不做"先直连、失败再代理"的反向回退 —— 那会让每次生成都白等一轮。
  const useProxy = opts.useProxy ?? (await shouldUseProxy(req.provider));
  let lastError: ProviderError | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const ep = resolveEndpoint(req.provider, '/chat/completions', { useProxy, proxyBase: opts.proxyBase });
    const controller = new AbortController();
    // 标记中止来源：超时和用户取消都会 abort，但对外必须区分 —— 否则用户会看到
    // "已取消"（其实是超时），完全摸不着头脑。
    let abortedBy: 'timeout' | 'user' | null = null;
    const timeout = setTimeout(() => {
      abortedBy = 'timeout';
      controller.abort();
    }, opts.timeoutMs ?? 180_000);
    const onAbort = () => {
      abortedBy = 'user';
      controller.abort();
    };
    req.signal?.addEventListener('abort', onAbort);

    try {
      const res = await fetch(ep.url, {
        method: 'POST',
        headers: ep.headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        const err = await classifyResponseError(res, req.provider.id);
        if (isContextLengthError(err.message)) {
          throw new ProviderError('bad-request', '上下文超出模型限制，请调低「上下文预算」或缩短正文。', {
            status: err.status,
            providerId: req.provider.id,
          });
        }
        if (!err.retryable || attempt === retries) throw err;
        lastError = err;
        await sleep(backoff(attempt));
        continue;
      }
      return res;
    } catch (e) {
      if (e instanceof ProviderError) {
        if (e.kind === 'aborted') throw e;
        if (!e.retryable || attempt === retries) throw e;
        lastError = e;
      } else {
        let err = classifyFetchError(e, req.provider.id, req.provider.baseUrl);
        // 我们自己超时中止的，不能报成"用户取消"
        if (err.kind === 'aborted' && abortedBy === 'timeout') {
          err = new ProviderError('timeout', '等待模型响应超过 ' + Math.round((opts.timeoutMs ?? 180_000) / 1000) + ' 秒，已中止本次请求。', {
            providerId: req.provider.id,
          });
        }
        if (err.kind === 'aborted' || err.kind === 'timeout') throw err;
        if (attempt === retries) {
          // 直连失败且是 CORS，自动尝试本地代理一次
          if (err.kind === 'cors' && !useProxy) {
            const proxied = await tryProxyOnce(req, body, opts);
            if (proxied) return proxied;
          }
          throw err;
        }
        lastError = err;
      }
      await sleep(backoff(attempt));
    } finally {
      clearTimeout(timeout);
      req.signal?.removeEventListener('abort', onAbort);
    }
  }
  throw lastError ?? new ProviderError('network', '请求失败');
}

async function tryProxyOnce(req: ChatRequest, body: unknown, opts: CallOptions): Promise<Response | null> {
  try {
    const ep = resolveEndpoint(req.provider, '/chat/completions', { useProxy: true, proxyBase: opts.proxyBase });
    const res = await fetch(ep.url, {
      method: 'POST',
      headers: ep.headers,
      body: JSON.stringify(body),
      signal: req.signal,
    });
    if (!res.ok) return null;
    return res;
  } catch {
    return null;
  }
}

function backoff(attempt: number): number {
  return Math.min(8000, 700 * Math.pow(2, attempt)) + Math.random() * 250;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizeUsage(
  usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined,
  messages: ChatMessage[],
  completion: string,
): ChatResult['usage'] {
  if (usage?.total_tokens) {
    return {
      prompt: usage.prompt_tokens ?? 0,
      completion: usage.completion_tokens ?? 0,
      total: usage.total_tokens,
    };
  }
  // 供应商没返回 usage 时本地估算
  const prompt = messages.reduce((n, m) => n + roughTokens(m.content), 0);
  const comp = roughTokens(completion);
  return { prompt, completion: comp, total: prompt + comp };
}

function roughTokens(s: string): number {
  if (!s) return 0;
  const cjk = (s.match(/[\u3400-\u9fff]/g) ?? []).length;
  return Math.ceil(cjk * 1.05 + (s.length - cjk) / 3.8);
}
