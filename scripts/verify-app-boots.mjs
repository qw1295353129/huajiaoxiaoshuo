/**
 * 冒烟回归：应用必须能真正启动（白屏检测）。
 *
 * ## 为什么需要这条
 *
 * 我在更新日志里写了一句话，里面**嵌套了双引号**：
 *
 *   "…两个"对本章的操作"聚在行尾…"
 *
 * 这在 TypeScript 里**居然是合法的**（变成了相邻字符串字面量的拼接），
 * 所以 `tsc` 和 `vite build` 都不报错。但模块导出的是 undefined，
 * Vite 的 dev server 在单独编译这个文件时直接 500 ——
 * 表现就是**整个应用白屏**，而用户一刷新就撞上。
 *
 * 教训：类型检查与构建通过，不等于**应用能跑起来**。
 * 这条回归专门堵这个口子：打开首页，确认 #root 里真的渲染出内容。
 */
import { gotoApp, launchIsolated } from "./lib/browser.mjs";

const BASE = "http://127.0.0.1:5178";
const context = await launchIsolated(import.meta.url, { viewport: { width: 1280, height: 900 } });
const page = context.pages()[0] ?? (await context.newPage());
const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 200)));
// 500 说明某个模块编译失败 —— 这是白屏最常见的原因
const failures = [];
page.on("response", (res) => {
  if (res.status() >= 500) failures.push(res.status() + " " + res.url().slice(0, 90));
});

let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (x ? "  → " + x : "")); } };

console.log("【首页能挂载】");
// 不用 gotoApp 的容错：这里就是要断言"它必须挂载"
await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
let mounted = false;
try {
  await page.waitForFunction(() => (document.getElementById("root")?.children.length ?? 0) > 0, { timeout: 20000 });
  mounted = true;
} catch {
  mounted = false;
}
check("首页渲染出了内容（不是白屏）", mounted, JSON.stringify({ failures: failures.slice(0, 4) }));

/*
  首页有异步加载（读 IndexedDB 里的项目列表），会先显示"正在打开本地书库…"。
  断言要看**加载完成之后**的内容，否则测的是加载态 —— 我第一版就误判成"正文为空"。
*/
await page
  .waitForFunction(
    () => {
      const t = document.body.innerText;
      return t.includes("我的书库") || t.includes("新建作品") || t.includes("还没有作品");
    },
    { timeout: 15000 },
  )
  .catch(() => {});

const state = await page.evaluate(() => ({
  rootChildren: document.getElementById("root")?.children.length ?? -1,
  bodyLen: document.body.innerText.length,
  head: document.body.innerText.slice(0, 60).split(String.fromCharCode(10)).join(" | "),
}));
check("加载完成后正文确实渲染了书库", state.bodyLen > 20 && !state.head.includes("正在打开"), JSON.stringify(state));
check("没有模块编译失败（无 5xx）", failures.length === 0, JSON.stringify(failures.slice(0, 5)));
check("没有未捕获异常", errs.length === 0, JSON.stringify(errs.slice(0, 3)));

console.log("【进项目后仍然正常】");
await gotoApp(page, BASE + "/new", { settle: 1500 });
const created = await page.evaluate(async () => {
  const p = await import("/src/db/repo/projects.ts");
  const proj = await p.createProject({ title: "冒烟" });
  return proj.id;
});
await gotoApp(page, BASE + "/p/" + created + "/overview", { settle: 2200 });
const after = await page.evaluate(() => ({
  bodyLen: document.body.innerText.length,
  hasNav: [...document.querySelectorAll("nav")].some((n) => (n.textContent ?? "").includes("一句话成书")),
}));
check("项目页也能渲染", after.bodyLen > 100, JSON.stringify(after));
check("项目页有导航", after.hasNav === true, JSON.stringify(after));
check("全程没有 5xx", failures.length === 0, JSON.stringify(failures.slice(0, 5)));

console.log("");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
console.log("控制台错误: " + (errs.length ? JSON.stringify(errs.slice(0, 3)) : "NONE"));
await context.close();
process.exit(fail === 0 ? 0 : 1);
