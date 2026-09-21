/**
 * 回归：可滚动性。
 *
 * 背景：外层路由外壳是 h-dvh + overflow-hidden（写作台需要它来锁定三栏布局），
 * 所以**每个普通页面都必须自己提供滚动容器**，否则内容会被直接裁掉。
 * 「项目总览下面被挡住」就是这个原因，而且它是静默的 —— 没有任何报错。
 *
 * 这里用真实滚轮事件验证，而不是只看 class 名。
 */
import { launchIsolated } from "./lib/browser.mjs";

const BASE = "http://127.0.0.1:5178";
const context = await launchIsolated(import.meta.url, { viewport: { width: 1512, height: 945 } });
const page = context.pages()[0] ?? (await context.newPage());
const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 140)));

let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (x ? "  → " + x : "")); } };

/**
 * 找到页面里真正可滚动的那个容器（能滚的未必是第一个）。
 *
 * 必须返回**纯数据**：page.evaluate 无法序列化 DOM 元素，
 * 返回元素会得到一个空对象（我第一版就是因此拿到 0 vs 0）。
 */
const SCROLLER = () => {
  const all = [...document.querySelectorAll("*")].filter((el) => {
    const cs = getComputedStyle(el);
    return /auto|scroll/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 8;
  });
  if (!all.length) return null;
  const t = all.sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))[0];
  return {
    scrollTop: Math.round(t.scrollTop),
    scrollHeight: t.scrollHeight,
    clientHeight: t.clientHeight,
    maxScroll: t.scrollHeight - t.clientHeight,
  };
};

await page.goto(BASE + "/", { waitUntil: "networkidle" });
const pid = await page.evaluate(async () => {
  const p = await import("/src/db/repo/projects.ts");
  const proj = await p.createProject({ title: "滚动回归" });
  const o = await import("/src/db/repo/outline.ts");
  for (let i = 0; i < 16; i++) await o.createChapter(proj.id, { title: "第" + (i + 1) + "章 测试章节" });
  return proj.id;
});

console.log("【项目总览】");
await page.goto(BASE + "/p/" + pid + "/overview", { waitUntil: "networkidle" });
await page.waitForTimeout(3000);
const before = await page.evaluate(SCROLLER);
check("存在可滚动容器", before !== null, JSON.stringify(before));
check("内容确实超出视口", (before?.scrollHeight ?? 0) > (before?.clientHeight ?? 0) + 100,
  (before?.scrollHeight ?? 0) + " vs " + (before?.clientHeight ?? 0));

// 用真实滚轮滚，而不是直接改 scrollTop（那会绕过事件与 CSS）
await page.mouse.move(750, 500);
await page.mouse.wheel(0, 1200);
await page.waitForTimeout(800);
const afterWheel = await page.evaluate(SCROLLER);
check("滚轮可以向下滚动", (afterWheel?.scrollTop ?? 0) > 0, "scrollTop=" + (afterWheel?.scrollTop ?? 0));

// 滚到底，确认最后一屏内容真的可见
await page.evaluate(() => {
  const all = [...document.querySelectorAll("*")].filter((el) => {
    const cs = getComputedStyle(el);
    return /auto|scroll/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 8;
  });
  const t = all.sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))[0];
  if (t) t.scrollTop = t.scrollHeight;
});
await page.waitForTimeout(800);
const bottom = await page.evaluate(() => {
  const all = [...document.querySelectorAll("*")].filter((el) => {
    const cs = getComputedStyle(el);
    return /auto|scroll/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 8;
  });
  const t = all.sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))[0];
  if (!t) return null;
  // 用容器自身的位置判断，避免受页面外元素干扰
  return {
    scrollTop: Math.round(t.scrollTop),
    maxScroll: t.scrollHeight - t.clientHeight,
    // 容器内最后一个有文字的元素是否落在容器可视区内
    reachable: (() => {
      const nodes = [...t.querySelectorAll("*")].filter((e) => e.children.length === 0 && (e.textContent ?? "").trim());
      const last = nodes[nodes.length - 1];
      if (!last) return null;
      const lr = last.getBoundingClientRect();
      const cr = t.getBoundingClientRect();
      return lr.bottom <= cr.bottom + 2;
    })(),
  };
});
check("能滚到最底部", (bottom?.scrollTop ?? 0) >= (bottom?.maxScroll ?? 1) - 4, JSON.stringify(bottom));
check("最后一行内容没有被裁掉", bottom?.reachable === true, JSON.stringify(bottom));

console.log("【书库首页】");
await page.goto(BASE + "/", { waitUntil: "networkidle" });
await page.waitForTimeout(2000);
const lib = await page.evaluate(() => {
  const all = [...document.querySelectorAll("*")].filter((el) => /auto|scroll/.test(getComputedStyle(el).overflowY));
  return { count: all.length };
});
check("书库首页有滚动容器", lib.count > 0, JSON.stringify(lib));

console.log("【其他页面抽样（写作台除外）】");
for (const [label, path] of [["大纲", "/outline"], ["人物", "/characters"], ["世界观", "/world"], ["审稿台", "/review"], ["设置", "/settings"]]) {
  const url = path === "/settings" ? BASE + path : BASE + "/p/" + pid + path;
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(1800);
  const has = await page.evaluate(() => {
    const all = [...document.querySelectorAll("*")].filter((el) => /auto|scroll/.test(getComputedStyle(el).overflowY));
    return all.length > 0 || document.body.scrollHeight > window.innerHeight + 8;
  });
  check(label + " 页可滚动", has === true);
}

console.log("");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
console.log("控制台错误: " + (errs.length ? JSON.stringify(errs.slice(0, 4)) : "NONE"));
await context.close();
process.exit(fail === 0 ? 0 : 1);
