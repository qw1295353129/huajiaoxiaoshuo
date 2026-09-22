import { readFileSync, writeFileSync } from 'node:fs';
const p = 'src/features/editor/EditorPage.tsx';
let s = readFileSync(p, 'utf8');
const NL = String.fromCharCode(10);
// 在两处 saveChapterContent 调用前打栈
const marks = [
  ['        await saveChapterContent(prevOwner, prev.html);', 'flush'],
  ['      const res = await saveChapterContent(cid, html);', 'doSave'],
];
for (const [call, tag] of marks) {
  if (!s.includes(call)) { console.log('未找到: ' + tag); continue; }
  if (s.includes('console.trace("[T] ' + tag)) continue;
  s = s.replace(call, '      console.trace("[T] ' + tag + ' htmlLen=" + ' + (tag === 'flush' ? 'prev.html.length' : 'html.length') + ');' + NL + call);
}
writeFileSync(p, s);
console.log('已插入 console.trace');
