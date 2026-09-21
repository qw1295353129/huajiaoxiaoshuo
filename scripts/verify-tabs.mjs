/**
 * 回归：页签（Tabs）的活动态必须一眼看得出来，且外观要与官方一致。
 *
 * 背景（这段弯路值得留着）：
 *  ① HeroUI 的 .tabs__tab[data-selected="true"] 只改文字颜色，浅灰底上几乎看不出差别；
 *  ② 我先自己画了个"品牌色实心药丸"，结果紫色太跳、文字对比度还被压住 —— 两头不讨好；
 *  ③ 官方其实有 Tabs.Indicator（白色药丸 + 滑动动画），但它是 React Aria 的 SharedElement，
 *     需要 SharedElementTransition 包裹；补上包裹层后不崩了，却在本项目里**根本不渲染**；
 *  ④ 最终用官方那套原料（--segment 纯白 + --surface-shadow 细阴影）直接画在选中的 tab 上，
 *     并补上 Tabs.ListContainer（浅灰底 bg-default 挂在它上面）。
 *
 * 所以这里断言的是**官方分段控件的三个特征**：灰底容器、白色药丸、细阴影。
 * 另外防一个真实风险：任何时刻必须恰好一个 tab 被选中（全都没选看起来就像坏了）。
 */
import { gotoApp, launchIsolated } from "./lib/browser.mjs";

const BASE = "http://127.0.0.1:5178";
const context = await launchIsolated(import.meta.url, { viewport: { width: 1512, height: 1000 } });
const page = context.pages()[0] ?? (await context.newPage());
const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 160)));

let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (x ? "  → " + x : "")); } };

/**
 * 读取页签状态。注意必须**等选中态落到 DOM** 再读：
 * 第一版我在 goto 之后立刻读，拿到 5 个全未选中，误判成"没有活动态"，
 * 白查了一轮。所以这里用 waitForFunction 等，而不是靠固定 sleep。
 */
const readTabs = (page) =>
  page.evaluate(() => {
    const tabs = [...document.querySelectorAll('[role="tab"]')];
    if (!tabs.length) return null;
    const selected = tabs.filter((t) => t.getAttribute("data-selected") === "true");
    const s = selected[0];
    const cs = s ? getComputedStyle(s) : null;
    // 浅灰底挂在 ListContainer 上，不是 tablist 本身
    const list = document.querySelector('[role="tablist"]');
    const container = list?.closest(".tabs__list-container") ?? null;
    const ccs = container ? getComputedStyle(container) : null;
    return {
      total: tabs.length,
      selectedData: selected.length,
      selectedAria: tabs.filter((t) => t.getAttribute("aria-selected") === "true").length,
      selectedText: s ? (s.textContent ?? "").trim() : null,
      bg: cs?.backgroundColor ?? null,
      color: cs?.color ?? null,
      weight: cs?.fontWeight ?? null,
      shadow: cs?.boxShadow ?? null,
      containerBg: ccs?.backgroundColor ?? null,
      hasContainer: Boolean(container),
      labels: tabs.map((t) => (t.textContent ?? "").trim()),
    };
  });

const waitSelected = (page) =>
  page
    .waitForFunction(() => document.querySelectorAll('[role="tab"][data-selected="true"]').length === 1, { timeout: 8000 })
    .then(() => true)
    .catch(() => false);

await gotoApp(page, BASE + "/");
const pid = await page.evaluate(async () => {
  const p = await import("/src/db/repo/projects.ts");
  const proj = await p.createProject({ title: "页签回归" });
  const o = await import("/src/db/repo/outline.ts");
  for (let i = 0; i < 3; i++) await o.createChapter(proj.id, { title: "第" + (i + 1) + "章" });
  const w = await import("/src/db/repo/world.ts");
  await w.createWorldEntry(proj.id, { title: "雾港", category: "custom", body: "港口", importance: 3 });
  return proj.id;
});

const transparent = (c) => !c || c === "rgba(0, 0, 0, 0)" || c === "transparent";

console.log("【写作分析页（5 个页签）】");
await gotoApp(page, BASE + "/p/" + pid + "/insights", { settle: 2000 });
const gotSelected = await waitSelected(page);
const a = await readTabs(page);
check("存在页签", (a?.total ?? 0) === 5, JSON.stringify(a?.labels));
check("初始状态就有一个被选中（不是全都未选）", gotSelected === true, JSON.stringify(a));
check("data-selected 恰好一个", a?.selectedData === 1, String(a?.selectedData));
check("aria-selected 与之一致（无障碍也正确）", a?.selectedAria === 1, String(a?.selectedAria));
check("活动态有填充色，不只是换文字颜色", !transparent(a?.bg), String(a?.bg));
// 官方分段控件的三个特征
check("选中项是浅色药丸（--segment）", (a?.bg ?? "").includes("1 0 0") || (a?.bg ?? "").includes("255, 255, 255"), String(a?.bg));
check("选中项带细阴影（--surface-shadow）", (a?.shadow ?? "") !== "none" && (a?.shadow ?? "").includes("rgba"), String(a?.shadow).slice(0, 50));
check("页签外层有浅灰底容器（ListContainer）", a?.hasContainer === true && !transparent(a?.containerBg), JSON.stringify({ has: a?.hasContainer, bg: a?.containerBg }));

console.log("【点击切换】");
const target = a?.labels?.[3];
const clicked = await page.evaluate((label) => {
  const t = [...document.querySelectorAll('[role="tab"]')].find((x) => (x.textContent ?? "").trim() === label);
  if (t) { t.click(); return true; }
  return false;
}, target);
await page.waitForTimeout(900);
await waitSelected(page);
const b = await readTabs(page);
check("能点到第 4 个页签", clicked === true, String(target));
check("切换后选中的是它", b?.selectedText === target, JSON.stringify({ want: target, got: b?.selectedText }));
check("切换后仍然恰好一个选中", b?.selectedData === 1 && b?.selectedAria === 1, JSON.stringify(b));
check("切换后仍有填充色", !transparent(b?.bg), String(b?.bg));
check("页签文字都还在（没有渲染丢失）", (b?.labels ?? []).join("|") === (a?.labels ?? []).join("|"), "");

console.log("【其他用页签的页面】");
for (const [label, path] of [["世界观", "/world"], ["一致性检查", "/consistency"]]) {
  await gotoApp(page, BASE + "/p/" + pid + path, { settle: 2200 });
  const ok = await waitSelected(page);
  const st = await readTabs(page);
  check(label + " 页有一个选中的页签", ok && st?.selectedData === 1, JSON.stringify(st));
  check(label + " 页活动态有填充色", !transparent(st?.bg), String(st?.bg));
}

console.log("");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
console.log("控制台错误: " + (errs.length ? JSON.stringify(errs.slice(0, 4)) : "NONE"));
await context.close();
process.exit(fail === 0 ? 0 : 1);
