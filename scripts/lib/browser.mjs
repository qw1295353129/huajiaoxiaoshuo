/**
 * 测试脚本共用的浏览器启动器。
 *
 * 为什么要统一：之前每个脚本各自写死 profile 目录，有两个脚本用了同一个路径，
 * 批量跑时后一个脚本会看到前一个留下的项目数据，导致"单跑全过、批量失败"的假象。
 * 现在按脚本名隔离，并且每次启动前清空。
 */
import { chromium } from 'playwright';
import { rmSync, mkdirSync } from 'node:fs';
import { basename } from 'node:path';

/**
 * 启动一个隔离的浏览器上下文。
 * @param {string} scriptUrl import.meta.url，用于推导 profile 名
 * @param {{viewport?: {width:number;height:number}; fresh?: boolean}} opts
 */
export async function launchIsolated(scriptUrl, opts = {}) {
  const name = basename(new URL(scriptUrl).pathname).replace(/\.mjs$/, '');
  const dir = '/tmp/nf-profile-' + name;
  if (opts.fresh !== false) {
    rmSync(dir, { recursive: true, force: true });
  }
  mkdirSync(dir, { recursive: true });

  let context = null;
  let launchError = '';
  for (const channel of ['msedge', 'chrome', undefined]) {
    try {
      context = await chromium.launchPersistentContext(dir, {
        channel,
        headless: true,
        viewport: opts.viewport ?? { width: 1512, height: 945 },
      });
      break;
    } catch (e) {
      launchError += (channel ?? 'bundled') + ': ' + String(e.message).split('\n')[0] + '\n';
    }
  }
  if (!context) {
    console.error('无法启动浏览器：\n' + launchError);
    process.exit(2);
  }
  return context;
}

/**
 * 打开页面并**等 React 真正挂载完**。
 *
 * 为什么不能只用 waitUntil:'networkidle'：它在 Vite 的 HTML 返回后就可能触发，
 * 此时 #root 还是空的。批量跑回归时机器负载高，React 挂载慢几百毫秒，
 * 后面所有断言就都落空了 —— 表现为"单跑全过、批量失败"的偶发失败。
 *
 * 这里显式等 #root 里出现元素，再加一个短暂静默期等首屏数据（Dexie 异步查询）落定。
 */
export async function gotoApp(page, url, opts = {}) {
  const { timeout = 30000, settle = 1200 } = opts;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForFunction(() => (document.getElementById('root')?.children.length ?? 0) > 0, { timeout });
  } catch {
    // 挂载失败时不要静默继续：把真实状态打出来，方便定位
    const state = await page
      .evaluate(() => ({
        url: location.pathname + location.search,
        rootChildren: document.getElementById('root')?.children.length ?? -1,
        bodyLen: document.body.innerText.length,
      }))
      .catch(() => ({}));
    throw new Error('页面没有挂载：' + JSON.stringify(state));
  }
  if (settle) await page.waitForTimeout(settle);
  return page;
}

/**
 * 轮询直到条件成立。用于替代固定 sleep ——
 * 固定等待在负载高时必然偶发失败，轮询只是多等一会儿，不会误判。
 */
export async function waitFor(page, fn, opts = {}) {
  const { timeout = 15000, interval = 300 } = opts;
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await page.evaluate(fn).catch(() => undefined);
    if (last) return last;
    await page.waitForTimeout(interval);
  }
  return last;
}
