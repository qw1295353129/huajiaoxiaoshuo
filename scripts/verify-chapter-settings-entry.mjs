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

console.log("【齿轮必须在删除按钮左边】");
// 用真实渲染坐标判断顺序，而不是看源码 —— 布局变了源码顺序不代表视觉顺序
const rowOrder = await page.evaluate(() => {
  const list = [...document.querySelectorAll("div")].find(
    (d) => (d.className || "").toString().includes("w-72") && /border-r/.test((d.className || "").toString()),
  );
  const row = [...(list?.querySelectorAll("li") ?? [])].find((li) => (li.textContent ?? "").includes("第二章"));
  if (!row) return null;
  const at = (sel) => {
    const el = row.querySelector(sel);
    return el ? Math.round(el.getBoundingClientRect().left) : null;
  };
  const title = row.querySelector("button");
  return {
    titleX: title ? Math.round(title.getBoundingClientRect().left) : null,
    settingsX: at('button[aria-label="章节属性"]'),
    deleteX: at('button[aria-label="删除章节"]'),
  };
});
console.log("  " + JSON.stringify(rowOrder));
check("能定位到两个按钮", rowOrder?.settingsX != null && rowOrder?.deleteX != null, JSON.stringify(rowOrder));
check(
  "齿轮在删除按钮的左边",
  (rowOrder?.settingsX ?? 9999) < (rowOrder?.deleteX ?? 0),
  JSON.stringify(rowOrder),
);
check(
  "标题在齿轮左边（不再被齿轮挤到右边）",
  (rowOrder?.titleX ?? 9999) < (rowOrder?.settingsX ?? 0),
  JSON.stringify(rowOrder),
);

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

console.log("【工具栏那个重复的齿轮已移除】");
await page.keyboard.press("Escape");
await page.evaluate(() => {
  const overlay = document.querySelector(".fixed.inset-0");
  const close = overlay ? [...overlay.querySelectorAll("button")].find((b) => b.querySelector("svg") && b.className.includes("icon-only")) : null;
  if (close) close.click();
});
await page.waitForTimeout(600);
const closed = await page.evaluate(() => !document.querySelector(".fixed.inset-0"));
check("能关闭弹窗", closed === true);

/*
  工具栏上的「章节属性」齿轮已移除 —— 它和章节列表里的入口重复。
  用户要求："写作编辑器上边章节属性多余的了，改成 ai 助手"。
  那个位置现在放的是「AI 助手」按钮。
*/
const toolbar = await page.evaluate(() => {
  const list = [...document.querySelectorAll("div")].find(
    (d) => (d.className || "").toString().includes("w-72") && /border-r/.test((d.className || "").toString()),
  );
  const outsideList = [...document.querySelectorAll('button[aria-label="章节属性"]')].filter((x) => !list?.contains(x));
  const aiBtn = document.querySelector('button[aria-label="AI 助手"]');
  return {
    列表外的章节属性按钮数: outsideList.length,
    ai助手按钮: Boolean(aiBtn),
    ai助手带文字: aiBtn ? (aiBtn.textContent ?? "").includes("AI 助手") : false,
  };
});
check("工具栏不再有重复的章节属性入口", toolbar.列表外的章节属性按钮数 === 0, JSON.stringify(toolbar));
check("工具栏有「AI 助手」按钮（带文字标签）", toolbar.ai助手按钮 === true && toolbar.ai助手带文字 === true, JSON.stringify(toolbar));

/*
  点它切换右侧面板。
  注意默认 rightPanel 就是 "ai"（面板开着），所以第一次点击是**收起** ——
  按钮的语义是"显示/隐藏 AI 助手"，不要假设第一次点击一定是打开
  （我第一版就写反了，断言"点完可见"直接失败）。
*/
/*
  用按钮自身的状态判断，而不是去猜面板里的文字 ——
  AI 面板有"未配置模型"等空态，文案不固定（我第一版按文案判断，误判成"没切换"）。
*/
const panelState = () =>
  page.evaluate(() => {
    const b = document.querySelector('button[aria-label="AI 助手"]');
    return {
      selected: b?.getAttribute("aria-pressed") === "true" || (b?.className ?? "").includes("button--secondary"),
      panelWidth: document.querySelector(".w-\\[380px\\]")?.getBoundingClientRect().width ?? 0,
    };
  });

const start = await panelState();
await page.evaluate(() => {
  document.querySelector('button[aria-label="AI 助手"]')?.click();
});
await page.waitForTimeout(800);
const after = await panelState();
check(
  "点「AI 助手」能切换右侧面板",
  start.selected !== after.selected && start.panelWidth !== after.panelWidth,
  JSON.stringify({ start, after }),
);

// 再点回来，确认是双向的
await page.evaluate(() => {
  document.querySelector('button[aria-label="AI 助手"]')?.click();
});
await page.waitForTimeout(800);
const back = await panelState();
check(
  "再点一次恢复原状（双向切换）",
  back.selected === start.selected && back.panelWidth === start.panelWidth,
  JSON.stringify({ start, back }),
);

console.log("");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
console.log("控制台错误: " + (errs.length ? JSON.stringify(errs.slice(0, 3)) : "NONE"));
await context.close();
process.exit(fail === 0 ? 0 : 1);
