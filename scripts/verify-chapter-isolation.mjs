/**
 * 回归：章节之间绝不能串内容。
 *
 * ## 用户报告的症状
 *
 * "写作编辑器怎么这么卡，切换章节的时候，我在章节一的内容突然跑到其他章节，
 *   再切换就消失了，切回章节一内容又没了，过一会又突然出现了。"
 *
 * ## 真因
 *
 * 切章时新章节的数据是异步取回来的（useLiveQuery），中间有一小段空窗：
 * **store 里的 chapterId 还是旧章，而编辑器里已经是新章的内容**。
 * 那段时间任何一次保存都会把新章的正文写进旧章 —— 来回切就来回串。
 *
 * 这是我修"保存丢最后一个字"时引入的：让保存改成从编辑器读即时内容之后，
 * 内容变准了，但**没有把内容与它所属的章节绑在一起**。
 *
 * ## 修法
 *
 * 用 `loadedRef = { chapterId, html }` 把「这份内容属于哪一章」和内容绑在一起：
 * 保存永远写回内容**自己的**章节；装载新章前先把上一份**冲出去**（未保存的编辑不丢）。
 *
 * 这条回归守住：反复切换后，两章的内容都只属于自己。
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
  const proj = await p.createProject({ title: "串章回归" });
  const o = await import("/src/db/repo/outline.ts");
  const a = await o.createChapter(proj.id, { title: "甲章" });
  await o.saveChapterContent(a.id, "<p>甲章的原始内容</p>", { touchStatus: false });
  const b = await o.createChapter(proj.id, { title: "乙章" });
  await o.saveChapterContent(b.id, "<p>乙章的原始内容</p>", { touchStatus: false });
  return { pid: proj.id, a: a.id, b: b.id };
});

/** 直接读两章的库内内容 */
const readBoth = () =>
  page.evaluate(async ({ a, b }) => {
    const o = await import("/src/db/repo/outline.ts");
    const ca = await o.getChapterContent(a);
    const cb = await o.getChapterContent(b);
    return { a: ca ? ca.text : "", b: cb ? cb.text : "" };
  }, ids);

const openChapter = (cid) => gotoApp(page, BASE + "/p/" + ids.pid + "/write/" + cid, { settle: 2600 });

const type = async (s) => {
  await page.evaluate(() => {
    const pm = document.querySelector(".ProseMirror");
    if (pm) pm.focus();
  });
  await page.keyboard.press("End");
  await page.keyboard.type(s);
};

/** 等两章都不再有未保存的编辑 */
const settle = async (timeoutMs = 15000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const dirty = await page.evaluate(async () => {
      const store = (await import("/src/features/editor/editorStore.ts")).useEditorStore;
      return store.getState().dirty;
    });
    if (!dirty) return true;
    await page.waitForTimeout(300);
  }
  return false;
};

console.log("【基线】");
await openChapter(ids.a);
const base = await readBoth();
check("两章初始内容互不相同", base.a.includes("甲章的原始内容") && base.b.includes("乙章的原始内容"), JSON.stringify(base));

console.log("【在甲章写字，然后快速来回切换】");
await type("-甲1");
// 不等自动保存，立刻切（这正是出问题的时机）
await page.evaluate(() => {
  const list = [...document.querySelectorAll("div")].find(
    (d) => (d.className || "").toString().includes("w-72") && /border-r/.test((d.className || "").toString()),
  );
  const row = [...(list?.querySelectorAll("li") ?? [])].find((li) => (li.textContent ?? "").includes("乙章"));
  row?.querySelector("button")?.click();
});
await page.waitForTimeout(1800);
await type("-乙1");
await page.evaluate(() => {
  const list = [...document.querySelectorAll("div")].find(
    (d) => (d.className || "").toString().includes("w-72") && /border-r/.test((d.className || "").toString()),
  );
  const row = [...(list?.querySelectorAll("li") ?? [])].find((li) => (li.textContent ?? "").includes("甲章"));
  row?.querySelector("button")?.click();
});
await page.waitForTimeout(1800);
await settle();

const after = await readBoth();
console.log("  " + JSON.stringify(after));
check("甲章里有甲章写的内容", after.a.includes("-甲1"), JSON.stringify(after));
check("乙章里有乙章写的内容", after.b.includes("-乙1"), JSON.stringify(after));
check("甲章里**没有**乙章的内容（不串章）", !after.a.includes("-乙1"), JSON.stringify(after));
check("乙章里**没有**甲章的内容（不串章）", !after.b.includes("-甲1"), JSON.stringify(after));
check("两章都保留了自己的原始内容", after.a.includes("甲章的原始内容") && after.b.includes("乙章的原始内容"), JSON.stringify(after));

console.log("【连切 6 次，检查是否越切越乱】");
// 注意：循环变量要**传进去**，page.evaluate 的函数体在浏览器里执行，看不到闭包
const clickChapterByIndex = (wantSecond) =>
  page.evaluate((second) => {
    const list = [...document.querySelectorAll("div")].find(
      (d) => (d.className || "").toString().includes("w-72") && /border-r/.test((d.className || "").toString()),
    );
    const rows = [...(list?.querySelectorAll("li") ?? [])];
    const target = rows[second ? 1 : 0];
    const btn = target?.querySelector("button");
    if (btn) { btn.click(); return true; }
    return false;
  }, wantSecond);

for (let i = 0; i < 6; i++) {
  await clickChapterByIndex(i % 2 === 0);
  await page.waitForTimeout(1000);
}
await settle();
const churn = await readBoth();
console.log("  " + JSON.stringify(churn));
check("反复切换后甲章内容未被污染", churn.a.includes("甲章的原始内容") && churn.a.includes("-甲1") && !churn.a.includes("-乙1"), JSON.stringify(churn));
check("反复切换后乙章内容未被污染", churn.b.includes("乙章的原始内容") && churn.b.includes("-乙1") && !churn.b.includes("-甲1"), JSON.stringify(churn));
check("两章内容都不为空", churn.a.length > 0 && churn.b.length > 0, JSON.stringify(churn));

console.log("【刷新后仍然各归各】");
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(3500);
const afterReload = await readBoth();
check("刷新后甲章仍只属于自己", afterReload.a.includes("甲章的原始内容") && !afterReload.a.includes("-乙1"), JSON.stringify(afterReload));
check("刷新后乙章仍只属于自己", afterReload.b.includes("乙章的原始内容") && !afterReload.b.includes("-甲1"), JSON.stringify(afterReload));

console.log("");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
console.log("控制台错误: " + (errs.length ? JSON.stringify(errs.slice(0, 3)) : "NONE"));
await context.close();
process.exit(fail === 0 ? 0 : 1);
