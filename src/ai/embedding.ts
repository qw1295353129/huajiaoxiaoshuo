import type { ID, MemoryFact, ProviderConfig } from '@/core';
import { resolveSemanticRecall, type SemanticRecallSettings } from '@/core';
import { getProvider, loadSettings } from '@/db/repo/settings';
import { listEmbeddings, putEmbedding } from '@/db/repo/ai';
import { resolveEndpoint } from './providers';
import { shouldUseProxy } from './proxy';

/**
 * 向量（embedding）接入层。
 *
 * 这个文件只做三件事：**取向量、缓存向量、算余弦**。它不认识"记忆"，也不决定召回谁 ——
 * 那是 recall.ts 的事。分开的原因是：取向量是最容易失败的一环（服务没开、模型没拉、
 * 跨域被拦），把失败全部收敛在这一层，上层的召回逻辑就只需要处理"拿到了 / 没拿到"。
 *
 * 全部使用浏览器 fetch，不引入任何 Node API（src/ 跑在浏览器里）。
 *
 * 三条硬规则：
 * 1. **永不抛错**：所有对外函数失败时返回 null / 空集合。写作路径上不允许因为
 *    "向量服务没开"而中断，也不允许弹窗打断。
 * 2. **熔断**：失败后 60 秒内不再尝试。否则每次生成都要白等一次连接超时，
 *    作者会觉得"开了 AI 就卡"。
 * 3. **超时很短**（默认 2.5s）：向量是锦上添花，不值得让作者看着光标等。
 */

/** 熔断窗口：失败后多久不再尝试（毫秒） */
const BREAKER_MS = 60_000;
/** 单次请求超时：宁可退回规则排序，也不要拖慢写作 */
const DEFAULT_TIMEOUT_MS = 2500;
/** 一次调用最多算多少条记忆的向量（首次开启时避免几百条一起打过去） */
const MAX_BATCH = 48;
/** OpenAI 兼容端点一次可以带多条 input */
const OPENAI_BATCH = 16;

let breakerUntil = 0;
let lastError: string | undefined;

/** 上一次失败原因，设置页用来解释"为什么现在还是规则排序" */
export function lastEmbeddingError(): string | undefined {
  return lastError;
}

export function embeddingBreakerOpen(now = Date.now()): boolean {
  return now < breakerUntil;
}

/** 仅供测试/设置页"重试"使用 */
export function resetEmbeddingBreaker(): void {
  breakerUntil = 0;
  lastError = undefined;
  queryCache.clear();
}

/** 读取当前设置（补全缺省值；老版本存的 settings 里没有这一段） */
export function embeddingSettings(): SemanticRecallSettings {
  return resolveSemanticRecall(loadSettings());
}

/**
 * Ollama 端点补全：允许只填 http://127.0.0.1:11434，
 * 因为作者复制粘贴的通常是服务地址，不是某个 API 路径。
 */
export function normalizeOllamaEndpoint(endpoint: string): string {
  const base = (endpoint ?? '').trim().replace(/\/+$/, '');
  if (!base) return 'http://127.0.0.1:11434/api/embeddings';
  if (/\/api\/(embed|embeddings)$/.test(base)) return base;
  return base + '/api/embeddings';
}

function providerEmbeddingUrl(provider: ProviderConfig): string {
  return provider.baseUrl.replace(/\/+$/, '') + '/embeddings';
}

async function postJson(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number): Promise<{ ok: true; json: unknown } | { ok: false; error: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      return { ok: false, error: 'HTTP ' + res.status + ' ' + (await res.text().catch(() => '')).slice(0, 120) };
    }
    return { ok: true, json: (await res.json()) as unknown };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: /abort/i.test(msg) ? '超时' : msg };
  } finally {
    clearTimeout(timer);
  }
}

function toVector(x: unknown): number[] | null {
  if (!Array.isArray(x) || !x.length) return null;
  const vec = x.map((v) => (typeof v === 'number' ? v : Number(v)));
  return vec.every((v) => Number.isFinite(v)) ? vec : null;
}

/** Ollama：单条。老接口是 {prompt}，新接口是 {input}，两个都试一下更稳 */
async function embedOllamaBatch(texts: string[], cfg: SemanticRecallSettings): Promise<(number[] | null)[]> {
  const url = normalizeOllamaEndpoint(cfg.endpoint);
  const out: (number[] | null)[] = [];
  for (const text of texts) {
    let r = await postJson(url, {}, { model: cfg.model, prompt: text }, DEFAULT_TIMEOUT_MS);
    if (r.ok) {
      const j = r.json as { embedding?: unknown; embeddings?: unknown };
      const vec = toVector(j.embedding) ?? toVector(Array.isArray(j.embeddings) ? j.embeddings[0] : undefined);
      if (vec) {
        out.push(vec);
        continue;
      }
      r = { ok: false, error: '返回里没有 embedding 字段' };
    }
    // 老端点不通时试一次新版 /api/embed（Ollama 0.1.30+ 推荐）
    if (url.endsWith('/api/embeddings')) {
      const alt = url.replace(/\/api\/embeddings$/, '/api/embed');
      const r2 = await postJson(alt, {}, { model: cfg.model, input: text }, DEFAULT_TIMEOUT_MS);
      if (r2.ok) {
        const j2 = r2.json as { embeddings?: unknown; embedding?: unknown };
        const vec2 = toVector(Array.isArray(j2.embeddings) ? j2.embeddings[0] : undefined) ?? toVector(j2.embedding);
        if (vec2) {
          out.push(vec2);
          continue;
        }
      }
    }
    lastError = 'Ollama 返回异常：' + r.error;
    out.push(null);
  }
  return out;
}

/** OpenAI 兼容端点：一次可带多条 input */
async function embedOpenAiBatch(texts: string[], provider: ProviderConfig, model: string): Promise<(number[] | null)[]> {
  const useProxy = await shouldUseProxy(provider).catch(() => false);
  const ep = resolveEndpoint(provider, '/embeddings', { useProxy });
  const r = await postJson(ep.url, ep.headers, { model, input: texts }, DEFAULT_TIMEOUT_MS * 2);
  if (!r.ok) {
    lastError = provider.name + ' 的 /embeddings 调用失败：' + r.error;
    return texts.map(() => null);
  }
  const data = (r.json as { data?: { embedding?: unknown; index?: number }[] }).data;
  if (!Array.isArray(data)) {
    lastError = provider.name + ' 的 /embeddings 返回格式不认识';
    return texts.map(() => null);
  }
  return texts.map((_, i) => toVector(data.find((d) => d.index === i)?.embedding ?? data[i]?.embedding));
}

/**
 * 批量取向量。返回数组与输入等长，取不到的位置是 null（不抛错）。
 */
export async function embedTexts(texts: string[], cfg = embeddingSettings()): Promise<(number[] | null)[]> {
  if (!texts.length) return [];
  if (!cfg.enabled) return texts.map(() => null);
  if (embeddingBreakerOpen()) return texts.map(() => null);

  const trimmed = texts.map((t) => (t ?? '').trim().slice(0, 2000));
  let out: (number[] | null)[] = [];
  try {
    if (cfg.source === 'provider') {
      const provider = cfg.providerId ? await getProvider(cfg.providerId) : undefined;
      if (!provider) {
        lastError = '没有选择向量供应商';
        return texts.map(() => null);
      }
      for (let i = 0; i < trimmed.length; i += OPENAI_BATCH) {
        out.push(...(await embedOpenAiBatch(trimmed.slice(i, i + OPENAI_BATCH), provider, cfg.model)));
      }
    } else {
      out = await embedOllamaBatch(trimmed, cfg);
    }
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
    out = texts.map(() => null);
  }

  const got = out.filter(Boolean).length;
  if (!got) {
    // 一条都没成功 → 熔断，避免每次生成都白等超时
    breakerUntil = Date.now() + BREAKER_MS;
    if (!lastError) lastError = '向量服务不可达';
  } else {
    lastError = undefined;
  }
  return out;
}

/** 单条（带会话内缓存：同一段查询文本在一次会话里只算一次） */
const queryCache = new Map<string, number[]>();

export async function embedOne(text: string, cfg = embeddingSettings()): Promise<number[] | null> {
  const key = cfg.source + '|' + cfg.model + '|' + text.slice(0, 500);
  const cached = queryCache.get(key);
  if (cached) return cached;
  const [vec] = await embedTexts([text], cfg);
  if (vec) {
    // 只留最近 16 条，避免长会话里无限增长
    if (queryCache.size > 16) queryCache.clear();
    queryCache.set(key, vec);
  }
  return vec ?? null;
}

/** 余弦相似度（向量可能来自不同归一化方式，这里显式除以模长） */
export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (!n) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export interface MemoryVectorResult {
  vectors: Map<ID, number[]>;
  /** 命中缓存的数量 */
  cached: number;
  /** 这次真正算了向量的数量 */
  computed: number;
}

/**
 * 记忆向量（带缓存）。
 *
 * 缓存判据是**内容 + 模型**：同一段文本换了 embedding 模型必须重算（维度/语义空间都变了），
 * 内容改了一个字也要重算。这里直接存原始文本而不是文本 hash —— 记忆都是"一句话"，
 * 存原文既省不了多少空间，又能在排查时一眼看出这条向量对应的是哪版内容。
 *
 * 全局记忆（scope=global）会按项目各存一份：查询是按 projectId 走的，
 * 省掉跨项目 join 比省几 KB 存储更值。
 */
export async function memoryVectors(
  projectId: ID,
  facts: MemoryFact[],
  cfg = embeddingSettings(),
): Promise<MemoryVectorResult> {
  const vectors = new Map<ID, number[]>();
  if (!facts.length || !cfg.enabled) return { vectors, cached: 0, computed: 0 };

  let rows: Awaited<ReturnType<typeof listEmbeddings>> = [];
  try {
    rows = await listEmbeddings(projectId, 'memory');
  } catch {
    rows = [];
  }
  const byRef = new Map(rows.map((r) => [r.refId, r]));

  const missing: MemoryFact[] = [];
  let cached = 0;
  for (const f of facts) {
    const row = byRef.get(f.id);
    if (row && row.model === cfg.model && row.text === f.text && Array.isArray(row.vector) && row.vector.length) {
      vectors.set(f.id, row.vector);
      cached += 1;
    } else {
      missing.push(f);
    }
  }

  const todo = missing.slice(0, MAX_BATCH);
  let computed = 0;
  for (let i = 0; i < todo.length; i += OPENAI_BATCH) {
    const chunk = todo.slice(i, i + OPENAI_BATCH);
    const vecs = await embedTexts(chunk.map((f) => f.text), cfg);
    for (let k = 0; k < chunk.length; k++) {
      const vec = vecs[k];
      if (!vec) continue;
      const fact = chunk[k];
      vectors.set(fact.id, vec);
      computed += 1;
      try {
        await putEmbedding({
          id: 'emb_mem_' + projectId + '_' + fact.id,
          projectId,
          kind: 'memory',
          refId: fact.id,
          model: cfg.model,
          vector: vec,
          text: fact.text,
        });
      } catch {
        /* 缓存写失败不影响本次召回 */
      }
    }
  }

  return { vectors, cached, computed };
}

/** 设置页的"测试向量服务"：只做一次真实调用，失败也不抛错 */
export async function probeEmbedding(cfg = embeddingSettings()): Promise<{ ok: boolean; message: string; dim?: number }> {
  resetEmbeddingBreaker();
  const probe: SemanticRecallSettings = { ...cfg, enabled: true };
  const [vec] = await embedTexts(['这是一次向量服务连通性测试'], probe);
  if (!vec) return { ok: false, message: lastError ?? '没有拿到向量' };
  resetEmbeddingBreaker();
  return { ok: true, message: '连接正常，向量维度 ' + vec.length, dim: vec.length };
}

// ================= 通用分片/条目向量（按需惰性建索引） =================

export interface VectorItem {
  /** 唯一 id（分片用 `章节id:序号`，板块条目用实体 id） */
  id: string;
  /** 参与缓存判据的原文 */
  text: string;
}

export interface CachedVectorResult {
  vectors: Map<string, number[]>;
  cached: number;
  computed: number;
}

/**
 * 按需取向量，缓存在 embeddings 表（kind 由调用方定，如 passage / section）。
 *
 * 与 memoryVectors 同模式：
 * - 缓存判据 = **文本 + 模型**，内容或模型变了自然失效，按 id 覆盖写，旧行不留垃圾；
 * - 首次最多算 MAX_BATCH 条（调用方把最需要的排前面），其余留给后续调用渐进补齐；
 * - 失败不抛错：服务不可达时返回空/部分结果（熔断由 embedTexts 负责）。
 */
async function cachedVectors(
  projectId: ID,
  kind: string,
  items: VectorItem[],
  cfg: SemanticRecallSettings,
): Promise<CachedVectorResult> {
  const vectors = new Map<string, number[]>();
  if (!items.length || !cfg.enabled) return { vectors, cached: 0, computed: 0 };

  let rows: Awaited<ReturnType<typeof listEmbeddings>> = [];
  try {
    rows = await listEmbeddings(projectId, kind);
  } catch {
    rows = [];
  }
  const byRef = new Map(rows.map((r) => [r.refId, r]));

  const missing: VectorItem[] = [];
  let cached = 0;
  for (const item of items) {
    const row = byRef.get(item.id);
    if (row && row.model === cfg.model && row.text === item.text && Array.isArray(row.vector) && row.vector.length) {
      vectors.set(item.id, row.vector);
      cached += 1;
    } else {
      missing.push(item);
    }
  }

  const todo = missing.slice(0, MAX_BATCH);
  let computed = 0;
  for (let i = 0; i < todo.length; i += OPENAI_BATCH) {
    const chunk = todo.slice(i, i + OPENAI_BATCH);
    const vecs = await embedTexts(chunk.map((c) => c.text), cfg);
    for (let k = 0; k < chunk.length; k++) {
      const vec = vecs[k];
      if (!vec) continue;
      const item = chunk[k];
      vectors.set(item.id, vec);
      computed += 1;
      try {
        await putEmbedding({
          id: `emb_${kind}_${projectId}_${item.id}`,
          projectId,
          kind,
          refId: item.id,
          model: cfg.model,
          vector: vec,
          text: item.text,
        });
      } catch {
        /* 缓存写失败不影响本次召回 */
      }
    }
  }

  return { vectors, cached, computed };
}

/** 历史段落分片向量（kind=passage；refId=章节id:序号） */
export async function passageVectors(
  projectId: ID,
  chunks: VectorItem[],
  cfg = embeddingSettings(),
): Promise<CachedVectorResult> {
  return cachedVectors(projectId, 'passage', chunks, cfg);
}

/** 上下文板块条目向量（kind=section；refId=实体 id，如人物/世界条目 id） */
export async function sectionVectors(
  projectId: ID,
  items: VectorItem[],
  cfg = embeddingSettings(),
): Promise<CachedVectorResult> {
  return cachedVectors(projectId, 'section', items, cfg);
}
