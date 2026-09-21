/**
 * 回归：世界观条目的编辑改成弹窗。
 *
 * 用户反馈："世界观页面你没改吗，不行把编辑条目改成弹窗"。
 * 起因是我只调了两栏比例（列表 380 / 编辑上限 680），但**编辑区一旦常驻，
 * 列表就永远要让出一大块横向空间** —— 浏览时根本不需要它，怎么调都别扭。
 *
 * 现在：列表占满整页，点条目开编辑弹窗。
 *
 * 守住：
 *  ① 列表宽度接近整页（不再被编辑区挤占）；
 *  ② 点条目打开弹窗，字段是那一章……那一条的；
 *  ③ 弹窗里能保存并写进数据库；
 *  ④ 关掉弹窗后能继续浏览（不残留遮罩）。
 */
import { gotoApp, launchIsolated } from "./lib/browser.mjs";

const BASE = "http://127.0.0.1:5178";
const context = await launchIsolated(import.meta.url, { viewport: { width: 1512, height: 1000 } });
const page = context.pages()[0] ?? (await context.newPage());
const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 180)));

let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (x ? "  → " + x : "")); } };

await gotoApp(page, BASE + "/");
const pid = await page.evaluate(async () => {
  const p = await import("/src/db/repo/projects.ts");
  const proj = await p.createProject({ title: "条目弹窗" });
  const w = await import("/src/db/repo/world.ts");
  for (const t of ["跃迁引擎", "雾港", "海禁"]) {
    await w.createWorldEntry(proj.id, { title: t, category: "custom", body: t + "的内容", importance: 3 });
  }
  return proj.id;
});

await gotoApp(page, BASE + "/p/" + pid + "/world", { settle: 2600 });

console.log("【列表占满整页】");
const layout = await page.evaluate(() => {
  const panel = document.querySelector('[role="tabpanel"]');
  const scroller = panel?.querySelector("div");
  const doc = document.documentElement;
  // 找到含条目的列表容器
  const listPane = [...(panel?.querySelectorAll("div") ?? [])].find((d) => (d.textContent ?? "").includes("跃迁引擎") && d.querySelector("button"));
  return {
    panelWidth: panel ? Math.round(panel.getBoundingClientRect().width) : null,
    listWidth: listPane ? Math.round(listPane.getBoundingClientRect().width) : null,
    horizontalOverflow: doc.scrollWidth > doc.clientWidth + 2,
    scrollerFound: Boolean(scroller),
  };
});
console.log("  " + JSON.stringify(layout));
check("列表宽度接近整页（>900）", (layout.listWidth ?? 0) > 900, String(layout.listWidth));
check("没有横向溢出", layout.horizontalOverflow === false, String(layout.horizontalOverflow));

console.log("【点条目打开弹窗】");
const before = await page.evaluate(() => Boolean(document.querySelector(".fixed.inset-0")));
check("默认没有弹窗（纯浏览）", before === false, String(before));

await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => (x.textContent ?? "").includes("跃迁引擎"));
  b?.click();
});
await page.waitForTimeout(900);
const dlg = await page.evaluate(() => {
  const overlay = document.querySelector(".fixed.inset-0");
  if (!overlay) return { open: false };
  const input = overlay.querySelector("input");
  return {
    open: true,
    heading: (overlay.querySelector("h3")?.textContent ?? "").trim(),
    title: input ? input.value : null,
    hasCards: overlay.querySelectorAll(".p-4").length,
  };
});
check("弹窗打开了", dlg.open === true, JSON.stringify(dlg));
check("标题是编辑条目", dlg.heading === "编辑条目", String(dlg.heading));
check("显示的是被点的那一条", dlg.title === "跃迁引擎", String(dlg.title));
check("弹窗内没有多余的 Card 外框（flat 模式生效）", (dlg.hasCards ?? 0) === 0, JSON.stringify({ cards: dlg.hasCards }));

console.log("【改内容并保存】");
await page.evaluate(() => {
  const overlay = document.querySelector(".fixed.inset-0");
  const input = overlay?.querySelector("input");
  if (input) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, "跃迁引擎（改）");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
});
await page.waitForTimeout(400);
await page.evaluate(() => {
  const overlay = document.querySelector(".fixed.inset-0");
  const save = [...(overlay?.querySelectorAll("button") ?? [])].find((b) => (b.textContent ?? "").includes("保存"));
  save?.click();
});
await page.waitForTimeout(1600);

const saved = await page.evaluate(async (projectId) => {
  const { db } = await import("/src/db/database.ts");
  const rows = await db.worldEntries.where("projectId").equals(projectId).toArray();
  return {
    titles: rows.map((r) => r.title).sort(),
    dialogStillOpen: Boolean(document.querySelector(".fixed.inset-0")),
  };
}, pid);
check("改动写进了数据库", saved.titles.includes("跃迁引擎（改）"), JSON.stringify(saved.titles));
check("保存后弹窗自动关闭", saved.dialogStillOpen === false, String(saved.dialogStillOpen));

console.log("【关闭后能继续浏览】");
const after = await page.evaluate(() => {
  const overlay = document.querySelector(".fixed.inset-0");
  const body = document.body.innerText;
  return { overlay: Boolean(overlay), listVisible: body.includes("雾港") && body.includes("海禁") };
});
check("没有残留遮罩", after.overlay === false, String(after.overlay));
check("列表仍然可见可点", after.listVisible === true, JSON.stringify(after));

console.log("【新建条目也走弹窗】");
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => (x.textContent ?? "").includes("新建条目"));
  b?.click();
});
await page.waitForTimeout(900);
const newDlg = await page.evaluate(() => {
  const overlay = document.querySelector(".fixed.inset-0");
  return { open: Boolean(overlay), heading: (overlay?.querySelector("h3")?.textContent ?? "").trim() };
});
check("新建也打开同一个弹窗", newDlg.open === true, JSON.stringify(newDlg));
check("标题显示「新建条目」", newDlg.heading === "新建条目", String(newDlg.heading));

console.log("");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
console.log("控制台错误: " + (errs.length ? JSON.stringify(errs.slice(0, 3)) : "NONE"));
await context.close();
process.exit(fail === 0 ? 0 : 1);
