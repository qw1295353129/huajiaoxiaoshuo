/** 端到端冒烟：创建作品 → 进写作台 → 输入 → 验证自动保存 → 大纲/人物/世界观/设置页截图 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.NF_BASE ?? 'http://127.0.0.1:5178';
const OUT = '/tmp/nf-e2e';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1512, height: 945 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('favicon')) errors.push('CONSOLE: ' + m.text().slice(0, 200)); });

const steps = [];
const shot = async (name) => { await page.screenshot({ path: OUT + '/' + name + '.png' }); steps.push('shot ' + name); };

// 1. 首页
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await shot('01-home');

// 2. 新建作品
await page.goto(BASE + '/new', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await page.fill('input[placeholder*="长夜将至"]', '测试书：长夜将至');
await page.fill('textarea', '一个能听见死者遗言的验尸官，发现自己的名字出现在下一具尸体上。');
await page.click('text=玄幻');
await page.click('text=悬疑');
await page.waitForTimeout(300);
await shot('02-new-filled');

await page.click('text=先创建空白项目');
await page.waitForTimeout(2500);
steps.push('url after create: ' + page.url());
await shot('03-after-create');

// 3. 写作台
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
const card = await page.$('text=测试书：长夜将至');
if (card) {
  await card.click();
  await page.waitForTimeout(1500);
  steps.push('opened project: ' + page.url());
}
await page.goto(page.url().replace(/\/overview.*$/, '/write'), { waitUntil: 'networkidle' }).catch(() => {});
await page.waitForTimeout(1500);
// 若没有章节，点新建
const newBtn = await page.$('text=新建第一章');
if (newBtn) { await newBtn.click(); await page.waitForTimeout(1500); }
steps.push('editor url: ' + page.url());
await shot('04-editor');

// 4. 输入正文
const editor = await page.$('.ProseMirror');
if (editor) {
  await editor.click();
  await page.keyboard.type('雪停了。\n她推开那扇门的时候，屋里没有点灯，只有炭盆里一点暗红在呼吸。');
  await page.waitForTimeout(2500);
  steps.push('typed into editor');
}
const wordCountText = await page.evaluate(() => {
  const el = document.querySelector('.tabular');
  return document.body.innerText.slice(0, 400);
});
await shot('05-editor-typed');

// 5. 刷新验证持久化
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
const persisted = await page.evaluate(() => document.querySelector('.ProseMirror')?.textContent ?? '');
steps.push('persisted text length: ' + persisted.length + ' :: ' + persisted.slice(0, 40));
await shot('06-after-reload');

// 6. 各功能页
const routes = ['outline', 'characters', 'world', 'threads', 'timeline', 'graph', 'insights', 'consistency', 'ai', 'genesis', 'usage', 'data'];
const projectId = (page.url().match(/\/p\/([^/]+)/) ?? [])[1];
steps.push('projectId: ' + projectId);
for (const r of routes) {
  await page.goto(BASE + '/p/' + projectId + '/' + r, { waitUntil: 'networkidle' }).catch((e) => steps.push('goto fail ' + r));
  await page.waitForTimeout(1200);
  const body = await page.evaluate(() => document.body.innerText.slice(0, 90).replace(/\n/g, ' | '));
  steps.push(r + ' :: ' + body);
  await shot('07-' + r);
}

// 7. 设置页
await page.goto(BASE + '/settings', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await shot('08-settings');
const settingsText = await page.evaluate(() => document.body.innerText.slice(0, 300).replace(/\n/g, ' | '));
steps.push('settings :: ' + settingsText);

await browser.close();
console.log(JSON.stringify({ errors: errors.slice(0, 25), steps }, null, 2));
