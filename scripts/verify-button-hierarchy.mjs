/**
 * 回归：按钮的主次关系。
 *
 * 用户反馈："很多按钮都变成紫色的了"。
 * 真因不是"按钮变紫"，而是**紫色的用量失衡**：
 * HeroUI 把次级按钮的文字色算成「70% accent + 30% 前景」（--accent-soft-foreground）。
 * 用默认蓝时几乎看不出颜色，换成花椒紫之后，所有 outline / ghost 按钮的文字都成了紫的 ——
 * 概览页的「去写 / 去建立 / 去分卷 / 查看」、世界观的「AI 生成条目」……整页都在喊，
 * 真正的主按钮反而不突出。
 *
 * 现在 --accent-soft-foreground 改成中性前景色。这条回归守住三件事：
 *  ① 主按钮（primary）**必须**是品牌色实心 —— 那是品牌识别；
 *  ② 次级按钮（ghost / outline / secondary）的文字**不能**是品牌色；
 *  ③ 一屏里的实心品牌色按钮数量要有节制（超过 3 个就说明主次不分了）。
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

/** 把 oklch 规范成可比较的 rgb */
const scan = () =>
  page.evaluate(() => {
    const probe = document.createElement("div");
    document.body.appendChild(probe);
    const toRgb = (v) => {
      probe.style.color = v;
      return getComputedStyle(probe).color;
    };
    const cs = getComputedStyle(document.documentElement);
    const accentRgb = toRgb(cs.getPropertyValue("--accent").trim());
    const fgRgb = toRgb(cs.getPropertyValue("--foreground").trim());
    probe.remove();

    const visible = [...document.querySelectorAll("button")].filter((b) => b.offsetParent !== null);
    const solid = visible.filter((b) => getComputedStyle(b).backgroundColor === accentRgb);
    const secondary = visible.filter((b) =>
      /button--(ghost|outline|secondary)/.test(b.className) && (b.textContent ?? "").trim().length > 1,
    );
    const purpleSecondary = secondary.filter((b) => getComputedStyle(b).color === accentRgb);
    const primaryLike = visible.filter((b) => /button--primary/.test(b.className));

    return {
      total: visible.length,
      accentRgb,
      fgRgb,
      solidCount: solid.length,
      solidTexts: solid.map((b) => (b.textContent ?? "").trim().slice(0, 14)),
      secondaryCount: secondary.length,
      purpleSecondary: purpleSecondary.map((b) => (b.textContent ?? "").trim().slice(0, 14)),
      primaryCount: primaryLike.length,
      secondaryColor: secondary[0] ? getComputedStyle(secondary[0]).color : null,
    };
  });

const pid = await page.evaluate(async () => {
  const p = await import("/src/db/repo/projects.ts");
  const proj = await p.createProject({ title: "按钮主次" });
  const o = await import("/src/db/repo/outline.ts");
  await o.createChapter(proj.id, { title: "第一章" });
  const w = await import("/src/db/repo/world.ts");
  await w.createWorldEntry(proj.id, { title: "条目1", category: "magic", body: "x", importance: 3 });
  const c = await import("/src/db/repo/cast.ts");
  await c.createCharacter(proj.id, { name: "沈砚", role: "protagonist" });
  return proj.id;
});

const pages = [
  ["总览", "/p/" + pid + "/overview"],
  ["世界观", "/p/" + pid + "/world"],
  ["人物", "/p/" + pid + "/characters"],
  ["一句话成书", "/p/" + pid + "/genesis"],
  ["拆书仿写", "/p/" + pid + "/blueprint"],
  ["写作分析", "/p/" + pid + "/insights"],
  ["设置", "/settings"],
];

const results = [];
for (const [label, path] of pages) {
  await gotoApp(page, BASE + path, { settle: 2200 });
  const s = await scan();
  results.push({ label, ...s });
  console.log(
    "  " + label.padEnd(12) + " 实心品牌色 " + s.solidCount + " · 次级按钮 " + s.secondaryCount +
    " · 其中紫字 " + s.purpleSecondary.length,
  );
}

console.log("");
const noPurpleSecondary = results.filter((r) => r.purpleSecondary.length > 0);
check(
  "次级按钮（ghost/outline）的文字都不是品牌色",
  noPurpleSecondary.length === 0,
  JSON.stringify(noPurpleSecondary.map((r) => ({ page: r.label, texts: r.purpleSecondary }))),
);
check(
  "次级按钮文字是中性前景色",
  results.every((r) => !r.secondaryColor || r.secondaryColor === r.fgRgb),
  JSON.stringify(results.map((r) => ({ page: r.label, color: r.secondaryColor })).slice(0, 3)),
);
check(
  "主按钮（primary）仍然是品牌色实心",
  results.some((r) => r.primaryCount > 0 && r.solidCount > 0),
  JSON.stringify(results.map((r) => ({ page: r.label, primary: r.primaryCount, solid: r.solidCount }))),
);
const worst = results.reduce((a, b) => (a.solidCount > b.solidCount ? a : b));
check(
  "一屏内的实心品牌色按钮不超过 3 个（主次分明）",
  worst.solidCount <= 3,
  worst.label + " 有 " + worst.solidCount + " 个：" + JSON.stringify(worst.solidTexts),
);
check(
  "概览页的次级动作确实是中性的",
  (results.find((r) => r.label === "总览")?.purpleSecondary.length ?? 0) === 0,
  JSON.stringify(results.find((r) => r.label === "总览")?.purpleSecondary),
);

console.log("");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
console.log("控制台错误: " + (errs.length ? JSON.stringify(errs.slice(0, 3)) : "NONE"));
await context.close();
process.exit(fail === 0 ? 0 : 1);
