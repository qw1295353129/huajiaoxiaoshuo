/**
 * 单次会话内的全站巡检：建项目 → 造数据 → 逐页截图并收集错误。
 * 所有页面都在同一个浏览器上下文里访问，保证看到的是同一份数据。
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.NF_BASE ?? 'http://127.0.0.1:5178';
const OUT = process.env.NF_OUT ?? '/tmp/nf-tour';
mkdirSync(OUT, { recursive: true });

const context = await chromium.launchPersistentContext('/tmp/nf-tour-profile', {
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

const report = [];
const visit = async (path, name, wait = 1600) => {
  await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 40000 }).catch(() => {});
  await page.waitForTimeout(wait);
  await page.screenshot({ path: OUT + '/' + name + '.png' });
  const info = await page.evaluate(() => {
    const main = document.querySelector('main') ?? document.body;
    return {
      heading: (document.querySelector('h1')?.textContent ?? '').slice(0, 60),
      text: main.innerText.replace(/\n+/g, ' | ').slice(0, 420),
      cards: document.querySelectorAll('[class*="rounded"]').length,
    };
  });
  report.push({ name, path, ...info });
};

// 1) 建项目并写入样例数据
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await page.evaluate(async () => {
  const mod = await import('/src/db/repo/projects.ts').catch(() => null);
  return Boolean(mod);
});
await page.goto(BASE + '/new', { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await page.fill('input[placeholder*="长夜将至"]', '雾港纪事');
await page.fill('textarea', '一个能听见死者遗言的验尸官，发现自己的名字出现在下一具尸体上。');
await page.click('text=悬疑');
await page.click('text=先创建空白项目');
await page.waitForTimeout(2500);
const projectId = (page.url().match(/\/p\/([^/]+)/) ?? [])[1];
report.push({ name: 'projectId', path: page.url(), heading: projectId, text: '', cards: 0 });

// 2) 在页面上下文里直接写入一批演示设定（走 repo，验证数据层与 UI 的联动）
const seeded = await page.evaluate(async () => {
  const repo = await import('/src/db/repo/index.ts');
  const outline = await import('/src/db/repo/outline.ts');
  const cast = await import('/src/db/repo/cast.ts');
  const world = await import('/src/db/repo/world.ts');
  const story = await import('/src/db/repo/story.ts');
  const projects = await import('/src/db/repo/projects.ts');

  const list = await projects.listProjects();
  const pid = list[0].id;

  const arc = await outline.createArc(pid, '第一卷 · 溺水的钟', {
    summary: '雾港连续出现三具无名尸，验尸官沈砚在第三具尸体口中听见了自己的名字。',
    goal: '查清三具尸体的身份',
    conflict: '警局高层施压要求结案',
    outcome: '沈砚被停职，但拿到了关键线索',
  });

  const chapters = [
    { title: '第一章 第三具尸体', summary: '沈砚在雨夜验尸，听见死者说出自己的名字。', tension: 4 },
    { title: '第二章 旧档案', summary: '他在十二年前的失踪案卷宗里发现了相同的伤口。', tension: 2 },
    { title: '第三章 停职通知', summary: '上司以程序违规为由停他的职。', tension: 3 },
  ];
  const created = [];
  for (const c of chapters) {
    const ch = await outline.createChapter(pid, { title: c.title, arcId: arc.id, summary: c.summary });
    await outline.updateChapter(ch.id, { tension: c.tension, status: 'drafted', goals: ['推进调查', '埋下线索'] });
    created.push(ch.id);
  }
  await outline.saveChapterContent(
    created[0],
    '<p>雨下了整夜。</p><p>沈砚掀开白布的时候，验尸房的铜钟正好敲过三下。死者的嘴唇动了一下——他听见自己的名字。</p>',
    { touchStatus: false },
  );

  const shen = await cast.createCharacter(pid, {
    name: '沈砚',
    role: 'protagonist',
    tagline: '能听见死者遗言的验尸官',
    age: '34',
    gender: '男',
    personality: '极度克制，把情绪都藏在解剖刀下',
    want: '查清母亲失踪的真相',
    need: '学会相信活着的人',
    fear: '自己也会成为一具无名尸',
    flaw: '拒绝求助，宁可独自承担',
    arc: '从独行者变成愿意把后背交给同伴的人',
    voice: { tone: '冷静、简短', verbalTics: ['嗯'], favoriteWords: ['伤口', '时间'], neverSays: ['我害怕'], register: '专业而疏离', sampleLines: ['死亡不会说谎，说谎的是活着的人。'] },
    tags: ['主角'],
  });
  const lin = await cast.createCharacter(pid, {
    name: '林晚',
    role: 'deuteragonist',
    tagline: '被停职的刑警，沈砚唯一信得过的人',
    personality: '直接、冲动、护短',
    want: '翻案',
    need: '放下对哥哥之死的执念',
    voice: { tone: '干脆、带刺', verbalTics: ['啧'], neverSays: ['随便你'], register: '市井直白' },
  });
  await cast.upsertRelationship(pid, shen.id, lin.id, { kind: 'ally', affinity: 62, description: '旧案中结识，互相欠过命' });

  const port = await world.createWorldEntry(pid, {
    title: '雾港',
    category: 'geography',
    body: '常年被浓雾笼罩的北方港口城市，一年有九个月见不到太阳。城市的排水系统建于殖民时期，地下管网比地面街道更古老。',
    importance: 5,
    tags: ['主场景'],
  });
  await world.createWorldEntry(pid, {
    title: '验尸官的规矩',
    category: 'culture',
    body: '验尸官不得与死者家属私下接触；所有验尸记录须双人签字；听到遗言者应当立即上报。',
    importance: 4,
    rules: [{ id: 'r1', statement: '验尸官听到遗言后必须在十二时辰内上报', severity: 'error', enabled: true }],
  });
  await world.upsertGlossary(pid, '沈砚', ['沈验尸', '老沈']);
  await world.upsertRule(pid, {
    name: '遗言只能被听到一次',
    description: '同一个死者的遗言只会被听见一次，重复询问不会有结果。',
    kind: 'custom-llm',
    severity: 'error',
    enabled: true,
  });

  await story.upsertThread(pid, {
    title: '铜钟的三下',
    kind: 'foreshadow',
    description: '每次有死者出现，验尸房的铜钟都会敲三下，但没有人去敲它。',
    plantedChapterId: created[0],
    priority: 'main',
    status: 'planted',
    plantQuote: '验尸房的铜钟正好敲过三下',
  });
  await story.upsertTimelineEvent(pid, {
    title: '第三具尸体被发现',
    inWorldTime: '第十二年·霜月',
    description: '渔民在防波堤下发现一具无名男尸。',
    chapterIds: [created[0]],
    participantIds: [shen.id],
    locationId: port.id,
    importance: 5,
  });
  await projects.recomputeProjectStats(pid);
  return { pid, arcId: arc.id, chapters: created.length, firstChapterId: created[0], characters: 2 };
});
report.push({ name: 'seeded', path: '-', heading: JSON.stringify(seeded), text: '', cards: 0 });

// 3) 逐页巡检
const pages = [
  ['/overview', 'overview'],
  ['/outline', 'outline'],
  ['/characters', 'characters'],
  ['/world', 'world'],
  ['/threads', 'threads'],
  ['/timeline', 'timeline'],
  ['/graph', 'graph'],
  ['/insights', 'insights'],
  ['/consistency', 'consistency'],
  ['/ai', 'ai'],
  ['/genesis', 'genesis'],
  ['/usage', 'usage'],
  ['/data', 'data'],
];
for (const [suffix, name] of pages) {
  await visit('/p/' + projectId + suffix, 'P-' + name, 2000);
}
await visit('/p/' + projectId + '/write/' + seeded.firstChapterId, 'P-write', 3000);
await visit('/settings', 'P-settings', 1500);

await context.close();
console.log(JSON.stringify({ errors: errors.slice(0, 30), report }, null, 2));
