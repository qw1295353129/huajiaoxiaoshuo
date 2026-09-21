/**
 * 回归：世界观页的两栏比例。
 *
 * 用户反馈："编辑条目占的太宽了"。原来列表固定 320px、编辑器吃满剩余空间，
 * 1512 宽的屏上编辑区有 1152px，标题输入框横跨一整屏。
 *
 * 现在：列表 380px，编辑区上限 680px，多出来的空间给列表。
 * 这里把尺寸钉住，并顺带检查窄屏下不会溢出。
 */
import { gotoApp, launchIsolated } from "./lib/browser.mjs";

const BASE = "http://127.0.0.1:5178";
const context = await launchIsolated(import.meta.url, { viewport: { width: 1512, height: 1000 } });
const page = context.pages()[0] ?? (await context.newPage());
const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 160)));

let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (x ? "  → " + x : "")); } };

await gotoApp(page, BASE + "/");
const pid = await page.evaluate(async () => {
  const p = await import("/src/db/repo/projects.ts");
  const proj = await p.createProject({ title: "布局回归" });
  const w = await import("/src/db/repo/world.ts");
  const cats = ["magic", "geography", "history", "politics", "technology", "culture", "organization", "item"];
  for (let i = 0; i < 12; i++) {
    await w.createWorldEntry(proj.id, { title: "条目" + (i + 1), category: cats[i % cats.length], body: "内容" + i, importance: 4 });
  }
  return proj.id;
});

/** 量两栏与表单里的输入框宽度 */
const measure = () =>
  page.evaluate(() => {
    const panel = document.querySelector('[role="tabpanel"]');
    const grid = [...(panel?.querySelectorAll("div") ?? [])].find((d) =>
      (d.className || "").toString().includes("grid-cols-[380px"),
    );
    const kids = grid ? [...grid.children] : [];
    const w = (el) => (el ? Math.round(el.getBoundingClientRect().width) : null);
    const inputs = [...document.querySelectorAll('input[type="text"], input:not([type])')].filter((i) => i.offsetParent);
    const widest = inputs.reduce((a, b) => (a.getBoundingClientRect().width > b.getBoundingClientRect().width ? a : b), inputs[0]);
    const doc = document.documentElement;
    return {
      grid: w(grid),
      list: w(kids[0]),
      editor: w(kids[1]),
      widestInput: widest ? Math.round(widest.getBoundingClientRect().width) : null,
      horizontalOverflow: doc.scrollWidth > doc.clientWidth + 2,
    };
  });

console.log("【1512 宽（桌面）】");
await gotoApp(page, BASE + "/p/" + pid + "/world", { settle: 2500 });
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => (x.textContent ?? "").includes("条目1"));
  if (b) b.click();
});
await page.waitForTimeout(1200);
const wide = await measure();
console.log("  " + JSON.stringify(wide));
check("条目列表宽度约 380px", Math.abs((wide.list ?? 0) - 380) <= 2, String(wide.list));
check("编辑区收在 680px 以内（不再吃满整屏）", (wide.editor ?? 9999) <= 682, String(wide.editor));
check("标题输入框不再横跨整屏", (wide.widestInput ?? 9999) <= 660, String(wide.widestInput));
check("页面没有横向溢出", wide.horizontalOverflow === false, String(wide.horizontalOverflow));

console.log("【1280 宽（笔记本）】");
await page.setViewportSize({ width: 1280, height: 900 });
await page.waitForTimeout(700);
const mid = await measure();
console.log("  " + JSON.stringify(mid));
check("列表仍是 380px（固定列不缩）", Math.abs((mid.list ?? 0) - 380) <= 2, String(mid.list));
check("编辑区不超过上限", (mid.editor ?? 9999) <= 682, String(mid.editor));
check("窄屏也没有横向溢出", mid.horizontalOverflow === false, String(mid.horizontalOverflow));

console.log("【1024 宽（小屏临界）】");
await page.setViewportSize({ width: 1024, height: 900 });
await page.waitForTimeout(700);
const narrow = await measure();
console.log("  " + JSON.stringify(narrow));
check("小屏下依然没有横向溢出", narrow.horizontalOverflow === false, String(narrow.horizontalOverflow));
// 1024 及以下改为上下排列（分栏从 xl 才开始），所以两栏宽度应当相等且都很宽
check(
  "小屏下改为上下排列，编辑区不再被挤扁",
  (narrow.editor ?? 0) > 600 && narrow.list === narrow.editor,
  JSON.stringify({ list: narrow.list, editor: narrow.editor }),
);

console.log("");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
console.log("控制台错误: " + (errs.length ? JSON.stringify(errs.slice(0, 3)) : "NONE"));
await context.close();
process.exit(fail === 0 ? 0 : 1);
