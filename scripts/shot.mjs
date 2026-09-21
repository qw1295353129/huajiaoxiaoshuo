/**
 * 浏览器验证脚本：打开页面 → 收集控制台错误 → 截图。
 * 用法：node scripts/shot.mjs <url> <输出png> [等待毫秒] [额外JS]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const url = process.argv[2] ?? 'http://127.0.0.1:5178/';
const out = process.argv[3] ?? '/tmp/nf-shot.png';
const wait = Number(process.argv[4] ?? 2500);
const extraJs = process.argv[5];

mkdirSync(dirname(out), { recursive: true });

// 优先用系统已装的浏览器，避免下载 Playwright 自带 chromium
const CHANNELS = ['msedge', 'chrome', null];
let browser = null;
let launchError = '';
const executablePath = process.env.NF_BROWSER_PATH;
for (const channel of CHANNELS) {
  try {
    browser = await chromium.launch(
      executablePath ? { headless: true, executablePath } : channel ? { headless: true, channel } : { headless: true },
    );
    break;
  } catch (e) {
    launchError += (channel ?? 'bundled') + ': ' + e.message.split('\n')[0] + '\n';
  }
}
if (!browser) {
  console.error('无法启动浏览器：\n' + launchError);
  process.exit(2);
}
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

const errors = [];
const logs = [];
page.on('console', (msg) => {
  const t = msg.type();
  if (t === 'error') errors.push(msg.text());
  else logs.push(t + ': ' + msg.text().slice(0, 200));
});
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('requestfailed', (r) => errors.push('REQFAIL: ' + r.url() + ' ' + (r.failure()?.errorText ?? '')));

await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 }).catch((e) => errors.push('GOTO: ' + e.message));
await page.waitForTimeout(wait);

let probe = null;
if (extraJs) {
  probe = await page.evaluate(extraJs).catch((e) => 'PROBE_ERROR: ' + e.message);
}

const text = await page.evaluate(() => document.body.innerText.slice(0, 1500)).catch(() => '');
await page.screenshot({ path: out, fullPage: false });
await browser.close();

console.log(JSON.stringify({ url, out, errors: errors.slice(0, 30), logs: logs.slice(0, 10), text, probe }, null, 2));
