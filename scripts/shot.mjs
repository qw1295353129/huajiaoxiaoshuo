/**
 * 浏览器验证脚本：打开页面 → 收集控制台错误 → 截图。
 * 使用持久化 profile，IndexedDB 数据在多次运行之间保留。
 * 用法：node scripts/shot.mjs <url> <输出png> [等待毫秒] [额外JS]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const url = process.argv[2] ?? 'http://127.0.0.1:5178/';
const out = process.argv[3] ?? '/tmp/nf-shot.png';
const wait = Number(process.argv[4] ?? 2500);
const extraJs = process.argv[5];
const PROFILE = process.env.NF_PROFILE ?? '/tmp/nf-profile';

mkdirSync(dirname(out), { recursive: true });
mkdirSync(PROFILE, { recursive: true });

let context = null;
let launchError = '';
for (const channel of ['msedge', 'chrome', undefined]) {
  try {
    context = await chromium.launchPersistentContext(PROFILE, {
      channel,
      headless: true,
      viewport: { width: 1512, height: 945 },
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

const page = context.pages()[0] ?? (await context.newPage());
const errors = [];
const logs = [];
page.on('console', (msg) => {
  const t = msg.type();
  if (t === 'error') errors.push(msg.text().slice(0, 300));
  else logs.push(t + ': ' + msg.text().slice(0, 160));
});
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message.slice(0, 300)));
page.on('requestfailed', (r) => {
  if (!r.url().includes('favicon')) errors.push('REQFAIL: ' + r.url().slice(0, 120) + ' ' + (r.failure()?.errorText ?? ''));
});

await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 }).catch((e) => errors.push('GOTO: ' + e.message.split('\n')[0]));
await page.waitForTimeout(wait);

const text = await page.evaluate(() => document.body.innerText.slice(0, 2000)).catch(() => '');
const probe = extraJs ? await page.evaluate(extraJs).catch((e) => 'PROBE_ERROR: ' + e.message) : null;
await page.screenshot({ path: out, fullPage: false });
await context.close();

console.log(JSON.stringify({ url, out, errors: errors.slice(0, 25), logs: logs.slice(0, 6), text, probe }, null, 2));
