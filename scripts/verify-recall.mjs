/**
 * 语义重排纯函数验证：候选重排（硬成员/相似度/降级/limit）与段落分片。
 * 用法：node scripts/verify-recall.mjs
 */
import { createServer } from 'vite';
import { spawn } from 'node:child_process';

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const load = (p) => vite.ssrLoadModule('/' + p);

let pass = 0;
let fail = 0;
const check = (name, cond, extra) => {
  if (cond) {
    pass += 1;
    console.log('  ✓ ' + name);
  } else {
    fail += 1;
    console.log('  ✗ ' + name + (extra ? '  → ' + extra : ''));
  }
};

const { rerankBySimilarity, splitPassages, PASSAGE_MAX_CHARS, PASSAGE_MIN_CHARS } = await load('src/ai/recall.ts');

// ---------- 构造确定性向量：query 方向 [1,0] ----------
const query = [1, 0];
const vec = (x, y) => [x, y];
const vectors = new Map([
  ['exact', vec(1, 0)],       // cos = 1
  ['mid', vec(0.6, 0.8)],     // cos = 0.6
  ['weak', vec(0.1, 1)],      // cos ≈ 0.1
  ['neg', vec(-1, 0)],        // cos = -1（剔除）
  // 'novec' 故意缺向量
]);

console.log('【重排：基本序】');
{
  const cands = ['mid', 'exact', 'neg', 'weak'];
  const r = rerankBySimilarity(cands, vectors, query);
  check('按相似度降序', r.applied && r.ids.join(',') === 'exact,mid,weak', r.ids.join(','));
  check('score<=0 被剔除', !r.ids.includes('neg'));
}

console.log('【重排：向量未齐整体回退（惰性建索引的暖机期）】');
{
  const r = rerankBySimilarity(['mid', 'novec', 'exact'], vectors, query);
  check('任一候选缺向量 → applied=false 且原序', !r.applied && r.ids.join(',') === 'mid,novec,exact', r.ids.join(','));
  const noPos = rerankBySimilarity(['neg'], vectors, query);
  check('全部有向量但无正分 → 回退规则序', !noPos.applied && noPos.ids.join(',') === 'neg');
  const z = rerankBySimilarity(['z'], new Map([['z', [0, 0]]]), query);
  check('零向量 cos=0 → 回退规则序', !z.applied && z.ids.join(',') === 'z');
}

console.log('【重排：硬成员】');
{
  const cands = ['hardB', 'mid', 'hardA', 'exact', 'weak'];
  const r = rerankBySimilarity(cands, vectors, query, { hardIds: ['hardA', 'hardB'] });
  check('硬成员保持规则序且置最前', r.ids.slice(0, 2).join(',') === 'hardB,hardA', r.ids.join(','));
  check('硬成员缺向量也保留', r.applied && r.ids.includes('hardA') && r.ids.includes('hardB'));
  const r2 = rerankBySimilarity(cands, vectors, query, { hardIds: ['ghost'] });
  check('不在候选里的 hardId 被忽略', !r2.ids.includes('ghost'));
}

console.log('【重排：limit 只裁非硬成员】');
{
  const cands = ['hardA', 'exact', 'mid', 'weak'];
  const r = rerankBySimilarity(cands, vectors, query, { hardIds: ['hardA'], limit: 2 });
  check('limit=2 时硬成员不占预算', r.ids.join(',') === 'hardA,exact,mid', r.ids.join(','));
}

console.log('【重排：同分与降级】');
{
  const tie = new Map([
    ['a', [1, 0]],
    ['b', [1, 0]],
  ]);
  const r = rerankBySimilarity(['b', 'a'], tie, query);
  check('同分保持规则序', r.ids.join(',') === 'b,a', r.ids.join(','));

  const noQuery = rerankBySimilarity(['a', 'b'], vectors, null);
  check('无 query 向量 → applied=false 且原序', !noQuery.applied && noQuery.ids.join(',') === 'a,b');

  const allHard = rerankBySimilarity(['h1', 'h2'], vectors, query, { hardIds: ['h1', 'h2'] });
  check('没有非硬候选 → applied=false', !allHard.applied);

  const empty = rerankBySimilarity([], vectors, query);
  check('空候选 → applied=false、空结果', !empty.applied && empty.ids.length === 0);
}

console.log('【分片：切段与截断】');
{
  const text = [
    '短段',                                        // <=20 字，丢弃
    '这一段刚好超过二十个字，保留下来作为第一个分片。', // >20，保留
    '',
    '第二段同样超过二十个字的长度要求，也应保留。',
  ].join('\n');
  const chunks = splitPassages('ch1', text);
  check('短段丢弃、长段保留', chunks.length === 2, 'got ' + chunks.length);
  check('id = 章节:序号（连续）', chunks.map((c) => c.id).join(',') === 'ch1:0,ch1:1', chunks.map((c) => c.id).join(','));
  check('段落文本原样（trim 后）', chunks[0].text.includes('刚好超过二十个字'));

  const long = '这是一个很长的句子，它会一直写下去一直写下去直到超过六百个字为止。'.repeat(12);
  const c2 = splitPassages('ch2', long);
  check('单段整段只出一个分片', c2.length === 1, 'got ' + c2.length);
  check('超长段截到 ' + PASSAGE_MAX_CHARS + ' 字内', c2[0].text.length <= PASSAGE_MAX_CHARS, 'len ' + c2[0].text.length);

  const multi = Array.from({ length: 30 }, (_, i) => `第${i}个句子，这里补足字数让它整体超过六百字的限制条件。`).join('');
  const c3 = splitPassages('ch3', multi);
  const t = c3[0].text;
  check('按句截断（结尾是句号）', t.length <= PASSAGE_MAX_CHARS && /[。；]$/.test(t), JSON.stringify(t.slice(-10)));
  check('截断不切断句中（首句超长才硬切除外）', t.length >= 400, 'len ' + t.length);

  const oneHuge = '啊'.repeat(1500);
  const c4 = splitPassages('ch4', oneHuge);
  check('一句就超长 → 硬切到上限', c4[0].text.length === PASSAGE_MAX_CHARS, 'len ' + c4[0].text.length);

  const noNewline = '连续正文没有换行但是每一段都超过二十个字的要求，所以会整体保留为一个分片处理。';
  const c5 = splitPassages('ch5', noNewline);
  check('无换行正文 → 单分片', c5.length === 1);
  check('短于 ' + PASSAGE_MIN_CHARS + ' 字的段全部过滤', splitPassages('ch6', '太短\n也短\n这一段确实超过了二十个字的长度下限，因此应当被保留下来。').length === 1);
}

await vite.close();

// ================= T2 验收：passageVectors 惰性缓存 =================
// 需要 5178 开发服务器（跑本分支代码）；假 Ollama 由本脚本自己拉起（端口 11501，带请求计数）。
console.log('【passageVectors：惰性缓存（浏览器 + 假 Ollama）】');

const BASE = 'http://127.0.0.1:5178';
const MOCK = 'http://127.0.0.1:11501';
const devUp = await fetch(BASE + '/').then((r) => r.ok).catch(() => false);
if (!devUp) {
  check('开发服务器在 5178 运行', false, '先 npm run dev（且必须跑本分支代码）');
} else {
  const mock = spawn('node', ['scripts/mock-ollama.mjs', '11501'], { stdio: 'ignore' });
  try {
    let mockUp = false;
    for (let i = 0; i < 30 && !mockUp; i++) {
      mockUp = await fetch(MOCK + '/__stats').then((r) => r.ok).catch(() => false);
      if (!mockUp) await new Promise((r) => setTimeout(r, 100));
    }
    check('假 Ollama 启动（带 /__stats 计数）', mockUp, MOCK);

    if (mockUp) {
      const { launchIsolated, gotoApp } = await import('./lib/browser.mjs');
      const context = await launchIsolated(import.meta.url, { viewport: { width: 1280, height: 900 } });
      try {
        const page = context.pages()[0] ?? (await context.newPage());
        const pageErrs = [];
        page.on('pageerror', (e) => pageErrs.push(String(e.message).slice(0, 160)));
        await gotoApp(page, BASE + '/');

        const out = await page.evaluate(async (mockEndpoint) => {
          const p = await import('/src/db/repo/projects.ts');
          const e = await import('/src/ai/embedding.ts');
          const ai = await import('/src/db/repo/ai.ts');
          const stats = async () => (await fetch(mockEndpoint + '/__stats')).json();
          await fetch(mockEndpoint + '/__reset');
          e.resetEmbeddingBreaker();

          const proj = await p.createProject({ title: '向量缓存验收' });
          const cfg = { enabled: true, source: 'ollama', model: 'nomic-embed-text', endpoint: mockEndpoint, topK: 8 };
          const items = [
            { id: 'ch1:0', text: '沈砚推开门，看见桌上放着一封没有署名的信。' },
            { id: 'ch1:1', text: '暴雨在午夜停了，街道的积水映着霓虹倒影。' },
            { id: 'ch2:0', text: '她把怀表塞进大衣口袋，转身走进夜雾里。' },
          ];

          const s0 = (await stats()).embedCalls;
          const first = await e.passageVectors(proj.id, items, cfg);
          const s1 = (await stats()).embedCalls;
          const second = await e.passageVectors(proj.id, items, cfg);
          const s2 = (await stats()).embedCalls;
          const rows1 = await ai.listEmbeddings(proj.id, 'passage');

          const changed = [items[0], items[1], { id: 'ch2:0', text: '她把怀表塞进大衣口袋，转身走进夜雾里，而怀表仍在走动。' }];
          const third = await e.passageVectors(proj.id, changed, cfg);
          const rows3 = await ai.listEmbeddings(proj.id, 'passage');

          const sBeforeOff = (await stats()).embedCalls;
          const off = await e.passageVectors(proj.id, items, { ...cfg, enabled: false });
          const s3 = (await stats()).embedCalls;

          e.resetEmbeddingBreaker();
          let dead;
          try {
            const r = await e.passageVectors(
              proj.id,
              [{ id: 'x:0', text: '端点不通时应当静默返回空向量表，不许抛错。' }],
              { ...cfg, endpoint: 'http://127.0.0.1:9/api/embeddings' },
            );
            dead = { threw: null, size: r.vectors.size, computed: r.computed };
          } catch (err) {
            dead = { threw: String(err), size: -1, computed: -1 };
          }

          return {
            first: { size: first.vectors.size, cached: first.cached, computed: first.computed },
            second: { size: second.vectors.size, cached: second.cached, computed: second.computed },
            third: { size: third.vectors.size, cached: third.cached, computed: third.computed },
            off: { size: off.vectors.size, cached: off.cached, computed: off.computed },
            rows1: rows1.map((r) => ({ refId: r.refId, model: r.model, text: r.text, dim: r.vector.length })),
            rows3Count: rows3.length,
            ch2text: (rows3.find((r) => r.refId === 'ch2:0') ?? {}).text ?? '',
            net: { s0, s1, s2, sBeforeOff, s3 },
            dead,
          };
        }, MOCK);

        check('首次调用全量现算', out.first.computed === 3 && out.first.cached === 0 && out.first.size === 3, JSON.stringify(out.first));
        check('首次调用走了 3 次网络请求', out.net.s1 - out.net.s0 === 3, `${out.net.s0} → ${out.net.s1}`);
        check('向量写入 embeddings 表（kind=passage）', out.rows1.length === 3 && out.rows1.every((r) => r.model === 'nomic-embed-text' && r.dim === 768 && r.text.length > 0), JSON.stringify(out.rows1.map((r) => r.refId)));
        check('二次调用全命中缓存', out.second.cached === 3 && out.second.computed === 0 && out.second.size === 3, JSON.stringify(out.second));
        check('二次调用零网络请求', out.net.s2 === out.net.s1, `${out.net.s1} → ${out.net.s2}`);
        check('文本变化只重算那一条', out.third.computed === 1 && out.third.cached === 2, JSON.stringify(out.third));
        check('旧行按 id 覆盖、不留垃圾', out.rows3Count === 3 && out.ch2text.includes('仍在走动'), `rows=${out.rows3Count}`);
        check('开关关闭立即返回空、零请求', out.off.size === 0 && out.net.s3 === out.net.sBeforeOff, JSON.stringify(out.off) + ` ${out.net.sBeforeOff} → ${out.net.s3}`);
        check('端点不通：空结果且不抛错', out.dead.threw === null && out.dead.size === 0 && out.dead.computed === 0, JSON.stringify(out.dead));
        check('验收过程无页面错误', pageErrs.length === 0, pageErrs.join(' | '));
      } finally {
        await context.close();
      }
    }
  } finally {
    mock.kill();
  }
}

// ================= T3 验收：全板块语义重排 =================
// 关（规则序 + 零网络）→ 开（四板块按余弦重排）→ 再开（全缓存、零网络、输出一致）。
// 期望顺序不复述实现：直接拿假服务的向量在测试里独立算余弦复算。
console.log('【buildContext：全板块语义重排（关 → 开 → 再开）】');
if (!devUp) {
  check('开发服务器在 5178 运行（T3）', false, '先 npm run dev');
} else {
  const mock3 = spawn('node', ['scripts/mock-ollama.mjs', '11501'], { stdio: 'ignore' });
  try {
    let mock3Up = false;
    for (let i = 0; i < 30 && !mock3Up; i++) {
      mock3Up = await fetch(MOCK + '/__stats').then((r) => r.ok).catch(() => false);
      if (!mock3Up) await new Promise((r) => setTimeout(r, 100));
    }
    check('假 Ollama 启动（T3）', mock3Up, MOCK);

    if (mock3Up) {
      const { launchIsolated, gotoApp } = await import('./lib/browser.mjs');
      const context3 = await launchIsolated(import.meta.url, { viewport: { width: 1280, height: 900 } });
      try {
        const page = context3.pages()[0] ?? (await context3.newPage());
        const pageErrs3 = [];
        page.on('pageerror', (e) => pageErrs3.push(String(e.message).slice(0, 160)));
        await gotoApp(page, BASE + '/');

        const out = await page.evaluate(async (mockEndpoint) => {
          const p = await import('/src/db/repo/projects.ts');
          const o = await import('/src/db/repo/outline.ts');
          const c = await import('/src/db/repo/cast.ts');
          const w = await import('/src/db/repo/world.ts');
          const st = await import('/src/db/repo/story.ts');
          const set = await import('/src/db/repo/settings.ts');
          const ctx = await import('/src/ai/context.ts');
          const emb = await import('/src/ai/embedding.ts');
          const dbm = await import('/src/db/database.ts');

          const stats = async () => (await fetch(mockEndpoint + '/__stats')).json();
          await fetch(mockEndpoint + '/__reset');
          emb.resetEmbeddingBreaker();

          const SHARED = '雾港的钟声在午夜回荡';
          const QUERY = SHARED + '，主角在钟楼下想起旧案';

          const proj = await p.createProject({ title: '语义重排验收' });
          const ch = await o.createChapter(proj.id, { title: '第一章 雾港' });
          const proto = await c.createCharacter(proj.id, { name: '主角沈砚', role: 'protagonist', tagline: SHARED + '的见证者' });
          const s1 = await c.createCharacter(proj.id, { name: '配角甲长者', role: 'mentor', tagline: SHARED + '的守灯人', personality: '沉默' });
          const s2 = await c.createCharacter(proj.id, { name: '配角乙行商', role: 'mentor', tagline: QUERY + '，走街串巷', personality: '油滑' });
          await dbm.db.chapters.update(ch.id, { characterIds: [proto.id], locationIds: [], summary: '' });

          const w1 = await w.upsertWorldEntry(proj.id, { title: '雾港钟楼', category: 'location', body: SHARED + '，钟楼是坐标', importance: 5 });
          const w2 = await w.upsertWorldEntry(proj.id, { title: '银鹭商会', category: 'faction', body: SHARED + '的商会账本记录了码头每一笔暗账往来', importance: 4 });
          const w3 = await w.upsertWorldEntry(proj.id, { title: '黑帆船队', category: 'faction', body: SHARED + '的船队', importance: 4 });
          await w.upsertWorldEntry(proj.id, { title: '陈年传说', category: 'lore', body: SHARED + '，那是与主线无关的陈年传说', importance: 1 });
          await dbm.db.chapters.update(ch.id, { locationIds: [w1.id] });

          const t1 = await st.upsertThread(proj.id, { title: '伏笔钟声起源', description: SHARED + '的来历', status: 'planted', plannedPayoffChapterId: ch.id });
          const t2 = await st.upsertThread(proj.id, { title: '伏笔商会内鬼', description: SHARED + '的内鬼名单，牵连三家商号与两条街的暗线', status: 'planted' });
          const t3 = await st.upsertThread(proj.id, { title: '伏笔船队图纸', description: SHARED + '的图纸', status: 'planted' });

          const e1 = await st.upsertTimelineEvent(proj.id, { title: '事件初见钟楼', chapterIds: [ch.id], description: SHARED });
          const e2 = await st.upsertTimelineEvent(proj.id, { title: '事件商会夜谈', description: SHARED + '的夜谈记录，三方各怀心思' });
          const e3 = await st.upsertTimelineEvent(proj.id, { title: '事件船队离港', description: SHARED + '离港' });

          const SECTIONS = ['characters', 'world', 'threads', 'timeline'];
          const build = () => ctx.buildContext({ projectId: proj.id, chapterId: ch.id, sections: SECTIONS, query: QUERY });

          const blockOf = (text, header) => {
            const i = text.indexOf('## ' + header);
            if (i < 0) return '';
            const j = text.indexOf('\n## ', i + 1);
            return text.slice(i, j < 0 ? undefined : j);
          };
          const orderIn = (block, titles) => titles.filter((t) => block.includes(t)).sort((a, b) => block.indexOf(a) - block.indexOf(b));
          const othersOf = (text) => blockOf(text, '伏笔与支线').split('【进行中伏笔】')[1] ?? '';

          // ---- 第一段：开关关 ----
          await set.saveSettings({ ...set.loadSettings(), semanticRecall: { enabled: false, source: 'ollama', model: 'nomic-embed-text', endpoint: mockEndpoint, topK: 8 } });
          const sOff0 = (await stats()).embedCalls;
          const off1 = await build();
          const off2 = await build();
          const sOff = (await stats()).embedCalls;

          // ---- 第二段：开关开 ----
          await set.saveSettings({ ...set.loadSettings(), semanticRecall: { enabled: true, source: 'ollama', model: 'nomic-embed-text', endpoint: mockEndpoint, topK: 8 } });
          emb.resetEmbeddingBreaker();
          const sOn0 = (await stats()).embedCalls;
          const on1 = await build();
          const sOn1 = (await stats()).embedCalls;
          const on2 = await build();
          const sOn2 = (await stats()).embedCalls;

          const grab = (text) => ({
            support: orderIn(blockOf(text, '人物设定（配角）'), [s1.name, s2.name]),
            hot: orderIn(blockOf(text, '世界观设定（相关条目）'), [w1.title, w2.title, w3.title]),
            cold: orderIn(blockOf(text, '世界观设定（其他条目索引）'), ['陈年传说']),
            due: blockOf(text, '伏笔与支线').includes(t1.title),
            others: orderIn(othersOf(text), [t2.title, t3.title]),
            timeline: orderIn(blockOf(text, '时间线'), [e1.title, e2.title, e3.title]),
            supportAll: orderIn(blockOf(text, '人物设定（配角）'), [s1.name, s2.name, proto.name]),
            hotAll: orderIn(blockOf(text, '世界观设定（相关条目）'), [w1.title, w2.title, w3.title, '陈年传说']),
            othersAll: orderIn(othersOf(text), [t1.title, t2.title, t3.title]),
            timelineAll: orderIn(blockOf(text, '时间线'), [e1.title, e2.title, e3.title]),
          });
          const offGrab = grab(off1.text);

          // ---- 独立复算期望顺序 ----
          // 候选序 = 关态输出（即"规则选候选"的结果，含 Dexie 表序），
          // 再问假服务拿向量算余弦做稳定排序（即"语义重排"）。
          // 不复述 context.ts 里的选取规则，避免测试和实现各写一套。
          const embed = async (text) => {
            const r = await fetch(mockEndpoint + '/api/embeddings', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ model: 'nomic-embed-text', prompt: text }),
            });
            return (await r.json()).embedding;
          };
          const cosine = (a, b) => {
            let d = 0, na = 0, nb = 0;
            for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
            return d / (Math.sqrt(na) * Math.sqrt(nb));
          };
          const qv = await embed(QUERY);
          const rankTitles = async (titles, textOf) => {
            const scored = [];
            for (const t of titles) scored.push({ t, s: cosine(qv, await embed(textOf(t))) });
            return scored.filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.t);
          };
          const charByName = { [s1.name]: s1, [s2.name]: s2 };
          const worldByTitle = { [w1.title]: w1, [w2.title]: w2, [w3.title]: w3, ['陈年传说']: { title: '陈年传说', body: SHARED + '，那是与主线无关的陈年传说', aliases: [] } };
          const threadByTitle = { [t1.title]: t1, [t2.title]: t2, [t3.title]: t3 };
          const eventByTitle = { [e1.title]: e1, [e2.title]: e2, [e3.title]: e3 };

          const expSupport = await rankTitles(offGrab.support, (n) => ctx.VEC_TEXT.character(charByName[n]));
          const hotHard = offGrab.hot.filter((t) => t === w1.title);
          const hotSoft = offGrab.hot.filter((t) => t !== w1.title);
          const expHot = [...hotHard, ...(await rankTitles(hotSoft, (t) => ctx.VEC_TEXT.world(worldByTitle[t])))];
          const expOthers = await rankTitles(offGrab.others, (t) => ctx.VEC_TEXT.thread(threadByTitle[t]));
          const tlHard = offGrab.timeline.filter((t) => t === e1.title);
          const tlSoft = offGrab.timeline.filter((t) => t !== e1.title);
          const expTimeline = [...tlHard, ...(await rankTitles(tlSoft, (t) => ctx.VEC_TEXT.event(eventByTitle[t])))];

          return {
            off: { ...offGrab, deterministic: off1.text === off2.text, net: sOff - sOff0 },
            on: { ...grab(on1.text), sameAsSecond: on1.text === on2.text, net1: sOn1 - sOn0, net2: sOn2 - sOn1 },
            exp: { support: expSupport, hot: expHot, others: expOthers, timeline: expTimeline },
          };
        }, MOCK);

        check('关：零网络请求', out.off.net === 0, `net=${out.off.net}`);
        check('关：两次输出逐字节一致', out.off.deterministic);
        // 关态 = 纯规则路径：只断言成员齐全（顺序是 Dexie 表序，不可硬编码）
        check('关：配角全员在场', out.off.supportAll.length === 2, out.off.supportAll.join(','));
        check('关：世界 hot 全员在场', out.off.hotAll.length === 3, out.off.hotAll.join(','));
        check('关：伏笔 others 全员在场', out.off.othersAll.length === 2, out.off.othersAll.join(','));
        check('关：时间线全员在场', out.off.timelineAll.length === 3, out.off.timelineAll.join(','));
        check('关：计划回收伏笔在场', out.off.due === true);

        check('开：四板块请求向量（query1+配角2+世界4+伏笔2+事件2=11）', out.on.net1 === 11, `net1=${out.on.net1}`);
        // 防"两边都为空导致相等"的空转通过：先断言实际与期望都非空
        check('开：各板块结果与期望均非空', [out.on.support, out.on.hot, out.on.others, out.on.timeline, out.exp.support, out.exp.hot, out.exp.others, out.exp.timeline].every((a) => a.length > 0), JSON.stringify({ on: [out.on.support.length, out.on.hot.length, out.on.others.length, out.on.timeline.length], exp: [out.exp.support.length, out.exp.hot.length, out.exp.others.length, out.exp.timeline.length] }));
        check('开：配角 = 独立复算的余弦序', out.on.support.join(',') === out.exp.support.join(','), `${out.on.support.join(',')} vs ${out.exp.support.join(',')}`);
        check('开：世界 hot = 硬成员 + 余弦序', out.on.hot.join(',') === out.exp.hot.join(','), `${out.on.hot.join(',')} vs ${out.exp.hot.join(',')}`);
        check('开：冷索引含被挤出条目', out.on.cold.includes('陈年传说'), out.on.cold.join(','));
        check('开：伏笔 others = 余弦序', out.on.others.join(',') === out.exp.others.join(','), `${out.on.others.join(',')} vs ${out.exp.others.join(',')}`);
        check('开：时间线 = 硬成员 + 余弦序', out.on.timeline.join(',') === out.exp.timeline.join(','), `${out.on.timeline.join(',')} vs ${out.exp.timeline.join(',')}`);
        check('再开：全缓存零网络', out.on.net2 === 0, `net2=${out.on.net2}`);
        check('再开：输出一致', out.on.sameAsSecond);
        check('T3 验收无页面错误', pageErrs3.length === 0, pageErrs3.join(' | '));
      } finally {
        await context3.close();
      }
    }
  } finally {
    mock3.kill();
  }
}

// ================= T4 验收：retrieval 向量优先、BM25 兜底 =================
console.log('【buildContext：retrieval 双路（向量 → BM25 兜底）】');
if (!devUp) {
  check('开发服务器在 5178 运行（T4）', false, '先 npm run dev');
} else {
  const mock4 = spawn('node', ['scripts/mock-ollama.mjs', '11501'], { stdio: 'ignore' });
  try {
    let mock4Up = false;
    for (let i = 0; i < 30 && !mock4Up; i++) {
      mock4Up = await fetch(MOCK + '/__stats').then((r) => r.ok).catch(() => false);
      if (!mock4Up) await new Promise((r) => setTimeout(r, 100));
    }
    check('假 Ollama 启动（T4）', mock4Up, MOCK);

    if (mock4Up) {
      const { launchIsolated, gotoApp } = await import('./lib/browser.mjs');
      const context4 = await launchIsolated(import.meta.url, { viewport: { width: 1280, height: 900 } });
      try {
        const page = context4.pages()[0] ?? (await context4.newPage());
        const pageErrs4 = [];
        page.on('pageerror', (e) => pageErrs4.push(String(e.message).slice(0, 160)));
        await gotoApp(page, BASE + '/');

        const out = await page.evaluate(async (mockEndpoint) => {
          const p = await import('/src/db/repo/projects.ts');
          const o = await import('/src/db/repo/outline.ts');
          const set = await import('/src/db/repo/settings.ts');
          const ctx = await import('/src/ai/context.ts');
          const rec = await import('/src/ai/recall.ts');
          const emb = await import('/src/ai/embedding.ts');
          const dbm = await import('/src/db/database.ts');

          const stats = async () => (await fetch(mockEndpoint + '/__stats')).json();
          await fetch(mockEndpoint + '/__reset');
          emb.resetEmbeddingBreaker();

          const SHARED = '雾港的钟声在午夜回荡';
          const QUERY = SHARED + '，怀表停在十一点';
          const proj = await p.createProject({ title: '检索双路验收' });
          const ch1 = await o.createChapter(proj.id, { title: '第一章 灯塔' });
          const ch2 = await o.createChapter(proj.id, { title: '第二章 账房' });
          const ch3 = await o.createChapter(proj.id, { title: '第三章 码头' });
          const now = new Date().toISOString();
          const put = (chapterId, text) =>
            dbm.db.chapterContents.put({ chapterId, projectId: proj.id, html: '<p></p>', text, updatedAt: now, rev: 1 });
          await put(ch1.id, [
            SHARED + '，守灯人把怀表放在窗台上，表针迟迟不动。',
            '这一段只写灯塔的风，与查询词没有直接关系。',
            SHARED + '的夜里，灯塔的光扫过海面如同刀锋。',
          ].join('\n'));
          await put(ch2.id, [
            SHARED + '，账房先生核对着商会的每一笔暗账。',
            '账本的霉味混着灯油味，熏得人睁不开眼。',
            SHARED + '，而那枚怀表正是账房的信物。',
          ].join('\n'));
          await put(ch3.id, SHARED + '，主角在码头整理行装，准备连夜离港。');

          await set.saveSettings({ ...set.loadSettings(), semanticRecall: { enabled: true, source: 'ollama', model: 'nomic-embed-text', endpoint: mockEndpoint, topK: 8 } });
          emb.resetEmbeddingBreaker();

          const build = () => ctx.buildContext({ projectId: proj.id, chapterId: ch3.id, sections: ['retrieval'], query: QUERY, recall: 2 });

          // ---- 向量路径 ----
          const s0 = (await stats()).embedCalls;
          const vec1 = await build();
          const s1 = (await stats()).embedCalls;
          const vec2 = await build();
          const s2 = (await stats()).embedCalls;

          // 独立复算：分片 + 假服务向量 + 余弦 top-2
          const embed = async (text) => {
            const r = await fetch(mockEndpoint + '/api/embeddings', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ model: 'nomic-embed-text', prompt: text }),
            });
            return (await r.json()).embedding;
          };
          const cosine = (a, b) => {
            let d = 0, na = 0, nb = 0;
            for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
            return d / (Math.sqrt(na) * Math.sqrt(nb));
          };
          const qv = await embed(QUERY);
          const chunks = [];
          for (const ch of [ch1, ch2]) {
            const content = await dbm.db.chapterContents.get(ch.id);
            for (const sp of rec.splitPassages(ch.id, content.text)) chunks.push({ ...sp, chapter: ch });
          }
          const scored = [];
          for (const c of chunks) scored.push({ c, s: cosine(qv, await embed(c.text)) });
          const expTop = scored.filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 2).map((x) => x.c.chapter.title);

          const vecTitles = [...vec1.text.matchAll(/- （第\d+章 ([^）]+)）/g)].map((m) => m[1]);

          // ---- BM25 兜底：开关关 ----
          await set.saveSettings({ ...set.loadSettings(), semanticRecall: { enabled: false, source: 'ollama', model: 'nomic-embed-text', endpoint: mockEndpoint, topK: 8 } });
          const sB0 = (await stats()).embedCalls;
          const bm25 = await build();
          const sB = (await stats()).embedCalls;

          // ---- BM25 兜底：开关开但端点不通 ----
          await set.saveSettings({ ...set.loadSettings(), semanticRecall: { enabled: true, source: 'ollama', model: 'nomic-embed-text', endpoint: 'http://127.0.0.1:9/api/embeddings', topK: 8 } });
          emb.resetEmbeddingBreaker();
          const dead = await build();

          return {
            vec: {
              lines: vec1.text.split('\n').filter((l) => l.startsWith('- （第')),
              titles: vecTitles,
              net1: s1 - s0,
              net2: s2 - s1,
              same: vec1.text === vec2.text,
              chunkCount: chunks.length,
            },
            expTop,
            bm25: { lines: bm25.text.split('\n').filter((l) => l.startsWith('- （第')), net: sB - sB0 },
            dead: { lines: dead.text.split('\n').filter((l) => l.startsWith('- （第')) },
          };
        }, MOCK);

        check('向量路径：首次 = query1 + 分片N 次请求', out.vec.net1 === 1 + out.vec.chunkCount, `net1=${out.vec.net1} chunks=${out.vec.chunkCount}`);
        check('向量路径：输出格式与 BM25 一致（第N章 章名）', out.vec.lines.length > 0 && out.vec.lines.every((l) => /^- （第\d+章 .+）/.test(l)), out.vec.lines[0] ?? 'EMPTY');
        check('向量路径：top-k = 独立复算的余弦序', out.vec.titles.join(',') === out.expTop.join(','), `${out.vec.titles.join(',')} vs ${out.expTop.join(',')}`);
        check('向量路径：二次全缓存零网络', out.vec.net2 === 0, `net2=${out.vec.net2}`);
        check('向量路径：二次输出一致', out.vec.same);
        check('BM25 兜底（开关关）：零网络且有结果', out.bm25.net === 0 && out.bm25.lines.length > 0, `net=${out.bm25.net} lines=${out.bm25.lines.length}`);
        check('BM25 兜底（开关关）：命中含查询词的段落', out.bm25.lines.some((l) => l.includes('怀表')), JSON.stringify(out.bm25.lines));
        check('BM25 兜底（端点不通）：降级不空、不抛错', out.dead.lines.length > 0, JSON.stringify(out.dead.lines));
        check('T4 验收无页面错误', pageErrs4.length === 0, pageErrs4.join(' | '));
      } finally {
        await context4.close();
      }
    }
  } finally {
    mock4.kill();
  }
}

console.log('');
console.log(`结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
