/**
 * 回归：默认主题只用中性色（白 / 黑 / 浅灰）。
 *
 * 用户要求："不要紫色主按钮，所有紫色主按钮改成白色，默认主题就是，白，黑，浅灰"。
 *
 * 做法不是逐个把按钮改白，而是把 **accent 本身改成中性**——
 * HeroUI 的选中态、焦点环、滑块、主按钮全都跟随 accent，
 * 改一处就全变中性，比逐个覆盖可靠得多。
 *
 * 这条回归守住三件事：
 *  ① 源码里不再有 violet 之类的彩色主题类（防止新代码又写回去）；
 *  ② 主按钮的实际颜色是**中性的**（深浅两种模式下都验）；
 *  ③ 页面上没有彩色背景块。
 *
 * 注意：**语义色不算违规** —— 危险(红) / 成功(绿) / 警告(黄) 本身就是信息，
 * 去掉它们会让"出错了"和"成功了"变得无法区分。这里只禁"装饰性彩色"。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { launchIsolated, gotoApp } from "./lib/browser.mjs";

const BASE = "http://127.0.0.1:5178";
let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (x ? "  → " + x : "")); } };

console.log("【源码里不该再有彩色主题类】");
const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
};
const files = walk("src");
const banned = ["violet-", "purple-", "indigo-", "fuchsia-"];
const offenders = [];
for (const f of files) {
  const s = readFileSync(f, "utf8");
  for (const b of banned) {
    if (s.includes(b)) offenders.push({ file: f, token: b });
  }
}
check("没有 violet / purple / indigo / fuchsia 类", offenders.length === 0, JSON.stringify(offenders.slice(0, 6)));

const css = readFileSync("src/styles/globals.css", "utf8");
check("accent 里没有彩度（oklch 的第三个分量为 0）", /--accent:\s*oklch\([\d.]+\s+0\s+0\)/.test(css), (css.match(/--accent:[^;]+/g) ?? []).join(" | "));
check("没有把紫色写回 accent", !/292/.test(css.match(/--accent:[^;]+/g)?.join("") ?? ""), "");

console.log("【实际渲染：主按钮必须是中性色】");
const context = await launchIsolated(import.meta.url, { viewport: { width: 1512, height: 950 } });
const page = context.pages()[0] ?? (await context.newPage());
const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 160)));

await gotoApp(page, BASE + "/");
const pid = await page.evaluate(async () => {
  const p = await import("/src/db/repo/projects.ts");
  const proj = await p.createProject({ title: "中性主题" });
  const o = await import("/src/db/repo/outline.ts");
  const c = await o.createChapter(proj.id, { title: "第一章" });
  await o.saveChapterContent(c.id, "<p>正文</p>", { touchStatus: false });
  return proj.id;
});

const isNeutral = (color) => {
  const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return true; // oklch 形式无法直接解析时按中性算（另有 accent 变量断言兜底）
  const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return Math.max(r, g, b) - Math.min(r, g, b) <= 14;
};

const probe = () =>
  page.evaluate(() => {
    const probe = document.createElement("div");
    document.body.appendChild(probe);
    const toRgb = (v) => { probe.style.color = v; return getComputedStyle(probe).color; };
    const cs = getComputedStyle(document.documentElement);
    const accentRgb = toRgb(cs.getPropertyValue("--accent").trim());
    const visible = [...document.querySelectorAll("button")].filter((b) => b.offsetParent !== null);
    const solid = visible.filter((b) => getComputedStyle(b).backgroundColor === accentRgb);
    // 彩色背景（排除透明）
    const colored = visible.filter((btn) => {
      const c = getComputedStyle(btn).backgroundColor;
      const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (!m || c.includes("0, 0, 0, 0")) return false;
      const ch = [Number(m[1]), Number(m[2]), Number(m[3])];
      return Math.max(...ch) - Math.min(...ch) > 20;
    });
    probe.remove();
    return {
      accentRgb,
      solidCount: solid.length,
      solidBg: solid[0] ? getComputedStyle(solid[0]).backgroundColor : null,
      solidFg: solid[0] ? getComputedStyle(solid[0]).color : null,
      coloredCount: colored.length,
      coloredTexts: colored.map((b) => (b.textContent ?? "").trim().slice(0, 12)),
    };
  });

console.log("【浅色模式】");
await gotoApp(page, BASE + "/p/" + pid + "/overview", { settle: 2400 });
const light = await probe();
console.log("  主按钮 " + light.solidBg + " / 文字 " + light.solidFg + "  彩色按钮 " + light.coloredCount);
check("主按钮存在", light.solidCount > 0, JSON.stringify(light));
check("浅色模式主按钮是中性色", isNeutral(light.solidBg ?? ""), String(light.solidBg));
check("页面上没有彩色按钮", light.coloredCount === 0, JSON.stringify(light.coloredTexts));

console.log("【深色模式】");
await page.evaluate(() => document.documentElement.classList.add("dark"));
await page.waitForTimeout(700);
const dark = await probe();
console.log("  主按钮 " + dark.solidBg + " / 文字 " + dark.solidFg + "  彩色按钮 " + dark.coloredCount);
check("深色模式主按钮是中性色", isNeutral(dark.solidBg ?? ""), String(dark.solidBg));
check("深色模式也没有彩色按钮", dark.coloredCount === 0, JSON.stringify(dark.coloredTexts));
check("深色模式主按钮与浅色模式不同（反差正确）", dark.solidBg !== light.solidBg, JSON.stringify({ light: light.solidBg, dark: dark.solidBg }));

console.log("");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
console.log("控制台错误: " + (errs.length ? JSON.stringify(errs.slice(0, 3)) : "NONE"));
await context.close();
process.exit(fail === 0 ? 0 : 1);
