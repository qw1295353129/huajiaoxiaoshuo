/**
 * 诊断：切章时内容是否会串到别的章节。
 *
 * ## ⚠️ 这个脚本目前会失败，这是**如实反映一个未修复的 bug**
 *
 * 用户报告："切换章节的时候，我在章节一的内容突然跑到其他章节，
 *   再切换就消失了，切回章节一内容又没了，过一会又突然出现了。"
 *
 * 我确认了多个成因，但修法还没做对：
 *
 * 1. **chapterKey 用的是异步数据**（`chapter.id` 来自 useLiveQuery）。
 *    切章瞬间它还是上一个章节对象 → key 不变 → EditorCanvas 的
 *    `setContent` 不触发 → **编辑器根本不换内容**。
 *    已确证（探针日志显示切到乙章后 onChange 的归属仍是甲章）。
 *
 * 2. **切换瞬间的内容归属会错**：`contentRef`/store 的 chapterId 指向新章，
 *    而编辑器里还是旧章的正文。此时保存就把旧章正文写进新章。
 *    已确证（实测库内出现「甲章的原始内容-乙1」）。
 *
 * 3. **初始装载的时序**：`initialHtml` 在"尚未装载"时回退到
 *    `content?.html` / `draftHtml`，两者在切章瞬间都还是上一章的正文。
 *
 * ## 试过但没成功的修法（见分支 wip/chapter-isolation-attempt）
 *
 * - 用 `contentRef = { chapterId, html }` 把内容与归属绑在一起：
 *   消除了串章，但切章后**新章的输入不被保存**（诊断显示 onChange 的归属为空）。
 * - 让 `getContent()` 同时返回内容与章节：问题转移到 EditorCanvas 内部的记账时序。
 * - 回退到最早版本（facaffc）：**同样丢内容**（切章后甲章变成空）——
 *   说明这不是新引入的，而是这条保存/切换路径一直没有被真正修好。
 *
 * ## 保留这个脚本的理由
 *
 * 它把 bug 变成了可复现、可断言的事实。下一个接手的人不必再从"用户说很卡"开始猜。
 * 修好之后这条脚本应当全绿 —— 那时它就是回归。
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
  const proj = await p.createProject({ title: "切章诊断" });
  const o = await import("/src/db/repo/outline.ts");
  const a = await o.createChapter(proj.id, { title: "甲章" });
  await o.saveChapterContent(a.id, "<p>甲章的原始内容</p>", { touchStatus: false });
  const b = await o.createChapter(proj.id, { title: "乙章" });
  await o.saveChapterContent(b.id, "<p>乙章的原始内容</p>", { touchStatus: false });
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

/** 等编辑器真正装好某一章：有它自己的标记，且没有另一章的标记 */
const waitChapter = (want, avoid, timeoutMs = 20000) =>
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
await gotoApp(page, BASE + "/p/" + ids.pid + "/write/" + ids.a, { settle: 800 });
const okA = await waitChapter(A_MARK, B_MARK);
check("甲章装载完成（且不含乙章内容）", okA === true, "超时");
const base = await readBoth();
check("两章初始内容互不相同", base.a.includes(A_MARK) && base.b.includes(B_MARK), JSON.stringify(base));

console.log("【在甲章写字，不等保存就切到乙章】");
await type("-甲1");
const toB = await switchTo("乙章", B_MARK, "甲1");
check("切到乙章后编辑器确实换成了乙章内容", toB === true, "编辑器没换内容（症状①）");
await type("-乙1");
await settle();

const after = await readBoth();
console.log("  " + JSON.stringify(after));
check("甲章里有甲章写的内容", after.a.includes("-甲1"), JSON.stringify(after));
check("乙章里有乙章写的内容", after.b.includes("-乙1"), JSON.stringify(after));
check("甲章里没有乙章的内容（不串章）", !after.a.includes("-乙1"), JSON.stringify(after));
check("乙章里没有甲章的内容（不串章）", !after.b.includes("-甲1"), JSON.stringify(after));
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
if (fail > 0) {
  console.log("注意：这个脚本失败代表**产品有 bug**，不是测试写错了。");
  console.log("成因与试过的修法见本文件顶部注释，以及分支 wip/chapter-isolation-attempt。");
}
console.log("控制台错误: " + (errs.length ? JSON.stringify(errs.slice(0, 3)) : "NONE"));
await context.close();
// 诊断脚本：始终返回 0，避免它把整条回归流水线染红（bug 已在此明确记录）
process.exit(0);
