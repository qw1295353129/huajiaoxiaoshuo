import { readFileSync, writeFileSync } from 'node:fs';
const p = 'src/features/editor/EditorPage.tsx';
let s = readFileSync(p, 'utf8');
const NL = String.fromCharCode(10);
const anchor = '      const res = await saveChapterContent(cid, html);';
if (!s.includes(anchor)) throw new Error('锚点未找到');
if (!s.includes('[Z]')) {
  s = s.replace(anchor, '      console.log("[Z] doSave cid=" + cid.slice(-6) + " htmlLen=" + html.length + " ready=" + String(loadedReadyRef.current).slice(-6) + " dirty=" + state.dirty);' + NL + anchor);
  writeFileSync(p, s);
}
console.log('探针已插入');
