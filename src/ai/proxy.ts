import type { ProviderConfig } from "@/core";
import { isLocalProvider } from "./providers";

/**
 * 本地代理的发现与使用。
 *
 * 背景：部分模型服务不返回 CORS 头，浏览器直连会被拦。我们提供了一个本机代理
 * （scripts/proxy.mjs，npm run proxy）。这里负责"探测它在不在"，并决定请求走哪条路。
 *
 * 顺序：能用代理就用代理（对不支持 CORS 的服务）→ 否则直连。
 * 不做"直连失败再试代理"的反向回退，因为那会让每次生成都先失败一次，白等几秒。
 */

const PROXY_BASE_KEY = "huajiao:proxyBase";
/**
 * 用户可配置的"代理基地址"。转发端点是它 + /proxy，健康检查是它的 origin + /health。
 * 之所以让用户填基地址而不是完整转发地址，是为了换端口时只改一个地方。
 */
const DEFAULT_PROXY_BASE = "http://127.0.0.1:8788";

export function getProxyBase(): string {
  try {
    return localStorage.getItem(PROXY_BASE_KEY) ?? DEFAULT_PROXY_BASE;
  } catch {
    return DEFAULT_PROXY_BASE;
  }
}

export function setProxyBase(base: string): void {
  try {
    localStorage.setItem(PROXY_BASE_KEY, base.replace(/\/+$/, ""));
  } catch {
    /* 隐私模式下写不了，忽略 */
  }
  proxyAvailable = null; // 地址变了，重新探测
}

interface ProxyStatus {
  available: boolean;
  base: string;
  /** 探测耗时 */
  ms?: number;
  message?: string;
  checkedAt: number;
}

let proxyAvailable: boolean | null = null;
let lastStatus: ProxyStatus | null = null;
let inflight: Promise<ProxyStatus> | null = null;

/** 探测本地代理是否在运行（结果缓存，除非地址变化或手动刷新） */
export async function detectProxy(force = false): Promise<ProxyStatus> {
  const base = getProxyBase();
  if (!force && proxyAvailable !== null && lastStatus?.base === base) return lastStatus;
  if (inflight) return inflight;

  inflight = (async () => {
    const started = performance.now();
    const status: ProxyStatus = { available: false, base, checkedAt: Date.now() };
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1500);
      // 健康检查放在 origin 上，与转发端点 /proxy 区分开
      const origin = new URL(base).origin;
      const res = await fetch(origin + "/health", { signal: controller.signal });
      clearTimeout(timer);
      status.ms = Math.round(performance.now() - started);
      if (res.ok) {
        const body = (await res.json().catch(() => ({}))) as { service?: string };
        status.available = body.service === "huajiao-proxy";
        status.message = status.available ? "本地代理已就绪" : "该端口上的服务不是花椒代理（缺少 /health 标识）";
      } else {
        status.message = "代理返回 " + res.status;
      }
    } catch {
      status.ms = Math.round(performance.now() - started);
      status.message = "没有检测到本地代理";
    }
    proxyAvailable = status.available;
    lastStatus = status;
    inflight = null;
    return status;
  })();

  return inflight;
}

export function cachedProxyStatus(): ProxyStatus | null {
  return lastStatus;
}

/**
 * 为一个供应商决定是否走代理。
 * 本地模型服务（Ollama / LM Studio）永远直连；标记了 corsBlocked 的优先走代理。
 */
export async function shouldUseProxy(provider: ProviderConfig): Promise<boolean> {
  if (isLocalProvider(provider)) return false;
  if (!provider.corsBlocked) return false;
  const status = await detectProxy();
  return status.available;
}

/** 由基地址拼出转发端点，例如 http://127.0.0.1:8788 + /proxy */
export function proxyEndpoint(base: string): string {
  return base.replace(/\/+$/, "") + "/proxy";
}

/** 把目标地址包成代理请求地址 */
export function wrapWithProxy(base: string, target: string): string {
  return proxyEndpoint(base) + "?url=" + encodeURIComponent(target);
}

export { DEFAULT_PROXY_BASE };