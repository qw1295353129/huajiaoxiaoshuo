/**
 * 回归：章节属性的入口在左侧章节列表上。
 *
 * 用户要求："章节属性设置改到左侧章节上"。
 * 原来只能先进到某一章，再去工具栏点齿轮 —— 而"这一章的属性"本来就该在
 * 找到这一章的地方改。
 *
 * 这里守住两件事：
 *  ① 章节列表里每条都有齿轮，点它能打开属性弹窗；
 *  ② **打开的是被点的那一章**，不是当前章 —— 用 Chapter 对象而不是布尔值正是为此。
 *  ③ 工具栏那个入口仍然可用（作用于当前章），两个入口不冲突。
 */
import { gotoApp, launchIsolated } from "./lib/browser.mjs";

const BASE = "http://127.0.0.1:5178";
const context = await launchIsolated(import.meta.url, { viewport: { width: 1512, height: 950 } });
const page = context.pages()[0] ?? (await context.newPage());
const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 180)));

let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (x ? "  → " + x : "")); } };

await gotoApp(page, BASE + "/");
const ids = await page.evaluate(async () => {
  const p = await import("/src/db/repo/projects.ts");
  const proj = await p.createProject({ title: "章节属性入口" });
  const o = await import("/src/db/repo/outline.ts");
  const made = [];
  for (const t of ["第一章", "第二章", "第三章"]) {
    const c = await o.createChapter(proj.id, { title: t });
    await o.saveChapterContent(c.id, "<p>" + t + "正文</p>", { touchStatus: false });
    made.push(c.id);
  }
  return { pid: proj.id, c1: made[0], c3: made[2] };
});

console.log("【列表里的齿轮】");
await gotoApp(page, BASE + "/p/" + ids.pid + "/write/" + ids.c1, { settle: 3000 });
const gears = await page.evaluate(() => {
  const list = [...document.querySelectorAll("div")].find((d) => (d.className || "").toString().includes("w-72") && /border-r/.test((d.className || "").toString()));
  const btns = [...(list?.querySelectorAll('button[aria-label="章节属性"]') ?? [])];
  return { count: btns.length, listFound: Boolean(list) };
});
check("章节列表里每章都有齿轮", gears.count === 3, JSON.stringify(gears));

console.log("【点第三章的齿轮，必须打开第三章】");
const opened = await page.evaluate(() => {
  const list = [...document.querySelectorAll("div")].find((d) => (d.className || "").toString().includes("w-72") && /border-r/.test((d.className || "").toString()));
  // 找到"第三章"那一行的齿轮
  const row = [...(list?.querySelectorAll("li") ?? [])].find((li) => (li.textContent ?? "").includes("第三章"));
  const btn = row?.querySelector('button[aria-label="章节属性"]');
  if (btn) { btn.click(); return true; }
  return false;
});
check("能点到第三章的齿轮", opened === true);
await page.waitForTimeout(900);
const dialog = await page.evaluate(() => {
  // 弹窗是 fixed inset-0 的遮罩层
  const overlay = document.querySelector(".fixed.inset-0");
  if (!overlay) return { open: false };
  const input = overlay.querySelector("input");
  return {
    open: true,
    heading: (overlay.querySelector("h3")?.textContent ?? "").trim(),
    chapterName: input ? input.value : null,
  };
});
check("章节属性弹窗打开了", dialog.open === true, JSON.stringify(dialog));
check("标题是「章节属性」", dialog.heading === "章节属性", String(dialog.heading));
check(
  "打开的是第三章（不是当前的第一章）",
  dialog.chapterName === "第三章",
  JSON.stringify({ shown: dialog.chapterName, current: "第一章" }),
);

console.log("【关掉之后工具栏入口仍可用】");
await page.keyboard.press("Escape");
await page.evaluate(() => {
  const overlay = document.querySelector(".fixed.inset-0");
  const close = overlay ? [...overlay.querySelectorAll("button")].find((b) => b.querySelector("svg") && b.className.includes("icon-only")) : null;
  if (close) close.click();
});
await page.waitForTimeout(600);
const closed = await page.evaluate(() => !document.querySelector(".fixed.inset-0"));
check("能关闭弹窗", closed === true);

const toolbar = await page.evaluate(() => {
  const b = document.querySelector('button[aria-label="章节属性"]');
  // 工具栏的那个在头部，不在章节列表里
  const list = [...document.querySelectorAll("div")].find((d) => (d.className || "").toString().includes("w-72") && /border-r/.test((d.className || "").toString()));
  const inList = list?.contains(b);
  // 找列表外的那个
  const all = [...document.querySelectorAll('button[aria-label="章节属性"]')].filter((x) => !list?.contains(x));
  if (all[0]) { all[0].click(); return { clicked: true, inList: Boolean(inList) }; }
  return { clicked: false };
});
check("工具栏上的齿轮也带无障碍标签", toolbar.clicked === true, JSON.stringify(toolbar));
await page.waitForTimeout(900);
const fromToolbar = await page.evaluate(() => {
  const overlay = document.querySelector(".fixed.inset-0");
  const input = overlay?.querySelector("input");
  return { open: Boolean(overlay), chapterName: input ? input.value : null };
});
check("工具栏入口打开当前章（第一章）", fromToolbar.open && fromToolbar.chapterName === "第一章", JSON.stringify(fromToolbar));

console.log("");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
console.log("控制台错误: " + (errs.length ? JSON.stringify(errs.slice(0, 3)) : "NONE"));
await context.close();
process.exit(fail === 0 ? 0 : 1);
