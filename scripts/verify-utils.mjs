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

console.log('【diff 与相似度】');
const d = diffUtils.diffWords('他走进屋子', '他走进那间屋子');
check('diff 识别插入', d.some((op) => op.type === 'insert' && op.text.includes('那间')), JSON.stringify(d));
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
check('中文引号修复', json.parseJson('{"a": "b"}').ok);
check('无效输入返回 ok=false', json.parseJson('这不是 JSON').ok === false);
check('asArray 兼容对象包裹', json.asArray({ items: [1, 2] }).length === 2);

console.log('');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
await vite.close();
process.exit(fail === 0 ? 0 : 1);
