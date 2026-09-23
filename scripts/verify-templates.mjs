/**
 * 回归：新建作品的内置小说模板库。
 *
 * 要求：分类可筛、搜索可用、选中能带出 logline/体裁/篇幅/视角。
 */
import { gotoApp, launchIsolated } from "./lib/browser.mjs";

const BASE = "http://127.0.0.1:5178";
const context = await launchIsolated(import.meta.url, { viewport: { width: 1400, height: 1000 } });
const page = context.pages()[0] ?? (await context.newPage());
const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 180)));

let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (x ? "  → " + x : "")); } };

console.log("【模板库在新建页可见】");
await gotoApp(page, BASE + "/new", { settle: 2500 });
const boot = await page.evaluate(() => {
  const text = document.body.innerText;
  const chips = [...document.querySelectorAll("button")].map((b) => (b.textContent ?? "").trim());
  return {
    hasSection: text.includes("创作模板"),
    hasSearch: Boolean(document.querySelector('input[placeholder*="搜索"]')),
    hasAll: chips.some((c) => c === "全部"),
    hasXuanhuan: chips.some((c) => c === "玄幻仙侠"),
    cardCount: [...document.querySelectorAll("button")].filter((b) => (b.textContent ?? "").includes(" logline") || (b.textContent ?? "").match(/·/)).length,
    // 卡片特征：含 emoji + 名称 + 标签
    sampleCards: [...document.querySelectorAll("button")]
      .map((b) => (b.textContent ?? "").trim())
      .filter((t) => t.includes("·") && t.length > 10 && t.length < 200)
      .slice(0, 3),
  };
});
check("新建页有创作模板区", boot.hasSection, JSON.stringify(boot));
check("有搜索框", boot.hasSearch, "");
check("有全部/玄幻仙侠分类", boot.hasAll && boot.hasXuanhuan, "");
check("默认展示多张模板卡", boot.sampleCards.length >= 2, JSON.stringify(boot.sampleCards));

console.log("【分类筛选】");
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => (x.textContent ?? "").trim() === "悬疑智斗");
  b?.click();
});
await page.waitForTimeout(300);
const mystery = await page.evaluate(() => {
  const cards = [...document.querySelectorAll("button")]
    .map((b) => (b.textContent ?? "").trim())
    .filter((t) => t.includes("·") && t.length > 10 && t.length < 200);
  return cards;
});
check("悬疑分类下有模板", mystery.length >= 1, JSON.stringify(mystery.slice(0, 2)));
check("悬疑分类结果不含明显玄幻卡", !mystery.some((t) => t.includes("仙武帝尊")), JSON.stringify(mystery));

console.log("【搜索】");
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => (x.textContent ?? "").trim() === "全部");
  b?.click();
});
const search = await page.$('input[placeholder*="搜索"]');
if (search) {
  await search.fill("机甲");
  await page.waitForTimeout(300);
  const hits = await page.evaluate(() =>
    [...document.querySelectorAll("button")]
      .map((b) => (b.textContent ?? "").trim())
      .filter((t) => t.includes("机甲")),
  );
  check("搜索「机甲」命中模板", hits.length >= 1, JSON.stringify(hits));
} else {
  check("搜索框存在", false, "找不到搜索输入");
}

console.log("【选中模板带出字段】");
// 先点「全部」并用 React 可达的方式清空搜索（fill 有时不触发受控 onChange）
await page.evaluate(() => {
  const all = [...document.querySelectorAll("button")].find((x) => (x.textContent ?? "").trim() === "全部");
  all?.click();
  const el = [...document.querySelectorAll("input")].find((i) => (i.placeholder ?? "").includes("搜索"));
  if (el) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(el, "");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
});
await page.waitForTimeout(350);
// 点一张明确的卡：直播种地
const clickedCard = await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => (x.textContent ?? "").includes("直播种地"));
  if (!b) return false;
  b.click();
  return true;
});
check("能找到并点击模板卡", clickedCard === true, "");
await page.waitForTimeout(400);
const filled = await page.evaluate(() => {
  const textareas = [...document.querySelectorAll("textarea")];
  const inputs = [...document.querySelectorAll("input")];
  const logline = textareas.map((t) => t.value).find((v) => v.includes("直播") || v.includes("种地")) ?? "";
  const title = inputs.map((i) => i.value).find((v) => v.includes("直播") || v === "直播种地") ?? "";
  // 体裁 chip 选中态：accent 色或含勾
  const body = document.body.innerText;
  return { logline, title, hasClear: body.includes("清除选择") };
});
check("选中后出现清除选择", filled.hasClear, JSON.stringify(filled));
check("一句话故事被带出", filled.logline.length > 5, filled.logline.slice(0, 60));
check("书名被预填", filled.title.length > 0, filled.title);

console.log("");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
console.log("控制台错误: " + (errs.length ? JSON.stringify(errs.slice(0, 3)) : "NONE"));
await context.close();
process.exit(fail === 0 ? 0 : 1);
