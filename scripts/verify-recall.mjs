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
  const cands = ['mid', 'novec', 'exact', 'neg', 'weak'];
  const r = rerankBySimilarity(cands, vectors, query);
  check('按相似度降序', r.applied && r.ids.join(',') === 'exact,mid,weak', r.ids.join(','));
  check('score<=0 与缺向量被剔除', !r.ids.includes('neg') && !r.ids.includes('novec'));
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

  const noPos = rerankBySimilarity(['neg', 'novec'], vectors, query);
  check('没有相似度为正 → 回退规则序（内容不被清空）', !noPos.applied && noPos.ids.join(',') === 'neg,novec');

  const allHard = rerankBySimilarity(['h1', 'h2'], vectors, query, { hardIds: ['h1', 'h2'] });
  check('没有非硬候选 → applied=false', !allHard.applied);

  const empty = rerankBySimilarity([], vectors, query);
  check('空候选 → applied=false、空结果', !empty.applied && empty.ids.length === 0);

  const zeroVec = new Map([['z', [0, 0]]]);
  const z = rerankBySimilarity(['z'], zeroVec, query);
  check('零向量 cos=0 → 回退规则序', !z.applied && z.ids.join(',') === 'z');
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

console.log('');
console.log(`结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
