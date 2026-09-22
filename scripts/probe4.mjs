import { readFileSync, writeFileSync } from 'node:fs';
const p = 'src/features/editor/EditorPage.tsx';
let s = readFileSync(p, 'utf8');
const NL = String.fromCharCode(10);
const add = (anchor, line) => {
  if (s.includes(line)) return;
  if (!s.includes(anchor)) throw new Error('锚点未找到: ' + anchor.slice(0, 50));
  s = s.replace(anchor, anchor + NL + line);
};
add('      if (!ownerChapterId) return;', '      console.log("[S] onChange owner=" + ownerChapterId.slice(-6) + " len=" + html.length);');
add('      if (!cid) return;', '      console.log("[S] save target=" + String(targetChapterId).slice(-6) + " owner=" + String(ownerId).slice(-6) + " len=" + html.length + " dirty=" + state.dirty);');
add('      const prevOwner = prev.chapterId;', '      console.log("[S] flush prev=" + String(prevOwner).slice(-6) + " len=" + prev.html.length + " → target=" + target.id.slice(-6));');
writeFileSync(p, s);
console.log('探针已插入');
