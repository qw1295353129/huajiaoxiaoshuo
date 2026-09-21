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
