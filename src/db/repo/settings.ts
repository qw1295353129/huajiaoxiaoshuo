import type { AppSettings, ID, ModelPricing, ProviderConfig, TaskRouting } from '@/core';
import { db } from '../database';
import { DEFAULT_PARAMS, PROVIDER_PRESETS, defaultRouting } from '../defaults';
import { DEFAULT_SEMANTIC_RECALL, THEMES } from '@/core';

export const DEFAULT_SETTINGS: AppSettings = {
  activeProviderId: undefined,
  activeModel: undefined,
  theme: 'system',
  editorFontSize: 17,
  editorMaxWidth: 760,
  autosaveMs: 1200,
  snapshotIntervalMin: 8,
  flowByDefault: false,
  typewriterScroll: false,
  contextBudget: 24000,
  candidateCount: 3,
  stream: true,
  allowCloud: true,
  penName: undefined,
  defaultGenres: [],
  defaultPov: undefined,
  writingPrinciples: [],
  globalForbidden: [],
  globalInstructions: undefined,
  semanticRecall: { ...DEFAULT_SEMANTIC_RECALL },
};

/** 设置存 localStorage（非作品数据，不需要进 IndexedDB） */
const SETTINGS_KEY = 'huajiao:settings';
/** 早期版本用过这个键；读不到新键时回落到它，避免升级后设置被清空 */
const LEGACY_SETTINGS_KEY = 'novelforge:settings';

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY) ?? localStorage.getItem(LEGACY_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const merged = { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<AppSettings>) };
    // 已下线的主题（如 vivid）仍可能留在老数据里，回落到默认
    if (!(THEMES as readonly string[]).includes(merged.theme)) {
      merged.theme = DEFAULT_SETTINGS.theme;
    }
    return merged;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* 隐私模式下 localStorage 可能不可用，静默失败 */
  }
}

export function resetSettings(): AppSettings {
  saveSettings(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS };
}

// ---------------- 供应商 ----------------

export async function listProviders(): Promise<ProviderConfig[]> {
  return db.providers.toArray();
}

export async function getProvider(id: ID): Promise<ProviderConfig | undefined> {
  return db.providers.get(id);
}

export async function upsertProvider(patch: Partial<ProviderConfig> & { name: string; baseUrl: string; kind: ProviderConfig['kind'] }): Promise<ProviderConfig> {
  const now = new Date().toISOString();
  if (patch.id) {
    const existing = await db.providers.get(patch.id);
    if (existing) {
      const next = { ...existing, ...patch, updatedAt: now } as ProviderConfig;
      await db.providers.put(next);
      return next;
    }
  }
  const row: ProviderConfig = {
    id: patch.id ?? `prov_${Math.random().toString(36).slice(2, 10)}`,
    name: patch.name,
    kind: patch.kind,
    baseUrl: patch.baseUrl.replace(/\/+$/, ''),
    apiKey: patch.apiKey,
    models: patch.models ?? [],
    corsBlocked: patch.corsBlocked,
    enabled: patch.enabled ?? true,
    headers: patch.headers,
    lastCheckedAt: patch.lastCheckedAt,
    lastCheckOk: patch.lastCheckOk,
    lastCheckMessage: patch.lastCheckMessage,
    createdAt: now,
    updatedAt: now,
  };
  await db.providers.put(row);
  return row;
}

export async function deleteProvider(id: ID): Promise<void> {
  await db.providers.delete(id);
}

/** 首次运行：把预置供应商写进去（不覆盖用户已有配置） */
export async function seedProviders(): Promise<void> {
  const count = await db.providers.count();
  if (count > 0) return;
  const now = new Date().toISOString();
  await db.providers.bulkPut(PROVIDER_PRESETS.map((p) => ({ ...p, createdAt: now, updatedAt: now })));
}

export async function setProviderKey(id: ID, apiKey: string): Promise<void> {
  await db.providers.where('id').equals(id).modify((p) => { p.apiKey = apiKey; p.updatedAt = new Date().toISOString(); });
}

export async function markProviderCheck(id: ID, ok: boolean, message: string): Promise<void> {
  await db.providers.where('id').equals(id).modify((p) => {
    p.lastCheckedAt = new Date().toISOString();
    p.lastCheckOk = ok;
    p.lastCheckMessage = message;
    p.updatedAt = new Date().toISOString();
  });
}

// ---------------- 路由 ----------------

export async function listRouting(): Promise<TaskRouting[]> {
  return db.routing.toArray();
}

export async function seedRouting(): Promise<void> {
  const count = await db.routing.count();
  const defaults = defaultRouting();
  if (count === 0) {
    await db.routing.bulkPut(defaults);
    return;
  }
  // 补齐新增的任务类型
  const existing = new Set((await db.routing.toArray()).map((r) => r.kind));
  const missing = defaults.filter((d) => !existing.has(d.kind));
  if (missing.length) await db.routing.bulkPut(missing);
}

export async function updateRouting(kind: TaskRouting['kind'], patch: Partial<TaskRouting>): Promise<void> {
  const existing = await db.routing.get(kind);
  if (!existing) return;
  await db.routing.put({ ...existing, ...patch });
}

/** 解析某任务应该用什么模型：任务路由 > 全局默认 */
export async function resolveModel(taskKind: TaskRouting['kind']): Promise<{ providerId?: ID; model?: string; params: typeof DEFAULT_PARAMS }> {
  const [routing, settings] = await Promise.all([db.routing.get(taskKind), Promise.resolve(loadSettings())]);
  const params = { ...DEFAULT_PARAMS, ...(routing?.params ?? {}) };
  if (routing?.primary) {
    const [pid, ...rest] = routing.primary.split('::');
    return { providerId: pid, model: rest.join('::'), params };
  }
  return { providerId: settings.activeProviderId, model: settings.activeModel, params };
}

// ---------------- 计费 ----------------

/**
 * 删除一条单价。
 *
 * 之前只有 upsert，没有删除 —— 填错了只能改成 0，而 0 和"没填"在界面上看不出区别。
 */
export async function deletePricing(key: string): Promise<void> {
  const all = await db.pricing.toArray();
  const hit = all.find((p) => p.key === key);
  if (hit) await db.pricing.delete(hit.id);
}

export async function listPricing(): Promise<ModelPricing[]> {
  return db.pricing.toArray();
}

export async function upsertPricing(row: Partial<ModelPricing> & { key: string }): Promise<ModelPricing> {
  const all = await db.pricing.toArray();
  const existing = all.find((p) => p.key === row.key);
  const next: ModelPricing = {
    id: existing?.id ?? `price_${Math.random().toString(36).slice(2, 8)}`,
    key: row.key,
    inputPerM: row.inputPerM ?? existing?.inputPerM ?? 0,
    outputPerM: row.outputPerM ?? existing?.outputPerM ?? 0,
  };
  await db.pricing.put(next);
  return next;
}

export async function estimateCost(key: string, promptTokens: number, completionTokens: number): Promise<number> {
  const all = await db.pricing.toArray();
  const p = all.find((x) => x.key === key);
  if (!p) return 0;
  return (promptTokens / 1_000_000) * p.inputPerM + (completionTokens / 1_000_000) * p.outputPerM;
}
