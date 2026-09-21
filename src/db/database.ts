import Dexie from 'dexie';
import type { AppState } from '@/core';
import { DB_NAME, DB_STORES, DB_VERSION, type HuaJiaoDB } from './schema';
import { V1_STORES, V2_STORES } from './v1-stores';

/**
 * 用声明合并把 HuaJiaoDB 的表定义挂到 Dexie 实例上：
 * 这样 db.chapters.where(...) 有完整类型，同时保留 Dexie 的运行时能力。
 */
class Database extends Dexie {
  constructor() {
    super(DB_NAME);
    // v1：初始结构
    // v2：新增 comments / reviewSuggestions（审稿协作）
    // v3：新增 memory（写作记忆）
    this.version(1).stores(V1_STORES as unknown as Record<string, string>);
    this.version(2).stores(V2_STORES as unknown as Record<string, string>);
    this.version(DB_VERSION).stores(DB_STORES as unknown as Record<string, string>);
  }
}

interface Database extends HuaJiaoDB {}

export const db: Database & HuaJiaoDB = new Database() as Database & HuaJiaoDB;

export function tables(): HuaJiaoDB {
  return db;
}

/** 首次使用写入默认应用状态 */
export async function ensureAppState(): Promise<AppState> {
  const existing = await db.appState.get('singleton');
  if (existing) return existing;
  const now = new Date().toISOString();
  const fresh: AppState = {
    id: 'singleton',
    recentProjectIds: [],
    onboardingDone: false,
    createdAt: now,
    updatedAt: now,
  };
  await db.appState.put(fresh);
  return fresh;
}

/** 全库统计：设置页 / 数据管理页展示用 */
export async function databaseStats(): Promise<{
  name: string;
  verno: number;
  stores: { name: string; count: number }[];
  totalRecords: number;
  estimatedBytes: number;
}> {
  const counts = await Promise.all(db.tables.map((t) => t.count().catch(() => 0)));
  let estimatedBytes = 0;
  try {
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      estimatedBytes = est.usage ?? 0;
    }
  } catch {
    estimatedBytes = 0;
  }
  return {
    name: db.name,
    verno: db.verno,
    stores: db.tables.map((t, i) => ({ name: t.name, count: counts[i] })),
    totalRecords: counts.reduce((a, b) => a + b, 0),
    estimatedBytes,
  };
}

export async function requestPersistence(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function isPersisted(): Promise<boolean> {
  try {
    return (await navigator.storage?.persisted?.()) ?? false;
  } catch {
    return false;
  }
}

/** 清空整个数据库（危险操作，UI 需二次确认） */
export async function wipeDatabase(): Promise<void> {
  await db.delete();
  await db.open();
}
