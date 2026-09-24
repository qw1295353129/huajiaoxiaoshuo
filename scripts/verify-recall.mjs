/**
 * 语义重排纯函数验证：候选重排（硬成员/相似度/降级/limit）与段落分片。
 * 用法：node scripts/verify-recall.mjs
 */
import { createServer } from 'vite';

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
console.log('');
console.log(`结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
