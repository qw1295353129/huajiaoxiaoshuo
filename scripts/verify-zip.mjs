/**
 * 验证 ZIP 写入器产出的文件能被系统 unzip 正确解压。
 * 用法：node scripts/verify-zip.mjs
 */
import { createServer } from 'vite';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const zip = await vite.ssrLoadModule('/src/features/data/zip.ts');

/** 独立的 CRC-32 实现，用来交叉验证 ZIP 里写入的 CRC */
const crc32Of = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return (bytes) => {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
})();

const blob = await zip.createZip([
  { path: 'mimetype', text: 'application/epub+zip', compress: false },
  { path: 'META-INF/container.xml', text: '<?xml version="1.0"?><container/>' },
  { path: 'OEBPS/chapter1.xhtml', text: '<html><body><p>' + '中文正文'.repeat(200) + '</p></body></html>' },
  { path: 'OEBPS/中文文件名.xhtml', text: '<html>UTF-8 文件名测试</html>' },
]);

mkdirSync('/tmp/nf-zip', { recursive: true });
const buf = Buffer.from(await blob.arrayBuffer());
writeFileSync('/tmp/nf-zip/test.epub', buf);
console.log('生成文件大小:', buf.length, 'bytes');

let ok = 0;
let fail = 0;
const check = (name, cond, extra) => {
  if (cond) { ok += 1; console.log('  \u2713 ' + name); }
  else { fail += 1; console.log('  \u2717 ' + name + (extra ? '  \u2192 ' + extra : '')); }
};

// 0) 逐字段 dump 本地头，核对 CRC / 压缩前后长度是否自洽
const rawBuf = readFileSync('/tmp/nf-zip/test.epub');
let p = 0;
const dump = [];
while (p + 30 <= rawBuf.length && rawBuf.readUInt32LE(p) === 0x04034b50) {
  const flags = rawBuf.readUInt16LE(p + 6);
  const method = rawBuf.readUInt16LE(p + 8);
  const crc = rawBuf.readUInt32LE(p + 14);
  const compSize = rawBuf.readUInt32LE(p + 18);
  const rawSize = rawBuf.readUInt32LE(p + 22);
  const nameLen = rawBuf.readUInt16LE(p + 26);
  const extraLen = rawBuf.readUInt16LE(p + 28);
  const name = rawBuf.subarray(p + 30, p + 30 + nameLen).toString('utf8');
  const dataStart = p + 30 + nameLen + extraLen;
  const data = rawBuf.subarray(dataStart, dataStart + compSize);
  dump.push({
    name,
    method,
    crc: crc.toString(16),
    actual: crc32Of(data).toString(16),
    compSize,
    rawSize,
    flags: flags.toString(16),
  });
  p = dataStart + compSize;
}
console.log('本地头逐条:');
for (const d of dump) {
  console.log('  ' + d.name + '  method=' + d.method + '  头内CRC=' + d.crc + '  实算CRC=' + d.actual + '  comp=' + d.compSize + ' raw=' + d.rawSize + ' flags=' + d.flags);
}
check(
  '压缩条目的未压缩大小正确声明',
  dump.every((d) => (d.method === 0 ? d.rawSize === d.compSize : d.rawSize > d.compSize)),
  JSON.stringify(dump.map((d) => d.name + ' raw=' + d.rawSize + ' comp=' + d.compSize)),
);

// 0.1) 中央目录里的 CRC 必须与本地头一致（读取方主要看中央目录）
const central = [];
let cp = rawBuf.length - 22;
while (cp >= 0 && rawBuf.readUInt32LE(cp) !== 0x06054b50) cp -= 1;
const cdOffset = rawBuf.readUInt32LE(cp + 16);
let q = cdOffset;
while (q + 46 <= rawBuf.length && rawBuf.readUInt32LE(q) === 0x02014b50) {
  const crc = rawBuf.readUInt32LE(q + 16);
  const compSize = rawBuf.readUInt32LE(q + 20);
  const rawSize = rawBuf.readUInt32LE(q + 24);
  const nameLen = rawBuf.readUInt16LE(q + 28);
  const extraLen = rawBuf.readUInt16LE(q + 30);
  const commentLen = rawBuf.readUInt16LE(q + 32);
  const name = rawBuf.subarray(q + 46, q + 46 + nameLen).toString('utf8');
  central.push({ name, crc: crc.toString(16), compSize, rawSize });
  q += 46 + nameLen + extraLen + commentLen;
}
console.log('中央目录:', JSON.stringify(central, null, 0));
const localByName = new Map(dump.map((d) => [d.name, d]));
check(
  '中央目录与本地头的 CRC/长度一致',
  central.every((c) => {
    const l = localByName.get(c.name);
    return l && l.crc === c.crc && l.compSize === c.compSize && l.rawSize === c.rawSize;
  }),
  JSON.stringify(central.map((c) => c.name + ':' + c.crc + ' vs ' + (localByName.get(c.name)?.crc ?? 'missing'))),
);

// 1) 用 Python 的 zipfile 做规范级校验（macOS 自带 unzip 不认 UTF-8 标志位，会误判）
const py = [
  'import zipfile, sys, json',
  'z = zipfile.ZipFile("/tmp/nf-zip/test.epub")',
  'bad = z.testzip()',
  'names = z.namelist()',
  'info = z.getinfo("mimetype")',
  'print(json.dumps({',
  '  "bad": bad,',
  '  "names": names,',
  '  "mimetype_compress_type": info.compress_type,',
  '  "first": names[0] if names else None,',
  '  "chapter_ok": ("中文正文" * 200) in z.read("OEBPS/chapter1.xhtml").decode("utf-8"),',
  '  "cn_name_ok": "UTF-8 文件名测试" in z.read("OEBPS/中文文件名.xhtml").decode("utf-8"),',
  '}, ensure_ascii=False))',
].join('\n');
const out = execFileSync('python3', ['-c', py], { encoding: 'utf8' });
const result = JSON.parse(out);
console.log('python zipfile 校验:', JSON.stringify(result, null, 1));
check('ZIP 无损坏条目（testzip 通过）', result.bad === null, String(result.bad));
check('mimetype 是第一个条目', result.first === 'mimetype', String(result.first));
check('mimetype 使用 STORE（0=不压缩）', result.mimetype_compress_type === 0, String(result.mimetype_compress_type));
check('压缩条目内容完整（中文 800 字）', result.chapter_ok === true);
check('UTF-8 文件名正确', result.cn_name_ok === true, JSON.stringify(result.names));

const read = () => { throw new Error('unused'); };
check('嵌套路径条目存在', result.names.includes('META-INF/container.xml'), JSON.stringify(result.names));

// 3) mimetype 必须是第一个条目且不压缩（EPUB 规范硬要求）
const raw = readFileSync('/tmp/nf-zip/test.epub');
const firstNameLen = raw.readUInt16LE(26);
const firstMethod = raw.readUInt16LE(8);
const firstName = raw.subarray(30, 30 + firstNameLen).toString('utf8');
check('mimetype 是第一个条目', firstName === 'mimetype', firstName);
check('mimetype 未被压缩（STORE）', firstMethod === 0, 'method=' + firstMethod);

console.log('');
console.log('通过 ' + ok + ' 项，失败 ' + fail + ' 项');
await vite.close();
process.exit(fail === 0 ? 0 : 1);
