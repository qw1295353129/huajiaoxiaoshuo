/**
 * 真实模型端到端：用 DeepSeek 跑「一句话成书」与「续写」，检验 AI 引擎在真模型下的表现。
 * API Key 只从环境变量读取，不写入任何文件。
 * 用法：DEEPSEEK_KEY=sk-xxx node scripts/real-model-e2e.mjs
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const KEY = process.env.DEEPSEEK_KEY;
if (!KEY) {
  console.error('缺少 DEEPSEEK_KEY 环境变量');
  process.exit(1);
}
const BASE = process.env.NF_BASE ?? 'http://127.0.0.1:5178';
const OUT = '/tmp/nf-real';
mkdirSync(OUT, { recursive: true });

const context = await chromium.launchPersistentContext('/tmp/nf-real-profile', {
  channel: 'msedge',
  headless: true,
  viewport: { width: 1512, height: 945 },
});
const page = context.pages()[0] ?? (await context.newPage());
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message.slice(0, 200)));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('favicon')) errors.push('CONSOLE ' + m.text().slice(0, 200));
});
const log = [];

// 建项目
await page.goto(BASE + '/new', { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
await page.fill('input[placeholder*="长夜将至"]', '雾港纪事');
await page.fill('textarea', '一个能听见死者遗言的验尸官，发现自己的名字出现在下一具尸体上。');
await page.click('text=悬疑');
await page.click('text=先创建空白项目');
await page.waitForTimeout(2500);
const projectId = (page.url().match(/\/p\/([^/]+)/) ?? [])[1];
log.push('projectId=' + projectId);

// 配置 DeepSeek（Key 通过 evaluate 参数传入，不落盘）
const setup = await page.evaluate(async (key) => {
  const settingsRepo = await import('/src/db/repo/settings.ts');
  const prov = await settingsRepo.upsertProvider({
    id: 'preset-deepseek',
    name: 'DeepSeek 深度求索',
    kind: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: key,
    models: ['deepseek-flash', 'deepseek-v4-pro'],
    enabled: true,
    corsBlocked: false,
  });
  const probe = await (await import('/src/ai/providers.ts')).probeProvider(prov);
  const raw = localStorage.getItem('novelforge:settings');
  const cur = raw ? JSON.parse(raw) : {};
  localStorage.setItem('novelforge:settings', JSON.stringify({
    ...cur,
    activeProviderId: prov.id,
    activeModel: 'deepseek-flash',
    stream: true,
    contextBudget: 24000,
    allowCloud: true,
  }));
  return { probe };
}, KEY);
log.push('连接自检: ' + JSON.stringify(setup.probe));

await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1000);

// ---------- 真跑「一句话成书」 ----------
await page.goto(BASE + '/p/' + projectId + '/genesis', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
const filled = await page.evaluate(() => {
  const ta = document.querySelector('textarea');
  if (ta) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, '一个能听见死者遗言的验尸官，发现自己的名字出现在下一具尸体上。');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }
  return false;
});
log.push('灵感填入: ' + filled);
await page.waitForTimeout(500);
await page.screenshot({ path: OUT + '/01-genesis-form.png' });

// 点开始生成（找主按钮）
const clicked = await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('button'));
  const b = btns.find((x) => /开始|生成|建档/.test(x.textContent ?? '') && !x.disabled);
  if (b) { b.click(); return b.textContent.trim(); }
  return null;
});
log.push('点击: ' + clicked);

// 等生成完成：轮询数据库里的 GenesisRun 状态，最长 12 分钟
let stageText = '';
let runStatus = 'pending';
for (let i = 0; i < 240; i++) {
  await page.waitForTimeout(3000);
  const st = await page.evaluate(async (pid) => {
    const repo = await import('/src/db/repo/genesis.ts');
    const runs = await repo.listGenesisRuns(pid);
    const r = runs[0];
    if (!r) return { status: 'none', stages: [] };
    return {
      status: r.status,
      stages: r.stages.map((s) => s.kind + ':' + s.status + (s.error ? '(' + s.error.slice(0, 60) + ')' : '')),
    };
  }, projectId);
  runStatus = st.status;
  if (i % 5 === 0) log.push('  t=' + (i * 3) + 's ' + st.status + ' [' + st.stages.join(', ') + ']');
  if (st.status === 'done' || st.status === 'failed') {
    stageText = await page.evaluate(() => document.body.innerText.slice(0, 2500));
    break;
  }
}
await page.screenshot({ path: OUT + '/02-genesis-result.png' });
log.push('结果页文本片段: ' + stageText.replace(/\n+/g, ' | ').slice(0, 700));

const dbState = await page.evaluate(async (pid) => {
  const repo = await import('/src/db/repo/index.ts');
  const [chars, world, arcs, chapters, rules, gens] = await Promise.all([
    repo.listCharacters(pid),
    repo.listWorldEntries(pid),
    repo.listArcs(pid),
    repo.listChapters(pid),
    repo.listRules(pid),
    repo.listGenerations(pid, 20),
  ]);
  return {
    characters: chars.map((c) => c.name + '/' + c.role),
    world: world.length,
    arcs: arcs.map((a) => a.title),
    chapters: chapters.length,
    rules: rules.length,
    generations: gens.map((g) => ({
      task: g.taskKind,
      model: g.model,
      ok: g.ok,
      pt: g.promptTokens,
      ct: g.completionTokens,
      ms: g.ms,
      err: g.error,
    })),
  };
}, projectId);
log.push('数据库状态: ' + JSON.stringify(dbState, null, 1));

await context.close();
console.log(JSON.stringify({ errors: errors.slice(0, 15), log }, null, 2));