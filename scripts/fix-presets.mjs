import { readFileSync, writeFileSync } from 'node:fs';
const p = 'src/features/settings/AuthorProfileSettings.tsx';
let s = readFileSync(p, 'utf8');
const start = s.indexOf('const PRINCIPLE_PRESETS = [');
const end = s.indexOf('];', start) + 2;
if (start < 0 || end < 2) {
  console.error('anchor not found');
  process.exit(1);
}
const repl = "const PRINCIPLE_PRESETS = [\n  \"少用形容词，多用具体名词和动词。\",\n  \"对话要有潜台词，不要一问一答交换信息。\",\n  \"每段至少推进一件事，不做纯氛围铺陈。\",\n  \"不写总结句，把判断留给读者。\",\n  \"情绪靠动作和生理反应呈现，不直接命名情绪。\",\n  \"比喻宁缺毋滥，一段最多一个。\",\n];";
s = s.slice(0, start) + repl + s.slice(end);
writeFileSync(p, s);
console.log('fixed presets');
