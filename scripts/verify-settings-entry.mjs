import { launchIsolated } from "./lib/browser.mjs";
/** 回归验证：所有「设置」入口都必须真的能进设置页。 */
import { chromium } from 'playwright';
const BASE = 'http://127.0.0.1:5178';
const context = await launchIsolated(import.meta.url, { viewport: { width: 1400, height: 900 } });
const page = context.pages()[0] ?? (await context.newPage());
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('favicon')) errors.push(m.text().slice(0, 160)); });
let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  \u2713 ' + name); }
  else { fail++; console.log('  \u2717 ' + name + (extra ? '  \u2192 ' + extra : '')); }
};

await page.goto(BASE + '/new', { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
await page.fill('input[placeholder*="长夜将至"]', '设置入口验证');
await page.click('text=先创建空白项目');
await page.waitForTimeout(2500);
const pid = (page.url().match(/\/p\/([^/]+)/) ?? [])[1];
const chId = await page.evaluate(async (id) => {
  const o = await import('/src/db/repo/outline.ts');
  const c = await o.createChapter(id, { title: '第一章' });
  return c.id;
}, pid);

console.log('【1】书库首页的设置按钮');
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
const homeBtn = await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('button')).find((x) => (x.getAttribute('aria-label') ?? '').includes('设置') || (x.title ?? '').includes('设置') || (x.textContent ?? '').trim() === '设置');
  if (b) { b.click(); return true; }
  return false;
});
await page.waitForTimeout(1200);
check('首页设置按钮存在且可点', homeBtn);
check('首页点设置后进入 /settings', page.url().includes('/settings'), page.url());

console.log('【2】侧边栏的设置按钮');
await page.goto(BASE + '/p/' + pid + '/outline', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const sideBtn = await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent ?? '').trim() === '设置');
  if (b) { b.click(); return true; }
  return false;
});
await page.waitForTimeout(1200);
check('侧栏设置按钮可点', sideBtn);
check('侧栏点设置后进入 /settings', page.url().includes('/settings'), page.url());

console.log('【3】写作台 AI 面板的模型按钮 → 深链到模型分区');
await page.goto(BASE + '/p/' + pid + '/write/' + chId, { waitUntil: 'networkidle' });
await page.waitForTimeout(2200);
const panelBtn = await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('button')).find((x) => (x.title ?? '') === '切换模型');
  if (b) { b.click(); return true; }
  return false;
});
await page.waitForTimeout(1200);
check('AI 面板模型按钮可点', panelBtn);
check('跳转到 /settings?tab=models', page.url().includes('tab=models'), page.url());
const activeTab = await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent ?? '').trim() === '模型与 AI');
  return b ? b.className.includes('bg-black') || b.className.includes('font-medium') : false;
});
check('设置页默认停在「模型与 AI」分区', activeTab);

console.log('【4】⌘, 快捷键');
await page.goto(BASE + '/p/' + pid + '/outline', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.keyboard.press('Meta+Comma');
await page.waitForTimeout(1200);
check('⌘, 进入设置', page.url().includes('/settings'), page.url());

console.log('【5】命令面板里的设置入口');
await page.goto(BASE + '/p/' + pid + '/outline', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.evaluate(() => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }));
});
await page.waitForTimeout(900);
// 注意：搜索框的 placeholder 不会被 innerText 抓到，要按"面板里有设置项"判断
const paletteOpen = await page.evaluate(() => Boolean(document.querySelector('.z-\\[500\\]')));
check('命令面板可打开', paletteOpen);
if (paletteOpen) {
  const settingsItem = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent ?? '').includes('设置 · 模型与 AI'));
    if (b) { b.click(); return true; }
    return false;
  });
  await page.waitForTimeout(1200);
  check('命令面板里有设置项且可跳转', settingsItem && page.url().includes('tab=models'), page.url());
}

console.log('【6】AI 未配置时的引导按钮');
await page.goto(BASE + '/p/' + pid + '/genesis', { waitUntil: 'networkidle' });
await page.waitForTimeout(1800);
const guideBtn = await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('button')).find((x) => /去设置|打开设置/.test(x.textContent ?? ''));
  if (b) { b.click(); return b.textContent.trim(); }
  return null;
});
await page.waitForTimeout(1200);
check('未见模型时给出引导按钮', Boolean(guideBtn), String(guideBtn));
check('引导按钮能进设置', page.url().includes('/settings'), page.url());

await page.screenshot({ path: '/tmp/nf-settings-fixed.png' });
await context.close();
console.log('');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('控制台错误: ' + (errors.length ? JSON.stringify(errors.slice(0, 5)) : 'NONE'));
process.exit(fail === 0 ? 0 : 1);