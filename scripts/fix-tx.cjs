// 一次性脚本：把 Dexie 4 的 db.transaction('rw', t1, t2, cb) 改成数组形式
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'src', 'db', 'repo');
let changed = 0;

for (const file of fs.readdirSync(dir)) {
  if (!file.endsWith('.ts')) continue;
  const full = path.join(dir, file);
  const src = fs.readFileSync(full, 'utf8');
  let out = '';
  let i = 0;
  let hits = 0;
  while (i < src.length) {
    const start = src.indexOf("db.transaction('rw', ", i);
    if (start < 0) { out += src.slice(i); break; }
    out += src.slice(i, start);
    const bodyStart = start + "db.transaction('rw', ".length;
    // 找到匹配的 async () => {  之前的表清单
    const cbIdx = src.indexOf('async () => {', bodyStart);
    if (cbIdx < 0) { out += src.slice(start, bodyStart); i = bodyStart; continue; }
    const tables = src.slice(bodyStart, cbIdx).trim().replace(/,\s*$/, '');
    out += "db.transaction('rw', [" + tables + "], async () => {";
    i = cbIdx + 'async () => {'.length;
    hits += 1;
  }
  if (hits > 0) {
    fs.writeFileSync(full, out);
    changed += 1;
    console.log('fixed', file, hits);
  }
}
console.log('files:', changed);
