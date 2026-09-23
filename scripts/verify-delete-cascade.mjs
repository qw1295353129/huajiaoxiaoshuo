/**
 * 回归：删项目 / 删章必须清干净级联表。
 *
 * 三个真实 bug：
 *  1. appearances 在 characters 之后删 —— 主键列表恒空，出场记录成孤儿；
 *  2. comments / reviewSuggestions 从未进 byProject 清单（v2 加表时漏了）；
 *  3. deleteChapter 没级联 comments / reviewSuggestions / entityMentions（有 chapterId 索引的三表）。
 */
import { gotoApp, launchIsolated } from "./lib/browser.mjs";

const BASE = "http://127.0.0.1:5178";
const context = await launchIsolated(import.meta.url, { viewport: { width: 1200, height: 800 } });
const page = context.pages()[0] ?? (await context.newPage());
const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 180)));

let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (x ? "  → " + x : "")); } };

await gotoApp(page, BASE + "/");

const out = await page.evaluate(async () => {
  const p = await import("/src/db/repo/projects.ts");
  const o = await import("/src/db/repo/outline.ts");
  const c = await import("/src/db/repo/cast.ts");
  const r = await import("/src/db/repo/review.ts");
  const { db } = await import("/src/db/database.ts");

  const proj = await p.createProject({ title: "级联删除验证" });
  const ch = await o.createChapter(proj.id, { title: "第一章" });
  const ch2 = await o.createChapter(proj.id, { title: "第二章" });
  const character = await c.createCharacter(proj.id, { name: "沈砚", role: "protagonist" });
  await db.characterAppearances.put({
    id: `${character.id}::${ch.id}`,
    characterId: character.id,
    chapterId: ch.id,
    mentioned: 1,
    dialogueLines: 0,
    words: 10,
  });
  await r.addComment({
    projectId: proj.id,
    chapterId: ch.id,
    author: "审稿人",
    anchor: { from: 0, to: 4, quote: "第一章" },
    body: "这里要注意",
  });
  await r.addReviewSuggestion({
    projectId: proj.id,
    chapterId: ch2.id,
    kind: "replace",
    anchor: { from: 0, to: 0, quote: "" },
    proposed: "替换内容",
  });
  await o.saveChapterContent(ch.id, "<p>正文</p>", { touchStatus: false });

  const before = {
    appearances: (await db.characterAppearances.where("characterId").equals(character.id).toArray()).length,
    comments: (await db.comments.where("projectId").equals(proj.id).toArray()).length,
    suggestions: (await db.reviewSuggestions.where("projectId").equals(proj.id).toArray()).length,
  };

  await p.deleteProject(proj.id);

  const orphanAppearances = await db.characterAppearances.where("characterId").equals(character.id).toArray();
  const leftoverComments = await db.comments.where("projectId").equals(proj.id).toArray();
  const leftoverSuggestions = await db.reviewSuggestions.where("projectId").equals(proj.id).toArray();
  const leftoverChapters = await db.chapters.where("projectId").equals(proj.id).toArray();
  const leftoverContents = await db.chapterContents.where("projectId").equals(proj.id).toArray();
  const leftoverCharacters = await db.characters.where("projectId").equals(proj.id).toArray();

  return {
    before,
    orphanAppearances: orphanAppearances.length,
    leftoverComments: leftoverComments.length,
    leftoverSuggestions: leftoverSuggestions.length,
    leftoverChapters: leftoverChapters.length,
    leftoverContents: leftoverContents.length,
    leftoverCharacters: leftoverCharacters.length,
  };
});

console.log("【删项目前数据在】");
check("删前有出场记录", out.before.appearances >= 1, JSON.stringify(out.before));
check("删前有批注", out.before.comments >= 1, JSON.stringify(out.before));
check("删前有修订建议", out.before.suggestions >= 1, JSON.stringify(out.before));

console.log("【删项目后必须清干净】");
check("出场记录无孤儿", out.orphanAppearances === 0, String(out.orphanAppearances));
check("批注已清", out.leftoverComments === 0, String(out.leftoverComments));
check("修订建议已清", out.leftoverSuggestions === 0, String(out.leftoverSuggestions));
check("章节已清", out.leftoverChapters === 0 && out.leftoverContents === 0, JSON.stringify(out));
check("人物已清", out.leftoverCharacters === 0, String(out.leftoverCharacters));

// ---------- 删章级联：comments / reviewSuggestions / entityMentions（按 chapterId） ----------
const chOut = await page.evaluate(async () => {
  const p = await import("/src/db/repo/projects.ts");
  const o = await import("/src/db/repo/outline.ts");
  const r = await import("/src/db/repo/review.ts");
  const { db } = await import("/src/db/database.ts");

  const proj = await p.createProject({ title: "删章级联验证" });
  const ch = await o.createChapter(proj.id, { title: "待删章" });
  await r.addComment({
    projectId: proj.id,
    chapterId: ch.id,
    author: "审稿人",
    anchor: { from: 0, to: 4, quote: "待删章" },
    body: "章级批注",
  });
  await r.addReviewSuggestion({
    projectId: proj.id,
    chapterId: ch.id,
    kind: "replace",
    anchor: { from: 0, to: 0, quote: "" },
    proposed: "替换",
  });
  await db.entityMentions.put({
    id: "em_" + ch.id,
    projectId: proj.id,
    entityId: "ent_x",
    chapterId: ch.id,
    count: 2,
    firstOffset: 0,
    sample: "片段",
  });
  await o.saveChapterContent(ch.id, "<p>正文</p>", { touchStatus: false });

  const before = {
    comments: await db.comments.where("chapterId").equals(ch.id).count(),
    suggestions: await db.reviewSuggestions.where("chapterId").equals(ch.id).count(),
    mentions: await db.entityMentions.where("chapterId").equals(ch.id).count(),
    contents: (await db.chapterContents.get(ch.id)) ? 1 : 0,
    projectId: (await db.chapterContents.get(ch.id))?.projectId ?? null,
  };

  await o.deleteChapter(ch.id);

  return {
    before,
    after: {
      comments: await db.comments.where("chapterId").equals(ch.id).count(),
      suggestions: await db.reviewSuggestions.where("chapterId").equals(ch.id).count(),
      mentions: await db.entityMentions.where("chapterId").equals(ch.id).count(),
      chapter: (await db.chapters.get(ch.id)) ? 1 : 0,
      contents: (await db.chapterContents.get(ch.id)) ? 1 : 0,
    },
    projectId: proj.id,
  };
});

console.log("【删章级联】");
check("删前章级批注在", chOut.before.comments === 1, JSON.stringify(chOut.before));
check("删前章级修订建议在", chOut.before.suggestions === 1, JSON.stringify(chOut.before));
check("删前章级实体提及在", chOut.before.mentions === 1, JSON.stringify(chOut.before));
check("正文 projectId 非空（首存回填）", Boolean(chOut.before.projectId), String(chOut.before.projectId));
check("删章后批注已清", chOut.after.comments === 0, String(chOut.after.comments));
check("删章后修订建议已清", chOut.after.suggestions === 0, String(chOut.after.suggestions));
check("删章后实体提及已清", chOut.after.mentions === 0, String(chOut.after.mentions));
check("删章后章节与正文已清", chOut.after.chapter === 0 && chOut.after.contents === 0, JSON.stringify(chOut.after));

await page.evaluate(async (pid) => {
  const p = await import("/src/db/repo/projects.ts");
  await p.deleteProject(pid);
}, chOut.projectId);

console.log("");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
console.log("控制台错误: " + (errs.length ? JSON.stringify(errs.slice(0, 3)) : "NONE"));
await context.close();
process.exit(fail === 0 ? 0 : 1);
