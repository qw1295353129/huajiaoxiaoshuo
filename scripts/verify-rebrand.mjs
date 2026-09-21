import { launchIsolated } from "./lib/browser.mjs";
import { chromium } from 'playwright';
const BASE = 'http://127.0.0.1:5178';
const context = await launchIsolated(import.meta.url, { viewport: { width: 1512, height: 945 } });
const page = context.pages()[0] ?? (await context.newPage());
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 140)));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('favicon')) errs.push(m.text().slice(0, 140)); });
let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  \u2713 ' + n); } else { fail++; console.log('  \u2717 ' + n + (x ? '  \u2192 ' + x : '')); } };

await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

console.log('【图标】');
const fav = await page.evaluate(() => {
  const l = document.querySelector('link[rel="icon"]');
  return l ? l.getAttribute('href') : null;
});
check('favicon 已链接', fav === '/favicon.svg', String(fav));
const svgText = await page.evaluate(async () => (await fetch('/favicon.svg')).text());
check('图标里没有「墨」字', !svgText.includes('墨'));
check('图标是黑底', svgText.includes('#0b0b0c'));
const box = await page.evaluate(() => {
  const img = document.querySelector('link[rel="icon"]');
  return img ? img.getAttribute('type') : null;
});
console.log('  favicon type: ' + box);

console.log('【设置项已清理】');
await page.goto(BASE + '/settings?tab=editor', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const editorText = await page.evaluate(() => document.body.innerText);
check('写作偏好里不再有「键盘方案 / vim」', !editorText.includes('vim') && !editorText.includes('键盘方案'));
check('写作偏好里有默认心流开关', editorText.includes('默认进入心流模式'));

console.log('【默认心流模式真的生效】');
await page.evaluate(() => {
  const raw = localStorage.getItem('huajiao:settings');
  const cur = raw ? JSON.parse(raw) : {};
  localStorage.setItem('huajiao:settings', JSON.stringify({ ...cur, flowByDefault: true }));
});
await page.goto(BASE + '/new', { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
await page.fill('input[placeholder*="长夜将至"]', '心流验证');
await page.click('text=先创建空白项目');
await page.waitForTimeout(2500);
const pid = (page.url().match(/\/p\/([^/]+)/) ?? [])[1];
const chId = await page.evaluate(async (id) => {
  const o = await import('/src/db/repo/outline.ts');
  const c = await o.createChapter(id, { title: '第一章' });
  return c.id;
}, pid);
await page.goto(BASE + '/p/' + pid + '/write/' + chId, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
const flowOn = await page.evaluate(() => document.body.innerText.includes('退出心流'));
check('打开写作页自动进入心流模式', flowOn);
await page.screenshot({ path: '/tmp/nf-flow.png' });

console.log('【数据库与存储改名】');
const storage = await page.evaluate(async () => {
  const dbmod = await import('/src/db/database.ts');
  return { dbName: dbmod.db.name, ver: dbmod.db.verno, settingsKeyUsed: Object.keys(localStorage).filter((k) => k.includes('settings') || k.includes('huajiao')) };
});
check('数据库名已改为 huajiao-writer', storage.dbName === 'huajiao-writer', storage.dbName);
check('localStorage 用的是 huajiao 键', storage.settingsKeyUsed.some((k) => k.startsWith('huajiao')), JSON.stringify(storage.settingsKeyUsed));

await context.close();
console.log('');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('控制台错误: ' + (errs.length ? JSON.stringify(errs.slice(0, 5)) : 'NONE'));