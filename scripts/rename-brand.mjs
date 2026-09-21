/**
 * 品牌更名：墨枢 NovelForge → 花椒写作平台。
 * 只改「用户可见」的文案与文档；数据库名 / localStorage 键故意保留不变，
 * 这样已有本地作品不会因为改个名字就"消失"。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const FILES = [
  'index.html',
  'package.json',
  'README.md',
  'ROADMAP.md',
  'docs/GOTCHAS.md',
  'src/styles/globals.css',
  'src/features/onboarding/Welcome.tsx',
  'src/features/settings/SettingsPage.tsx',
  'src/features/data/DataPage.tsx',
  'src/features/data/exporters.ts',
  'src/features/world/ConflictModal.tsx',
  'src/ai/providers.ts',
  'src/db/repo/settings.ts',
  'scripts/ai-e2e.mjs',
];

// 用户可见品牌名替换（顺序重要：长的先换）
const REPLACEMENTS = [
  ['墨枢 NovelForge', '花椒写作平台'],
  ['墨枢NovelForge', '花椒写作平台'],
  ['NovelForge', '花椒写作平台'],
  ['墨枢', '花椒'],
];

// 这些标识符绝对不能改（存储键 / 库名 / 包内路径）
const PROTECT = [
  'novelforge',          // IndexedDB 名、localStorage 键前缀
  'novelforge-backup',   // 备份文件标识
  'novelforge:settings',
];

let changed = 0;
for (const file of FILES) {
  let s;
  try {
    s = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  const before = s;

  for (const [from, to] of REPLACEMENTS) {
    // 保护：把不该动的片段先挖出来占位
    const guards = [];
    let guarded = s;
    for (const p of PROTECT) {
      let idx = guarded.indexOf(p);
      while (idx >= 0) {
        const token = '\u0000' + guards.length + '\u0000';
        guards.push(p);
        guarded = guarded.slice(0, idx) + token + guarded.slice(idx + p.length);
        idx = guarded.indexOf(p);
      }
    }
    guarded = guarded.split(from).join(to);
    for (let i = 0; i < guards.length; i++) {
      guarded = guarded.split('\u0000' + i + '\u0000').join(guards[i]);
    }
    s = guarded;
  }

  if (s !== before) {
    writeFileSync(file, s);
    changed += 1;
    console.log('改名: ' + file);
  }
}
console.log('共修改 ' + changed + ' 个文件');
