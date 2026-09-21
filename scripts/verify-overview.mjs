import { launchIsolated } from "./lib/browser.mjs";
import { chromium } from 'playwright';
const BASE = 'http://127.0.0.1:5178';
const context = await launchIsolated(import.meta.url, { viewport: { width: 1512, height: 945 } });
const page = context.pages()[0] ?? (await context.newPage());
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 140)));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('favicon')) errs.push(m.text().slice(0, 140)); });

await page.goto(BASE + '/new', { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
await page.fill('input[placeholder*="长夜将至"]', '总览验证');
await page.click('text=先创建空白项目');
await page.waitForTimeout(2500);
const pid = (page.url().match(/\/p\/([^/]+)/) ?? [])[1];

// 造数据：卷 + 3 章 + 人物 + 伏笔 + 写作会话
await page.evaluate(async (id) => {
  const o = await import('/src/db/repo/outline.ts');
  const c = await import('/src/db/repo/cast.ts');
  const s = await import('/src/db/repo/story.ts');
  const p = await import('/src/db/repo/projects.ts');
  const w = await import('/src/db/repo/writing.ts');
  const arc = await o.createArc(id, '第一卷 · 溺水的钟', { summary: '三具无名尸把沈砚拖回旧案。' });
  const titles = ['第一章 第三具尸体', '第二章 旧档案', '第三章 停职通知'];
  const ids = [];
  for (const t of titles) {
    const ch = await o.createChapter(id, { title: t, arcId: arc.id });
    await o.saveChapterContent(ch.id, '<p>' + '雨下了整夜。沈砚掀开白布的时候，死者张了张嘴。'.repeat(40) + '</p>', { touchStatus: false });
    await o.updateChapter(ch.id, { status: 'drafted', summary: '本章梗概', tension: 3 });
    ids.push(ch.id);
  }
  await c.createCharacter(id, { name: '沈砚', role: 'protagonist', tagline: '能听见死者遗言的验尸官' });
  await c.createCharacter(id, { name: '裴济舟', role: 'antagonist', tagline: '警局副局长' });
  await s.upsertThread(id, { title: '铜钟的三下', kind: 'foreshadow', plantedChapterId: ids[0], priority: 'main', status: 'planted', description: '无人敲响却会响的钟' });
  const sess = await w.startSession(id, ids[0]);
  await w.updateSession(sess.id, { wordsAdded: 3200, endedAt: new Date().toISOString(), activeMs: 3600000 });
  await p.upsertGoal(id, { dailyWords: 2000, enabled: true });
  await p.recomputeProjectStats(id);
  return ids;
}, pid);

await page.goto(BASE + '/p/' + pid + '/overview', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
const text = await page.evaluate(() => document.body.innerText);
let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  \u2713 ' + n); } else { fail++; console.log('  \u2717 ' + n + (x ? '  \u2192 ' + x : '')); } };
check('显示书名', text.includes('总览验证'));
check('显示全书进度百分比', /\d+\.\d%/.test(text));
check('显示今日进度', text.includes('今日进度'));
check('显示近 7 天', text.includes('近 7 天'));
check('显示平均章长', text.includes('平均章长'));
check('四张指标卡齐全', text.includes('章节') && text.includes('总字数') && text.includes('人物') && text.includes('伏笔'));
check('「接下来」给出行动项', text.includes('接下来') && (text.includes('继续写') || text.includes('伏笔需要关注')));
check('写作节奏图', text.includes('写作节奏'));
check('结构分布', text.includes('结构') && text.includes('草案') === false);
check('不再有「建设中」文案', !text.includes('建设中'));
await page.screenshot({ path: '/tmp/nf-overview.png' });

await context.close();
console.log('');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('控制台错误: ' + (errs.length ? JSON.stringify(errs.slice(0, 5)) : 'NONE'));