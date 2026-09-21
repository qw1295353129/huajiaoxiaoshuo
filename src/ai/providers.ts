import type { ProviderConfig } from '@/core';
import { ProviderError } from './types';
import { DEFAULT_PROXY_BASE, wrapWithProxy } from './proxy';

/** 兼容旧引用：完整的转发端点（含 /proxy 路径） */
export const LOCAL_PROXY_BASE = DEFAULT_PROXY_BASE + '/proxy';

/** 判断一个供应商配置是否"已可用"（有 baseUrl，云端还需要 key） */
export function isProviderUsable(p: ProviderConfig): boolean {
  if (!p.enabled) return false;
  if (!p.baseUrl) return false;
  if (isLocalProvider(p)) return true;
  return Boolean(p.apiKey && p.apiKey.trim().length > 0);
}

export function isLocalProvider(p: ProviderConfig): boolean {
  return p.kind === 'ollama' || p.kind === 'lmstudio' || /127\.0\.0\.1|localhost/.test(p.baseUrl);
}

export interface ResolvedEndpoint {
  /** 实际请求的 URL */
  url: string;
  /** 附加请求头 */
  headers: Record<string, string>;
  /** 是否走了本地代理 */
  viaProxy: boolean;
}

/**
 * 计算 chat/completions 的真实地址。
 * 走代理时：<proxy>?url=<encodeURIComponent(baseUrl + '/chat/completions')>
 * 这样代理无需理解任何供应商细节，纯转发。
 */
export function resolveEndpoint(
  provider: ProviderConfig,
  path: string,
  opts: { useProxy?: boolean; proxyBase?: string } = {},
): ResolvedEndpoint {
  const base = provider.baseUrl.replace(/\/+$/, '');
  const target = `${base}${path}`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(provider.headers ?? {}) };

  if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`;

  if (provider.kind === 'openrouter') {
    headers['HTTP-Referer'] = location.origin;
    headers['X-Title'] = '花椒写作平台';
  }

  if (opts.useProxy) {
    // 注意：走代理时是 <base>/proxy?url=<encoded>，路径拼接统一由 wrapWithProxy 负责，
    // 避免这里和 proxy.ts 各写一份导致少拼 /proxy（曾因此 404）。
    return { url: wrapWithProxy(opts.proxyBase ?? DEFAULT_PROXY_BASE, target), headers, viaProxy: true };
  }
  return { url: target, headers, viaProxy: false };
}

/** 把各类 HTTP/网络异常归类成可操作的 ProviderError */
export async function classifyResponseError(res: Response, providerId: string): Promise<ProviderError> {
  let bodyText = '';
  try {
    bodyText = await res.text();
  } catch {
    bodyText = '';
  }
  const detail = extractMessage(bodyText);
  const status = res.status;
  if (status === 401 || status === 403) return new ProviderError('auth', detail || `鉴权失败 (${status})`, { status, providerId });
  if (status === 429) return new ProviderError('rate-limit', detail || '请求过于频繁', { status, providerId });
  if (status >= 500) return new ProviderError('server', detail || `服务端错误 (${status})`, { status, providerId });
  return new ProviderError('bad-request', detail || `请求被拒绝 (${status})`, { status, providerId });
}

function extractMessage(body: string): string {
  if (!body) return '';
  try {
    const j = JSON.parse(body) as { error?: { message?: string } | string; message?: string };
    if (typeof j.error === 'string') return j.error;
    if (j.error?.message) return j.error.message;
    if (j.message) return j.message;
  } catch {
    /* 非 JSON，直接截断返回 */
  }
  return body.slice(0, 300);
}

/** 把 fetch 抛出的异常归类（CORS 在浏览器里表现为 TypeError: Failed to fetch） */
export function classifyFetchError(e: unknown, providerId: string, baseUrl: string): ProviderError {
  if (e instanceof DOMException && e.name === 'AbortError') {
    return new ProviderError('aborted', '已取消', { providerId });
  }
  const msg = e instanceof Error ? e.message : String(e);
  const local = /127\.0\.0\.1|localhost/.test(baseUrl);
  if (/Failed to fetch|NetworkError|Load failed|ERR_/i.test(msg)) {
    if (local) {
      return new ProviderError('network', `无法连接本地模型服务（${baseUrl}）。请确认服务已启动。`, { providerId });
    }
    return new ProviderError(
      'cors',
      `无法访问 ${hostOf(baseUrl)}：可能是跨域(CORS)限制或网络不可达。`,
      { providerId },
    );
  }
  return new ProviderError('network', msg, { providerId });
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** 供应商连接自检 */
export async function probeProvider(
  provider: ProviderConfig,
  opts: { useProxy?: boolean; proxyBase?: string; signal?: AbortSignal } = {},
): Promise<{ ok: boolean; message: string; models?: string[]; viaProxy?: boolean }> {
  const ep = resolveEndpoint(provider, '/models', opts);
  try {
    const res = await fetch(ep.url, { method: 'GET', headers: ep.headers, signal: opts.signal });
    if (!res.ok) {
      const err = await classifyResponseError(res, provider.id);
      return { ok: false, message: err.hint, viaProxy: ep.viaProxy };
    }
    const json = (await res.json()) as { data?: { id?: string }[] };
    const models = (json.data ?? []).map((m) => m.id).filter((x): x is string => Boolean(x));
    return {
      ok: true,
      message: models.length ? `连接正常，发现 ${models.length} 个模型` : '连接正常',
      models,
      viaProxy: ep.viaProxy,
    };
  } catch (e) {
    const err = classifyFetchError(e, provider.id, provider.baseUrl);
    return { ok: false, message: err.hint, viaProxy: ep.viaProxy };
  }
}
