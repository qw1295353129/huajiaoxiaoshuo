/**
 * 回归：项目内的左侧导航必须在所有页面都在。
 *
 * 用户反馈："打开总览和写作，侧边栏消失了"。
 * 真因：导航原先写死在 PageScaffold 里，于是**只有用了脚手架的页面才有导航**。
 * 总览和写作页没用它（写作页要全宽三栏），进去之后就没法切到别的页面，只能靠浏览器后退。
 *
 * 现在导航抽成 ProjectNav，两处共用。这条回归遍历所有页面确认它在，
 * 并且防住"某个页面漏了导航"这种静默退化 —— 它不会报错，只是用起来很别扭。
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
  const proj = await p.createProject({ title: "导航回归" });
  const o = await import("/src/db/repo/outline.ts");
  const ch = await o.createChapter(proj.id, { title: "第一章" });
  await o.saveChapterContent(ch.id, "<p>正文</p>", { touchStatus: false });
  const w = await import("/src/db/repo/world.ts");
  await w.createWorldEntry(proj.id, { title: "条目1", category: "magic", body: "x", importance: 3 });
  const c = await import("/src/db/repo/cast.ts");
  await c.createCharacter(proj.id, { name: "沈砚", role: "protagonist" });
  return proj.id;
});

/** 读出导航状态：是否存在可见的导航、有多少项、能否点到别处 */
const readNav = () =>
  page.evaluate(() => {
    // 导航的特征：包含「一句话成书」这类跨页链接的 nav
    const navs = [...document.querySelectorAll("nav")].filter((n) => n.offsetParent !== null);
    const nav = navs.find((n) => (n.textContent ?? "").includes("一句话成书"));
    if (!nav) return { present: false, links: 0, labels: [] };
    const links = [...nav.querySelectorAll("a")];
    return {
      present: true,
      width: Math.round(nav.getBoundingClientRect().width),
      links: links.length,
      labels: links.map((a) => (a.textContent ?? "").trim()).slice(0, 30),
      hasLibraryLink: /我的作品|导航回归/.test(nav.textContent ?? ""),
      hasNewProject: (nav.textContent ?? "").includes("新建作品"),
      hasSettings: (nav.textContent ?? "").includes("设置"),
      // 「我的作品 / 新建作品」必须排在「创作」分组之前
      topOrderOk: (() => {
        const t = nav.textContent ?? "";
        const my = t.indexOf("我的作品");
        const nw = t.indexOf("新建作品");
        const writing = t.indexOf("创作");
        return my >= 0 && nw > my && (writing < 0 || writing > nw);
      })(),
    };
  });

const pages = [
  ["总览", "/p/" + pid + "/overview"],
  ["写作", "/p/" + pid + "/write"],
  ["大纲", "/p/" + pid + "/outline"],
  ["人物", "/p/" + pid + "/characters"],
  ["世界观", "/p/" + pid + "/world"],
  ["一句话成书", "/p/" + pid + "/genesis"],
  ["拆书仿写", "/p/" + pid + "/blueprint"],
  ["写作分析", "/p/" + pid + "/insights"],
  ["审稿台", "/p/" + pid + "/review"],
];

const results = [];
for (const [label, path] of pages) {
  await gotoApp(page, BASE + path, { settle: 2300 });
  const nav = await readNav();
  results.push({ label, ...nav });
  console.log("  " + label.padEnd(12) + (nav.present ? "有导航 · " + nav.links + " 项 · 宽 " + nav.width : "没有导航"));
}

const missing = results.filter((r) => !r.present);
check("所有项目页都有左侧导航", missing.length === 0, "缺失：" + JSON.stringify(missing.map((m) => m.label)));
check("总览页有导航（用户报告的问题）", results.find((r) => r.label === "总览")?.present === true, "");
check("写作页有导航（用户报告的问题）", results.find((r) => r.label === "写作")?.present === true, "");
check("导航里能回到我的作品", results.every((r) => r.hasLibraryLink), "");
check("导航里有新建作品入口", results.every((r) => r.hasNewProject), "");
check("我的作品/新建作品 在创作分组之上", results.every((r) => r.topOrderOk), JSON.stringify(results.filter((r) => !r.topOrderOk).map((r) => r.label)));
check("导航里有设置入口", results.every((r) => r.hasSettings), "");
check("各页导航项数量一致（不会某页漏项）", new Set(results.map((r) => r.links)).size === 1, JSON.stringify(results.map((r) => ({ p: r.label, n: r.links }))));

console.log("【写作页的额外检查】");
await gotoApp(page, BASE + "/p/" + pid + "/write", { settle: 2500 });
const editor = await page.evaluate(() => {
  const navs = [...document.querySelectorAll("nav")].filter((n) => n.offsetParent !== null);
  const projectNav = navs.find((n) => (n.textContent ?? "").includes("一句话成书"));
  // 章节目录的根元素是 div（不是 nav），且折叠/展开两种宽度：
  // 展开 w-72，折叠成 w-14 的图标条。用宽度特征判断，别用标签名 ——
  // 我第一版按 nav 找，结果把"找到了"误判成"没有"。
  const chapterPane = [...document.querySelectorAll("div")].find((d) => {
    const cls = (d.className || "").toString();
    return d.offsetParent !== null && /\bw-(72|14)\b/.test(cls) && /border-r/.test(cls);
  });
  return {
    projectNav: Boolean(projectNav),
    chapterNav: Boolean(chapterPane),
    chapterNavWidth: chapterPane ? Math.round(chapterPane.getBoundingClientRect().width) : null,
    hasCanvas: Boolean(document.querySelector(".ProseMirror")),
  };
});
check("写作页同时有项目导航与章节目录", editor.projectNav && editor.chapterNav, JSON.stringify(editor));
check("章节目录宽度正常（展开 288 / 折叠 56）", editor.chapterNavWidth === 288 || editor.chapterNavWidth === 56, String(editor.chapterNavWidth));
check("正文编辑器仍然正常渲染", editor.hasCanvas === true, JSON.stringify(editor));

console.log("【心流模式下导航让位】");
const flow = await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => (x.title ?? "").includes("心流") || (x.getAttribute("aria-label") ?? "").includes("心流"));
  if (b) { b.click(); return true; }
  return false;
});
if (flow) {
  await page.waitForTimeout(1200);
  const inFlow = await readNav();
  check("心流模式下隐藏导航（专注写作）", inFlow.present === false, JSON.stringify(inFlow));
} else {
  console.log("  （没找到心流按钮，跳过）");
}

console.log("");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
console.log("控制台错误: " + (errs.length ? JSON.stringify(errs.slice(0, 3)) : "NONE"));
await context.close();
process.exit(fail === 0 ? 0 : 1);
