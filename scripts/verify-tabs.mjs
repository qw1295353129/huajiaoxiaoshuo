/**
 * 回归：页签（Tabs）的活动态必须一眼看得出来。
 *
 * 背景：HeroUI 的 .tabs__tab[data-selected="true"] 只改了文字颜色，
 * 在浅灰底上几乎看不出差别 —— 作者不知道自己在哪个视图里。
 * 项目在 globals.css 里把活动态改成了实心药丸（品牌色填充 + 反色文字）。
 *
 * 这里断言三件事：① 任何时刻**恰好一个** tab 是选中的（含 aria 与 data 属性）；
 * ② 活动态确实有填充色，不是只换了个浅色文字；③ 点击能正确切换。
 *
 * 顺带防一个真实的坑：初始渲染时如果没有任何 tab 选中，
 * 界面看起来就是"全都没选"，用户会以为坏了。
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
    return {
      total: tabs.length,
      selectedData: selected.length,
      selectedAria: tabs.filter((t) => t.getAttribute("aria-selected") === "true").length,
      selectedText: s ? (s.textContent ?? "").trim() : null,
      bg: cs?.backgroundColor ?? null,
      color: cs?.color ?? null,
      weight: cs?.fontWeight ?? null,
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
check("活动态文字是反色且加粗", a?.weight === "600", String(a?.weight));

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
