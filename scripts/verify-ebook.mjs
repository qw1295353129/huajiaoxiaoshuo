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
console.log(out);

await vite.close();