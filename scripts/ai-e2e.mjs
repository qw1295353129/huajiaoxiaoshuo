/**
 * AI 链路端到端验证：配置假模型 → 写作台续写 → 流式渲染 → 插入正文 → 落库校验。
 * 前置：node scripts/mock-llm.mjs 8765 已启动。
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.NF_BASE ?? 'http://127.0.0.1:5178';
const OUT = '/tmp/nf-ai';
mkdirSync(OUT, { recursive: true });

const context = await chromium.launchPersistentContext('/tmp/nf-ai-profile', {
  channel: 'msedge',
  headless: true,
  viewport: { width: 1512, height: 945 },
});
const page = context.pages()[0] ?? (await context.newPage());
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message.slice(0, 200)));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('favicon')) errors.push('CONSOLE ' + m.text().slice(0, 220));
});
const log = [];

// ---------- 1. 建项目 + 装假模型 ----------
await page.goto(BASE + '/new', { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await page.fill('input[placeholder*="长夜将至"]', 'AI 链路验证');
await page.fill('textarea', '验尸官能听见死者遗言。');
await page.click('text=悬疑');
await page.click('text=先创建空白项目');
await page.waitForTimeout(2500);
const projectId = (page.url().match(/\/p\/([^/]+)/) ?? [])[1];
log.push('projectId=' + projectId);

const setup = await page.evaluate(async () => {
  const settingsRepo = await import('/src/db/repo/settings.ts');
  const prov = await settingsRepo.upsertProvider({
    id: 'prov_mock',
    name: '本地假模型（验证用）',
    kind: 'custom',
    baseUrl: 'http://127.0.0.1:8765/v1',
    models: ['mock-story-model'],
    enabled: true,
    corsBlocked: false,
  });
  const probe = await (await import('/src/ai/providers.ts')).probeProvider(prov);

  const raw = localStorage.getItem('novelforge:settings');
  const cur = raw ? JSON.parse(raw) : {};
  localStorage.setItem(
    'novelforge:settings',
    JSON.stringify({ ...cur, activeProviderId: prov.id, activeModel: 'mock-story-model', stream: true, contextBudget: 12000 }),
  );
  return { providerId: prov.id, probe };
});
log.push('setup=' + JSON.stringify(setup));

// 重新加载让 settings 生效
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

// ---------- 2. 造章节正文 ----------
await page.evaluate(async (pid) => {
  const outline = await import('/src/db/repo/outline.ts');
  const cast = await import('/src/db/repo/cast.ts');
  const ch = await outline.createChapter(pid, { title: '第一章 雨夜', summary: '沈砚在雨夜验尸。' });
  await outline.saveChapterContent(
    ch.id,
    '<p>雨下了整夜。</p><p>沈砚掀开白布的时候，死者张了张嘴。</p>',
    { touchStatus: false },
  );
  await cast.createCharacter(pid, {
    name: '沈砚',
    role: 'protagonist',
    tagline: '能听见死者遗言的验尸官',
    personality: '克制、寡言',
    voice: { tone: '冷静简短', verbalTics: ['嗯'], neverSays: ['我害怕'] },
  });
  return ch.id;
}, projectId);

await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1000);

// ---------- 3. 打开写作台 ----------
const chapterId = await page.evaluate(async (pid) => {
  const outline = await import('/src/db/repo/outline.ts');
  const list = await outline.listChapters(pid);
  return list[0]?.id;
}, projectId);
await page.goto(BASE + '/p/' + projectId + '/write/' + chapterId, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
const modelLabel = await page.evaluate(() => {
  const el = Array.from(document.querySelectorAll('button')).find((b) => /mock|模型/.test(b.textContent ?? ''));
  return el?.textContent?.trim() ?? '(未找到模型标签)';
});
log.push('editor model label: ' + modelLabel);
await page.screenshot({ path: OUT + '/01-editor-ready.png' });

// ---------- 4. 点「续写」 ----------
const clicked = await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('button'));
  const target = btns.find((b) => b.title && b.title.includes('从断点往下写'));
  if (target) {
    target.click();
    return true;
  }
  return false;
});
log.push('clicked 续写: ' + clicked);

// 等流式内容出现
let streamed = '';
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(500);
  streamed = await page.evaluate(() => {
    const el = document.querySelector('.manuscript.whitespace-pre-wrap, .manuscript');
    return el?.textContent ?? '';
  });
  if (streamed.length > 0) break;
}
log.push('streamed chars: ' + streamed.length + ' :: ' + streamed.slice(0, 60));
await page.waitForTimeout(3000);
await page.screenshot({ path: OUT + '/02-after-continue.png' });

// ---------- 5. 插入到正文 ----------
const inserted = await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('button'));
  const target = btns.find((b) => (b.textContent ?? '').includes('追加章末') || (b.textContent ?? '').includes('插入光标处'));
  if (target) {
    target.click();
    return (target.textContent ?? '').trim();
  }
  return null;
});
log.push('inserted via: ' + inserted);
await page.waitForTimeout(2500);
await page.screenshot({ path: OUT + '/03-after-insert.png' });

// ---------- 6. 数据库校验 ----------
const persisted = await page.evaluate(async (cid) => {
  const outline = await import('/src/db/repo/outline.ts');
  const c = await outline.getChapterContent(cid);
  const gens = await (await import('/src/db/repo/ai.ts')).listGenerations(
    (await outline.getChapter(cid))?.projectId ?? '',
    10,
  );
  const sugs = await (await import('/src/db/repo/ai.ts')).listSuggestions(
    (await outline.getChapter(cid))?.projectId ?? '',
    cid,
  );
  return {
    textLen: (c?.text ?? '').length,
    textHead: (c?.text ?? '').slice(0, 80),
    generations: gens.length,
    lastGen: gens[0] ? { task: gens[0].taskKind, model: gens[0].model, pt: gens[0].promptTokens, ct: gens[0].completionTokens, ok: gens[0].ok } : null,
    suggestions: sugs.length,
    contextSources: gens[0]?.contextSources?.map((s) => s.label + ':' + s.tokens) ?? [],
  };
}, chapterId);
log.push('persisted=' + JSON.stringify(persisted));

// ---------- 7. 一致性检查（JSON 输出链路） ----------
await page.goto(BASE + '/p/' + projectId + '/consistency', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
await page.screenshot({ path: OUT + '/04-consistency.png' });
const consistencyText = await page.evaluate(() => document.body.innerText.slice(0, 500).replace(/\n+/g, ' | '));
log.push('consistency page: ' + consistencyText.slice(0, 200));

await context.close();
console.log(JSON.stringify({ errors: errors.slice(0, 20), log }, null, 2));
