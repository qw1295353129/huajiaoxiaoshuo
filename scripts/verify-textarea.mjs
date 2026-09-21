/**
 * 回归：输入框宽度。
 *
 * HeroUI 的 .textarea 基础样式是 display:inline-block 且没有 width，
 * 宽度由浏览器按默认 cols≈20 算出（实测 161px），在侧栏里窄到读不了。
 * 这类问题**不会报错**，只能靠量尺寸发现，所以专门做一条回归。
 *
 * 判定标准：textarea 宽度应当接近其父容器内容宽度（减 padding），
 * 而不是明显小于它。
 */
import { gotoApp, launchIsolated } from "./lib/browser.mjs";

const BASE = "http://127.0.0.1:5178";
const context = await launchIsolated(import.meta.url, { viewport: { width: 1512, height: 945 } });
const page = context.pages()[0] ?? (await context.newPage());
const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 140)));

let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (x ? "  → " + x : "")); } };

/** 量出页面里所有 textarea 的宽度与父容器内容宽度 */
const measure = () => {
  const out = [];
  for (const t of document.querySelectorAll("textarea")) {
    const rect = t.getBoundingClientRect();
    if (rect.width === 0) continue; // 隐藏的元素跳过
    const parent = t.parentElement;
    const pr = parent?.getBoundingClientRect();
    const pcs = parent ? getComputedStyle(parent) : null;
    const pad = pcs ? parseFloat(pcs.paddingLeft) + parseFloat(pcs.paddingRight) : 0;
    const avail = pr ? pr.width - pad : 0;
    out.push({
      // 是否 HeroUI 组件：它一定会带 .textarea 基础类
      isHeroUI: t.classList.contains("textarea"),
      w: Math.round(rect.width),
      avail: Math.round(avail),
      // 允许 2px 误差；不足 90% 视为没撑满
      ratio: avail > 0 ? Math.round((rect.width / avail) * 100) : 0,
      placeholder: (t.getAttribute("placeholder") ?? "").slice(0, 22),
      display: getComputedStyle(t).display,
    });
  }
  return out;
};

await gotoApp(page, BASE + "/");
const pid = await page.evaluate(async () => {
  const p = await import("/src/db/repo/projects.ts");
  const proj = await p.createProject({ title: "输入框回归" });
  const o = await import("/src/db/repo/outline.ts");
  const ch = await o.createChapter(proj.id, { title: "第一章 测试" });
  await o.saveChapterContent(ch.id, "<p>雨下了整夜。</p><p>沈砚掀开白布。</p>", { touchStatus: false });
  const c = await import("/src/db/repo/cast.ts");
  await c.createCharacter(proj.id, { name: "沈砚", role: "protagonist", tagline: "验尸官" });
  const w = await import("/src/db/repo/world.ts");
  await w.createWorldEntry(proj.id, { title: "雾港", category: "custom", body: "北方港口。", importance: 3 });
  return proj.id;
});

const pages = [
  ["写作台", BASE + "/p/" + pid + "/write"],
  ["章节设置", null], // 由写作台里点开，单独处理
  ["大纲", BASE + "/p/" + pid + "/outline"],
  ["人物", BASE + "/p/" + pid + "/characters"],
  ["世界观", BASE + "/p/" + pid + "/world"],
  ["一句话成书", BASE + "/p/" + pid + "/genesis"],
  ["新建项目", BASE + "/new"],
  ["设置", BASE + "/settings"],
  ["设置-记忆", BASE + "/settings?tab=memory"],
  ["设置-档案", BASE + "/settings?tab=profile"],
];

const all = [];
for (const [label, url] of pages) {
  if (!url) continue;
  await gotoApp(page, url, { settle: 2200 });
  const list = await page.evaluate(measure);
  for (const item of list) all.push({ page: label, ...item });
  if (list.length) {
    const worst = list.reduce((a, b) => (a.ratio < b.ratio ? a : b));
    console.log("  " + label + ": " + list.length + " 个输入框，最窄填充率 " + worst.ratio + "%");
  } else {
    // 没量到东西时要说清楚是"页面没渲染"还是"页面真没有输入框"，否则只能干瞪眼
    const diag = await page.evaluate(() => ({
      textareas: document.querySelectorAll("textarea").length,
      bodyLen: document.body.innerText.length,
      url: location.pathname + location.search,
      head: document.body.innerText.slice(0, 60).replace(/\n/g, " "),
    }));
    console.log("  " + label + ": 0 个 → " + JSON.stringify(diag));
  }
}

check("所有输入框都存在（能测到东西）", all.length > 0, "共 " + all.length + " 个");
const tooNarrow = all.filter((x) => x.ratio < 90 && x.avail > 120);
check("没有明显偏窄的输入框（填充率 < 90%）", tooNarrow.length === 0, JSON.stringify(tooNarrow.slice(0, 4)));
// 注意：不能断言"display 必须是 block"。项目里有几处是自写的原生 textarea（带 w-full），
// 它们是 inline-block 但宽度本来就 100%，属于正常。判据只能是"有没有撑满"。
check(
  "HeroUI 的 .textarea 都是 block 布局",
  all.filter((x) => x.isHeroUI).every((x) => x.display === "block"),
  JSON.stringify(all.filter((x) => x.isHeroUI && x.display !== "block").slice(0, 3)),
);
const natives = all.filter((x) => !x.isHeroUI);
console.log("  其中原生 textarea " + natives.length + " 个（项目自写样式，宽度本已 100%）");
console.log("  共测 " + all.length + " 个输入框，填充率范围 " + Math.min(...all.map((x) => x.ratio)) + "% ~ " + Math.max(...all.map((x) => x.ratio)) + "%");

console.log("【写作台里的 AI 面板输入框（截图里的那个）】");
await gotoApp(page, BASE + "/p/" + pid + "/write", { settle: 3000 });
const editorTas = await page.evaluate(measure);
check("写作台有输入框", editorTas.length > 0, JSON.stringify(editorTas));
const worstEditor = editorTas.reduce((a, b) => (a.ratio < b.ratio ? a : b), editorTas[0]);
check("写作台的输入框撑满了容器", (worstEditor?.ratio ?? 0) >= 90, JSON.stringify(worstEditor));
check("宽度不再是 161px 那种固有宽度", (worstEditor?.w ?? 0) > 250, String(worstEditor?.w));

console.log("");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
console.log("控制台错误: " + (errs.length ? JSON.stringify(errs.slice(0, 4)) : "NONE"));
await context.close();
process.exit(fail === 0 ? 0 : 1);
