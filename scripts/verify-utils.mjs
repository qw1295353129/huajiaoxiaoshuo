/**
 * 纯函数快速验证：用 Vite 自己的模块加载器跑真实源码（自动解析 @ 别名与 TS）。
 * 用法：node scripts/verify-utils.mjs
 */
import { createServer } from 'vite';

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const load = (p) => vite.ssrLoadModule('/' + p);

let pass = 0;
let fail = 0;
const check = (name, cond, extra) => {
  if (cond) {
    pass += 1;
    console.log('  \u2713 ' + name);
  } else {
    fail += 1;
    console.log('  \u2717 ' + name + (extra ? '  \u2192 ' + extra : ''));
  }
};

const scan = await load('src/utils/entity-scan.ts');
const textUtils = await load('src/utils/text.ts');
const richText = await load('src/utils/rich-text.ts');
const diffUtils = await load('src/utils/diff.ts');
const tokens = await load('src/utils/tokens.ts');
const json = await load('src/ai/json.ts');

console.log('');
console.log('【变体扫描】');
const names = [
  { name: '青云山', aliases: [] },
  { name: '沈砚', aliases: [] },
  { name: '周砚清', aliases: ['周法医'] },
  { name: '欧阳明月', aliases: [] },
];
const sample =
  '青云山下的雪停了。他望着青云山的方向。青去山的雾还没散。青去山的风很冷。' +
  '沈砚把刀放下。沈研抬起头。沈研没有说话。' +
  '周砚清推开门。周砚青笑了笑。周砚青没有说话。' +
  '案卷上写着欧阳明月。欧阳明日也在名单里。欧阳明日没有签过字。';
const variants = scan.scanNameVariants(sample, names);
const find = (c, v) => variants.find((x) => x.canonical === c && x.variant === v);
const summary = variants.map((v) => v.canonical + '\u2192' + v.variant + '(' + v.count + ')').join(' ');
check('三字名 青云山\u2192青去山 被识别', Boolean(find('青云山', '青去山')), summary);
check('两字名 沈砚\u2192沈研 被识别', Boolean(find('沈砚', '沈研')), summary);
check('三字名 周砚清\u2192周砚青 被识别', Boolean(find('周砚清', '周砚青')), summary);
check('次数统计为 2', find('青云山', '青去山')?.count === 2, String(find('青云山', '青去山')?.count));
check('四字名 欧阳明月\u2192欧阳明日 被识别', Boolean(find('欧阳明月', '欧阳明日')), summary);
check('不会把差两个字的词当成变体', !variants.some((v) => v.variant.length !== v.canonical.length));
check('只出现 1 次的疑似不告警（低于阈值）', !variants.some((v) => v.count < 2));

console.log('【名字命中】');
const hits = scan.scanKnownNames('沈砚走进屋。沈砚看着周砚清。周法医在喝酒。', names);
check('别名归并到规范名（周法医\u2192周砚清）', hits.some((h) => h.name === '周砚清'), JSON.stringify(hits.map((h) => h.name + ':' + h.count)));
check('沈砚出现 2 次', hits.find((h) => h.name === '沈砚')?.count === 2);

console.log('【对话归属】');
const dlg = scan.dialogueStats('\u300c你来了。\u300d沈砚说道。\n\u300c嗯。\u300d周法医答道。', names);
check('识别出说话人', dlg.length > 0 && dlg.some((d) => d.lines >= 1), JSON.stringify(dlg));

console.log('【字数与分章】');
check('中文按字计数（标点不计）', textUtils.countWords('雨下了整夜。') === 5, String(textUtils.countWords('雨下了整夜。')));
check('多字词按字拆开计数（不是按词）', textUtils.countWords('验尸房') === 3, String(textUtils.countWords('验尸房')));
check('中英混排', textUtils.countWords('沈砚 said hello') === 4, String(textUtils.countWords('沈砚 said hello')));
check('分章：中文第X章', textUtils.splitIntoChapters('第一章 雪夜\n正文一\n第二章 旧信\n正文二').length === 2);
check('分章：无标记时整篇一章', textUtils.splitIntoChapters('就是一段普通的话').length === 1);
check('stripHtml 去标签', textUtils.stripHtml('<p>雨下了整夜。</p>') === '雨下了整夜。');

console.log('【实体单次解码（不双重解码）】');
check(
  'stripHtml: &amp;lt; 只解一层 → &lt;，不是 <',
  textUtils.stripHtml('&amp;lt;') === '&lt;',
  JSON.stringify(textUtils.stripHtml('&amp;lt;')),
);
check(
  'stripHtml 往返: escapeHtml("&lt;") 经 stripHtml 仍是 &lt;',
  textUtils.stripHtml(textUtils.escapeHtml('&lt;')) === '&lt;',
  JSON.stringify(textUtils.stripHtml(textUtils.escapeHtml('&lt;'))),
);
check(
  'stripHtml: &amp;amp; 只解一层 → &amp;',
  textUtils.stripHtml('&amp;amp;') === '&amp;',
  JSON.stringify(textUtils.stripHtml('&amp;amp;')),
);
check(
  'docToText: &amp;lt; 只解一层 → &lt;，不是 <',
  richText.docToText('&amp;lt;') === '&lt;',
  JSON.stringify(richText.docToText('&amp;lt;')),
);
check(
  'docToText 往返: textToDoc("&lt;") 经 docToText 仍是 &lt;',
  richText.docToText(richText.textToDoc('&lt;')) === '&lt;',
  JSON.stringify(richText.docToText(richText.textToDoc('&lt;'))),
);

console.log('【textToHtml 转义边界】');
check(
  '纯文本转段落并转义',
  textUtils.textToHtml('雨下了整夜。') === '<p>雨下了整夜。</p>',
  textUtils.textToHtml('雨下了整夜。'),
);
check(
  '子串中的 <p 不透传（整串形如 HTML 才透传）',
  textUtils.textToHtml('他写了 <p>标签</p>').includes('&lt;p&gt;'),
  textUtils.textToHtml('他写了 <p>标签</p>'),
);
check(
  '整串 HTML 文档透传（兼容 importChapters / genesis）',
  textUtils.textToHtml('<p>a</p><p>b</p>') === '<p>a</p><p>b</p>',
  textUtils.textToHtml('<p>a</p><p>b</p>'),
);
check('markdownToHtml 已删除', textUtils.markdownToHtml === undefined, String(textUtils.markdownToHtml));

console.log('【分章保留序言】');
const withPre = textUtils.splitIntoChapters('序言：很久很久以前。\n第一章 雪夜\n正文一\n第二章 旧信\n正文二');
check('首章标记前的序言不再被丢弃', withPre.some((c) => c.content.includes('很久很久以前')), JSON.stringify(withPre));
check('序言并入第一章（章数仍为 2）', withPre.length === 2 && withPre[0].content.startsWith('序言'), JSON.stringify(withPre));
check('第一章标题保留', withPre[0].title.includes('第一章'), withPre[0].title);
check('序言独立成章（无标记章时仍一章）', textUtils.splitIntoChapters('序言文字').length === 1);

console.log('【中文数字】');
check('cnToNumber 逐位年份 二零二五→2025', textUtils.cnToNumber('二零二五') === 2025, String(textUtils.cnToNumber('二零二五')));
check('cnToNumber 百位 一百二十→120', textUtils.cnToNumber('一百二十') === 120, String(textUtils.cnToNumber('一百二十')));
check('cnToNumber 千位 一千零二十四→1024', textUtils.cnToNumber('一千零二十四') === 1024, String(textUtils.cnToNumber('一千零二十四')));
check('cnToNumber 十位 十三→13', textUtils.cnToNumber('十三') === 13, String(textUtils.cnToNumber('十三')));
check('cnToNumber 纯数字', textUtils.cnToNumber('42') === 42, String(textUtils.cnToNumber('42')));
check('cnToNumber 解析失败返回 undefined 而非 0', textUtils.cnToNumber('甲') === undefined, String(textUtils.cnToNumber('甲')));

console.log('【diff 与相似度】');
const d = diffUtils.diffWords('他走进屋子', '他走进那间屋子');
check('diff 识别插入', d.some((op) => op.type === 'insert' && op.text.includes('那间')), JSON.stringify(d));
const en = 'The quick brown fox jumps';
const sameEn = diffUtils.diffWords(en, en);
check(
  'diff 英文含空格往返 ops.join("")===a',
  sameEn.map((op) => op.text).join('') === en,
  JSON.stringify(sameEn),
);
const enA = 'hello world from novelcraft';
const enB = 'hello brave world from anywhere';
const enOps = diffUtils.diffWords(enA, enB);
const rebuiltA = enOps.filter((op) => op.type !== 'insert').map((op) => op.text).join('');
const rebuiltB = enOps.filter((op) => op.type !== 'delete').map((op) => op.text).join('');
check('diff 可无损还原两侧（含空格）', rebuiltA === enA && rebuiltB === enB, JSON.stringify({ rebuiltA, rebuiltB }));
check('相同文本相似度为 1', diffUtils.similarity('沈砚走进验尸房', '沈砚走进验尸房') === 1);
check('不同文本相似度低', diffUtils.similarity('沈砚走进验尸房', '林晚站在码头上') < 0.25);

console.log('【token 估算与预算裁剪】');
const t = tokens.estimateTokens('雨下了整夜。');
check('中文 token 估算在合理区间', t >= 4 && t <= 9, String(t));
const budget = tokens.fillBudget([
  { key: 'a', label: '必选', text: '\u7532'.repeat(100), priority: 0, required: true },
  { key: 'b', label: '次要', text: '\u4e59'.repeat(5000), priority: 5 },
], 300);
check('必选内容保留', budget.parts.some((p) => p.key === 'a'));
check('超预算内容被裁剪或丢弃', budget.parts.some((p) => p.trimmed) || budget.dropped.length > 0);

console.log('【JSON 容错解析】');
const fence = '\u0060\u0060\u0060json\n{"a":1}\n\u0060\u0060\u0060';
check('剥离 Markdown 代码块', json.parseJson(fence).ok);
check('截断 JSON 自动补全', json.parseJson('{"issues":[{"kind":"continuity","title":"x"}').ok);
check('去尾逗号', json.parseJson('{"a":1,}').ok);
const cnQuote = json.parseJson('{“a”：“b”}');
check('中文引号修复', cnQuote.ok && cnQuote.repairs.some((s) => s.includes('标点')), JSON.stringify(cnQuote.repairs));
check('无效输入返回 ok=false', json.parseJson('这不是 JSON').ok === false);
check('asArray 兼容对象包裹', json.asArray({ items: [1, 2] }).length === 2);

console.log('');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
await vite.close();
process.exit(fail === 0 ? 0 : 1);
