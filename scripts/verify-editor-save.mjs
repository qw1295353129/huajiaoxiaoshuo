/**
 * 回归：写作编辑器必须**一个字不丢**地保存。
 *
 * ## 用户报告的 bug
 *
 * "写作编辑器不保存内容，写好的内容，一切换就没了"
 *
 * ## 真因
 *
 * 保存时读的是渲染闭包里的 `draftHtml`，而它是**永远晚一拍**的：
 * 最后一次输入触发的链路是
 *   onChange → setDraftHtml（排队）→ 重新渲染 → 新的 doSave（闭包里有新值）
 * 这条链断在最后一步 —— 新的 doSave 建好了，但**已经没有下一次输入来触发它**。
 * 所以最后一个字永远存不进去；而且之后不再有输入，就永远不会补上。
 *
 * 实测：正文里是「起点甲乙丙丁」，库里是「起点甲乙丙」。
 *
 * ## 修法
 *
 * 保存时直接从编辑器读当前内容（`handle.getContent()`），不经过 React 状态。
 *
 * ## 这条回归守住什么
 *
 * ① 逐字输入的**最后一个字**必须落库（这是最容易回归的点）；
 * ② 不等自动保存就切章，内容也要保住（切章时的清理保存）；
 * ③ 切回来、刷新页面后内容都还在；
 * ④ 空章节不会被写出脏数据。
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
  const proj = await p.createProject({ title: "保存回归" });
  const o = await import("/src/db/repo/outline.ts");
  const c1 = await o.createChapter(proj.id, { title: "第一章" });
  await o.saveChapterContent(c1.id, "<p>起点</p>", { touchStatus: false });
  const c2 = await o.createChapter(proj.id, { title: "第二章" });
  await o.saveChapterContent(c2.id, "<p>起点二</p>", { touchStatus: false });
  return { pid: proj.id, c1: c1.id, c2: c2.id };
});

const snap = () =>
  page.evaluate(async (cid) => {
    const store = (await import("/src/features/editor/editorStore.ts")).useEditorStore;
    const o = await import("/src/db/repo/outline.ts");
    const c = await o.getChapterContent(cid);
    const pm = document.querySelector(".ProseMirror");
    return {
      dirty: store.getState().dirty,
      shown: pm ? pm.innerText.split(String.fromCharCode(10)).join("|") : null,
      saved: c ? c.text : null,
    };
  }, ids.c1);

const type = async (s) => {
  await page.evaluate(() => {
    const pm = document.querySelector(".ProseMirror");
    if (pm) pm.focus();
  });
  await page.keyboard.press("End");
  await page.keyboard.type(s);
};

/**
 * 等自动保存落定（dirty 变回 false）。
 *
 * 不要用固定 sleep：批量跑回归时机器负载高，固定等待会偶发失败
 * （这条测试就曾经在批量里挂过一次，单独跑却总是通过）。
 */
const waitSaved = async (timeoutMs = 15000) => {
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

/**
 * 点章节列表里的某一章。
 *
 * 必须限定在章节列表容器内 —— 项目导航里也有「第二章」这样的项目吗？没有，
 * 但**章节列表项里现在多了一个齿轮按钮**，全页面 find(textContent.includes(...))
 * 很容易命中别的元素（我因此让这条回归假失败过一次）。
 */
const clickChapterInList = (title) =>
  page.evaluate((t) => {
    const list = [...document.querySelectorAll("div")].find(
      (d) => (d.className || "").toString().includes("w-72") && /border-r/.test((d.className || "").toString()),
    );
    const row = [...(list?.querySelectorAll("li") ?? [])].find((li) => (li.textContent ?? "").includes(t));
    const nameBtn = row?.querySelector("button");
    if (nameBtn) {
      nameBtn.click();
      return true;
    }
    return false;
  }, title);

const openFirst = () => gotoApp(page, BASE + "/p/" + ids.pid + "/write/" + ids.c1, { settle: 3000 });

console.log("【逐字输入的最后一个字必须落库】");
await openFirst();
const loaded = await snap();
check("加载后内容正确显示", loaded.shown === "起点", JSON.stringify(loaded));
// 逐字输入：这正是当初丢字最多的场景
await type("甲乙丙丁");
await waitSaved();
const s1 = await snap();
check("正文显示完整", s1.shown?.endsWith("甲乙丙丁") === true, String(s1.shown));
check(
  "落库内容与正文完全一致（最后一个字没丢）",
  s1.saved === s1.shown,
  JSON.stringify({ shown: s1.shown, saved: s1.saved }),
);
check("保存后 dirty 归位", s1.dirty === false, String(s1.dirty));

console.log("【不等自动保存就切章】");
await type("戊己");
await page.waitForTimeout(200); // 远小于自动保存间隔
await clickChapterInList("第二章");
await waitSaved();
const s2 = await snap();
check("切章前的内容被保住", s2.saved?.includes("戊己") === true, JSON.stringify(s2));
check("切章后内容完整（含刚输入的最后一个字）", s2.saved?.endsWith("戊己") === true, String(s2.saved));

console.log("【切回来 / 刷新后都还在】");
await clickChapterInList("第一章");
await waitSaved();
const s3 = await snap();
check("切回来显示正确", s3.shown?.includes("戊己") === true, String(s3.shown));
check("切回来后库内也一致", s3.saved === s3.shown, JSON.stringify({ shown: s3.shown, saved: s3.saved }));

await page.reload({ waitUntil: "domcontentloaded" });
await waitSaved();
const s4 = await page.evaluate(async () => {
  const o = await import("/src/db/repo/outline.ts");
  const p = await import("/src/db/repo/projects.ts");
  const proj = (await p.listProjects())[0];
  const chs = await o.listChapters(proj.id);
  const first = chs.sort((a, b) => a.order - b.order)[0];
  const c = await o.getChapterContent(first.id);
  const pm = document.querySelector(".ProseMirror");
  return { saved: c ? c.text : null, shown: pm ? pm.innerText.split(String.fromCharCode(10)).join("|") : null };
});
check("刷新后库内内容还在", s4.saved?.includes("戊己") === true, String(s4.saved));
check("刷新后编辑器显示正确", s4.shown === s4.saved, JSON.stringify(s4));

console.log("【改动确实会写出去（不是靠缓存）】");
await openFirst();
const before = (await snap()).saved;
await type("！");
await waitSaved();
const after = (await snap()).saved;
check("新输入被写入数据库", after !== before && after?.endsWith("！") === true, JSON.stringify({ before, after }));

console.log("");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
console.log("控制台错误: " + (errs.length ? JSON.stringify(errs.slice(0, 3)) : "NONE"));
await context.close();
process.exit(fail === 0 ? 0 : 1);
