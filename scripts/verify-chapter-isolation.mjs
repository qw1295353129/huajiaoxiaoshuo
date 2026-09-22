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
 * 那段时间任何一次保存都会把新章正文写进旧章 —— 来回切就来回串。
 *
 * 这是我修"保存丢最后一个字"时引入的：让保存改成从编辑器读即时内容之后，
 * 内容变准了，但**没有把内容与它所属的章节绑在一起**。
 *
 * ## 修法
 *
 * `loadedRef = { chapterId, html }` —— 把「这份内容属于哪一章」与内容绑成一份：
 * 保存永远写回内容**自己的**章节；装载新章前先把上一份**冲出去**。
 *
 * ## 这条测试的同步要点（踩过两次）
 *
 * 切章是异步的，断言前必须等**编辑器真正装好目标章**：
 * 光看"包含目标章文字"不够 —— 切换瞬间编辑器里可能还残留着上一章的文字，
 * 于是输入落到了错的章上，表现为"测试说串章了，其实是它自己插错了地方"。
 * 所以要**同时**确认：有目标章的文字 **且** 没有另一章的文字。
 */
import { gotoApp, launchIsolated } from "./lib/browser.mjs";

const BASE = "http://127.0.0.1:5178";
const A_MARK = "甲章的原始内容";
const B_MARK = "乙章的原始内容";

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
  await o.saveChapterContent(a.id, "<p>" + "甲章的原始内容" + "</p>", { touchStatus: false });
  const b = await o.createChapter(proj.id, { title: "乙章" });
  await o.saveChapterContent(b.id, "<p>" + "乙章的原始内容" + "</p>", { touchStatus: false });
  return { pid: proj.id, a: a.id, b: b.id };
});

const readBoth = () =>
  page.evaluate(async ({ a, b }) => {
    const o = await import("/src/db/repo/outline.ts");
    return {
      a: (await o.getChapterContent(a))?.text ?? "",
      b: (await o.getChapterContent(b))?.text ?? "",
    };
  }, ids);

/**
 * 等编辑器真正装好某一章：有它自己的标记，且没有另一章的标记。
 * 后者是关键 —— 少了它，切换瞬间的残留内容会让后续输入落到错的章上。
 */
const waitChapter = (want, avoid, timeoutMs = 25000) =>
  page
    .waitForFunction(
      ({ w, av }) => {
        const pm = document.querySelector(".ProseMirror");
        const t = pm ? pm.innerText : "";
        return t.includes(w) && !t.includes(av);
      },
      { w: want, av: avoid },
      { timeout: timeoutMs },
    )
    .then(() => true)
    .catch(() => false);

const openChapter = async (cid, want, avoid) => {
  await gotoApp(page, BASE + "/p/" + ids.pid + "/write/" + cid, { settle: 800 });
  return waitChapter(want, avoid);
};

/** 点章节列表里的某一章，并等它真正装载完 */
const switchTo = async (rowMarker, want, avoid) => {
  await page.evaluate((m) => {
    const list = [...document.querySelectorAll("div")].find(
      (d) => (d.className || "").toString().includes("w-72") && /border-r/.test((d.className || "").toString()),
    );
    const row = [...(list?.querySelectorAll("li") ?? [])].find((li) => (li.textContent ?? "").includes(m));
    row?.querySelector("button")?.click();
  }, rowMarker);
  return waitChapter(want, avoid);
};

const type = async (s) => {
  await page.evaluate(() => {
    const pm = document.querySelector(".ProseMirror");
    if (pm) pm.focus();
  });
  await page.keyboard.press("End");
  await page.keyboard.type(s);
};

/** 等两章都不再有未保存的编辑 */
const settle = async (timeoutMs = 20000) => {
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
const openedA = await openChapter(ids.a, A_MARK, B_MARK);
check("甲章装载完成（且不含乙章内容）", openedA === true, "超时");
const base = await readBoth();
check("两章初始内容互不相同", base.a.includes(A_MARK) && base.b.includes(B_MARK), JSON.stringify(base));

console.log("【在甲章写字，不等保存就切到乙章】");
await type("-甲1");
const toB = await switchTo("乙章", B_MARK, "甲1");
check("切到乙章后编辑器确实换成了乙章内容", toB === true, "超时或残留");
await type("-乙1");
await settle();

const after = await readBoth();
console.log("  " + JSON.stringify(after));
check("甲章里有甲章写的内容", after.a.includes("-甲1"), JSON.stringify(after));
check("乙章里有乙章写的内容", after.b.includes("-乙1"), JSON.stringify(after));
check("甲章里没有乙章的内容", !after.a.includes("-乙1"), JSON.stringify(after));
check("乙章里没有甲章的内容", !after.b.includes("-甲1"), JSON.stringify(after));
check("甲章保留了原始内容", after.a.includes(A_MARK), JSON.stringify(after));
check("乙章保留了原始内容", after.b.includes(B_MARK), JSON.stringify(after));

console.log("【连切 6 次，越切越乱？】");
for (let i = 0; i < 6; i++) {
  const wantB = i % 2 === 0;
  const ok = wantB ? await switchTo("乙章", B_MARK, A_MARK) : await switchTo("甲章", A_MARK, B_MARK);
  if (!ok) break;
}
await settle();
const churn = await readBoth();
console.log("  " + JSON.stringify(churn));
check("反复切换后甲章未被污染", churn.a.includes(A_MARK) && churn.a.includes("-甲1") && !churn.a.includes("-乙1"), JSON.stringify(churn));
check("反复切换后乙章未被污染", churn.b.includes(B_MARK) && churn.b.includes("-乙1") && !churn.b.includes("-甲1"), JSON.stringify(churn));

console.log("【刷新后仍然各归各】");
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
const afterReload = await readBoth();
check("刷新后甲章仍只属于自己", afterReload.a.includes(A_MARK) && !afterReload.a.includes("-乙1"), JSON.stringify(afterReload));
check("刷新后乙章仍只属于自己", afterReload.b.includes(B_MARK) && !afterReload.b.includes("-甲1"), JSON.stringify(afterReload));

console.log("");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
console.log("控制台错误: " + (errs.length ? JSON.stringify(errs.slice(0, 3)) : "NONE"));
await context.close();
process.exit(fail === 0 ? 0 : 1);
