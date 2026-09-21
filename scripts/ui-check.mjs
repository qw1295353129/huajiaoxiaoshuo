import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const BASE = 'http://127.0.0.1:5178';
const OUT = '/tmp/nf-ui';
mkdirSync(OUT, { recursive: true });
const context = await chromium.launchPersistentContext('/tmp/nf-ui-profile', { channel: 'msedge', headless: true, viewport: { width: 1512, height: 945 } });
const page = context.pages()[0] ?? (await context.newPage());
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message.slice(0, 160)));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('favicon')) errors.push('CONSOLE ' + m.text().slice(0, 160)); });
const log = [];

await page.goto(BASE + '/settings', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
await page.screenshot({ path: OUT + '/01-settings-profile.png' });
log.push('设置页首屏: ' + (await page.evaluate(() => document.body.innerText.slice(0, 200).replace(/\n+/g, ' | '))));

// 逐个设置 tab 点一遍
for (const [label, name] of [['模型与 AI','models'],['任务路由','routing'],['写作偏好','editor'],['隐私','privacy'],['数据','data'],['关于','about']]) {
  await page.evaluate((l) => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent ?? '').trim() === l);
    if (btn) btn.click();
  }, label);
  await page.waitForTimeout(900);
  await page.screenshot({ path: OUT + '/02-settings-' + name + '.png' });
  const txt = await page.evaluate(() => document.body.innerText.slice(0, 130).replace(/\n+/g, ' | '));
  log.push(label + ' → ' + txt);
}

// 创作者档案：加一条原则
await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent ?? '').trim() === '创作者档案');
  if (btn) btn.click();
});
await page.waitForTimeout(800);
const added = await page.evaluate(() => {
  const preset = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes('不写总结句'));
  if (preset) { preset.click(); return preset.textContent.trim(); }
  return null;
});
log.push('加入写作原则: ' + added);
await page.waitForTimeout(600);
await page.screenshot({ path: OUT + '/03-profile-filled.png' });
const stored = await page.evaluate(() => {
  const raw = localStorage.getItem('novelforge:settings');
  const s = raw ? JSON.parse(raw) : {};
  return { principles: s.writingPrinciples ?? [], forbidden: s.globalForbidden ?? [] };
});
log.push('localStorage 中的档案: ' + JSON.stringify(stored));

// 建项目看数据页的导出选项
await page.goto(BASE + '/new', { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await page.fill('input[placeholder*="长夜将至"]', '导出测试');
await page.click('text=先创建空白项目');
await page.waitForTimeout(2500);
const pid = (page.url().match(/\/p\/([^/]+)/) ?? [])[1];
await page.evaluate(async (id) => {
  const outline = await import('/src/db/repo/outline.ts');
  const arcs = await import('/src/db/repo/outline.ts');
  const arc = await arcs.createArc(id, '第一卷 · 试写');
  const ch = await outline.createChapter(id, { title: '第一章 雨夜', arcId: arc.id });
  await outline.saveChapterContent(ch.id, '<p>雨下了整夜。</p><p>沈砚掀开白布。</p>', { touchStatus: false });
  return ch.id;
}, pid);
await page.goto(BASE + '/p/' + pid + '/data', { waitUntil: 'networkidle' });
await page.waitForTimeout(1600);
await page.screenshot({ path: OUT + '/04-data-export.png' });
const formats = await page.evaluate(() =>
  Array.from(document.querySelectorAll('button')).map((b) => (b.textContent ?? '').trim()).filter((t) => /\.(txt|md|html|epub|docx|json)/.test(t)),
);
log.push('导出格式按钮: ' + JSON.stringify(formats));

await context.close();
console.log(JSON.stringify({ errors: errors.slice(0, 15), log }, null, 2));