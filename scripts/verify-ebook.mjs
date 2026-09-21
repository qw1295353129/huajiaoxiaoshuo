/**
 * 验证 EPUB 3 与 DOCX(OOXML) 生成结果的格式合法性。
 * 用 Python 的 zipfile + ElementTree 做规范级校验（等价于 epubcheck / Word 的解析路径）。
 */
import { createServer } from 'vite';
import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const ebook = await vite.ssrLoadModule('/src/features/data/ebook.ts');

const now = new Date().toISOString();
const project = {
  id: 'prj_test',
  title: '雾港纪事',
  subtitle: '',
  author: '测试作者',
  logline: '一个能听见死者遗言的验尸官。',
  synopsis: '',
  genres: ['悬疑'],
  tags: [],
  themes: ['记忆'],
  pov: 'third-limited',
  tense: 'past',
  targetWords: 100000,
  targetChapterWords: 3000,
  lengthClass: 'novel',
  status: 'drafting',
  forbidden: [],
  language: 'zh-CN',
  stats: { words: 0, chapters: 0, scenes: 0, writingDays: 0 },
  createdAt: now,
  updatedAt: now,
};

const mk = (order, title, arcId, text) => ({
  chapter: {
    id: 'chp_' + order,
    projectId: 'prj_test',
    arcId,
    title,
    summary: '本章梗概：' + title,
    goals: [],
    characterIds: [],
    locationIds: [],
    order,
    status: 'drafted',
    wordCount: text.length,
    tension: 0,
    plantsThreadIds: [],
    paysThreadIds: [],
    beats: [],
    tags: [],
    createdAt: now,
    updatedAt: now,
  },
  text,
});

const chapters = [
  mk(0, '第一章 第三具尸体', 'arc_1', '雨下了整夜。\n沈砚掀开白布的时候，死者张了张嘴。\n「你来了。」他说。'),
  mk(1, '第二章 旧档案', 'arc_1', '档案室的灯坏了。\n他在十二年前的卷宗里看到相同的伤口。'),
  mk(2, '第三章 铜钟', 'arc_2', '铜钟在没有风的时候响了一下。'),
];

mkdirSync('/tmp/nf-ebook', { recursive: true });

const epub = await ebook.buildEpub({
  project,
  chapters,
  arcNames: { arc_1: '第一卷 · 溺水的钟', arc_2: '第二卷 · 无风之钟' },
});
writeFileSync('/tmp/nf-ebook/book.epub', Buffer.from(await epub.arrayBuffer()));

const docx = await ebook.buildDocx({
  project,
  chapters,
  arcNames: { arc_1: '第一卷 · 溺水的钟', arc_2: '第二卷 · 无风之钟' },
});
writeFileSync('/tmp/nf-ebook/book.docx', Buffer.from(await docx.arrayBuffer()));

console.log('EPUB 大小: ' + (await epub.arrayBuffer()).byteLength + ' bytes');
console.log('DOCX 大小: ' + (await docx.arrayBuffer()).byteLength + ' bytes');

const out = execFileSync('python3', ['/tmp/nf-verify-ebook.py'], { encoding: 'utf8' });
const parsed = JSON.parse(out.slice(out.indexOf('{')));
const e = parsed.epub;
const d = parsed.docx;
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
check('EPUB 包无损坏条目', e.testzip === null, String(e.testzip));
check('EPUB mimetype 在首位且不压缩', e.first_entry === 'mimetype' && e.mimetype_ok === true);
check('EPUB spine 全部在 manifest 中', e.spine_all_in_manifest === true);
check('EPUB 含导航文档（nav）', e.has_nav === true);
check('EPUB 所有 XML 良构', Array.isArray(e.xml_errors) && e.xml_errors.length === 0, JSON.stringify(e.xml_errors));
check('EPUB 章节文档数量正确', Array.isArray(e.chapter_files) && e.chapter_files.length === 3, JSON.stringify(e.chapter_files));
check('EPUB 元数据（书名/作者）', Boolean(e.dc_title) && Boolean(e.dc_creator), String(e.dc_title));

check('DOCX 包无损坏条目', d.testzip === null, String(d.testzip));
check('DOCX 必需部件齐全', d.required_present === true);
check('DOCX 所有 XML 良构', Array.isArray(d.xml_errors) && d.xml_errors.length === 0, JSON.stringify(d.xml_errors));
check('DOCX 内容类型覆盖主要部件', d.overrides.includes('/word/document.xml') && d.overrides.includes('/word/styles.xml'));
check('DOCX 含章节分页符', d.has_page_break === true);
check('DOCX 中文首行缩进 2 字符', d.first_line_indent === true);

console.log('');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
await vite.close();
process.exit(fail === 0 ? 0 : 1);

await vite.close();