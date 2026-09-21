/** 审稿功能端到端：批注锚定、正文标记渲染、修订建议接受/拒绝、锚点漂移重定位。 */
import { launchIsolated } from "./lib/browser.mjs";
const BASE = "http://127.0.0.1:5178";
const context = await launchIsolated(import.meta.url, { viewport: { width: 1512, height: 945 } });
const page = context.pages()[0] ?? (await context.newPage());
const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 160)));
page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("favicon")) errs.push(m.text().slice(0, 160)); });
let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log("  \u2713 " + n); } else { fail++; console.log("  \u2717 " + n + (x ? "  \u2192 " + x : "")); } };

// 建项目 + 一章正文
await page.goto(BASE + "/new", { waitUntil: "networkidle" });
await page.waitForTimeout(700);
await page.fill('input[placeholder*="长夜将至"]', "审稿验证");
await page.click("text=先创建空白项目");
await page.waitForTimeout(2500);
const pid = (page.url().match(/\/p\/([^/]+)/) ?? [])[1];
const chId = await page.evaluate(async (id) => {
  const o = await import("/src/db/repo/outline.ts");
  const c = await o.createChapter(id, { title: "第一章 雨夜" });
  await o.saveChapterContent(c.id, "<p>雨下了整夜。</p><p>沈砚掀开白布的时候，死者张了张嘴。他听见了自己的名字。</p>", { touchStatus: false });
  return c.id;
}, pid);

// 直接经仓储层造一条锚定批注与一条修订建议
const seeded = await page.evaluate(async ({ pid, chId }) => {
  const r = await import("/src/db/repo/review.ts");
  const a = await import("/src/utils/anchor.ts");
  const o = await import("/src/db/repo/outline.ts");
  const text = (await o.getChapterContent(chId)).text;
  const q1 = "死者张了张嘴";
  const i1 = text.indexOf(q1);
  const c1 = await r.addComment({ projectId: pid, chapterId: chId, body: "这里可以再具体一点：他张嘴是要说什么？", anchor: a.makeAnchor(text, i1, i1 + q1.length) });
  const q2 = "他听见了自己的名字";
  const i2 = text.indexOf(q2);
  const s1 = await r.addReviewSuggestion({ projectId: pid, chapterId: chId, kind: "replace", anchor: a.makeAnchor(text, i2, i2 + q2.length), proposed: "那三个字从他自己喉咙里滚出来", reason: "让钩子更狠", source: "ai" });
  return { textLen: text.length, commentId: c1.id, suggestionId: s1.id, i1, i2, quote: text.slice(i2, i2 + q2.length) };
}, { pid, chId });
console.log("造数据: " + JSON.stringify({ textLen: seeded.textLen, i1: seeded.i1, i2: seeded.i2 }));

// 打开写作台
await page.goto(BASE + "/p/" + pid + "/write/" + chId, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);

console.log("【正文标记渲染】");
// 审稿标记依赖正文加载完成后再下发，等它稳定（最多 8 秒）
let marks = { comment: 0, replace: 0, commentText: "", replaceText: "" };
for (let i = 0; i < 16; i++) {
  marks = await page.evaluate(() => ({
    comment: document.querySelectorAll(".hj-review--comment").length,
    replace: document.querySelectorAll(".hj-review--replace").length,
    commentText: document.querySelector(".hj-review--comment")?.textContent ?? "",
    replaceText: document.querySelector(".hj-review--replace")?.textContent ?? "",
  }));
  if (marks.comment > 0 && marks.replace > 0) break;
  await page.waitForTimeout(500);
}
check("批注标记渲染到正文", marks.comment === 1, JSON.stringify(marks));
check("批注锚定到了正确的句子", marks.commentText === "死者张了张嘴", marks.commentText);
check("修订建议标记渲染到正文", marks.replace === 1, JSON.stringify(marks));
check("建议锚定到了正确的句子", marks.replaceText === seeded.quote, marks.replaceText);

console.log("【审稿面板】");
const opened = await page.evaluate(() => {
  // HeroUI 的 Tooltip 不会给触发元素加 title，所以图标按钮用 aria-label 定位
  const b = document.querySelector('button[aria-label="审稿"]');
  if (b) { b.click(); return true; }
  return false;
});
await page.waitForTimeout(1500);
check("工具栏有审稿入口", opened);
const panelText = await page.evaluate(() => document.body.innerText);
check("面板显示批注正文", panelText.includes("他张嘴是要说什么"), "");
check("面板显示未处理数量", /待处理/.test(panelText), "");

console.log("【接受修订建议】");
// 先切到「修订」标签页
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll("button")).find((x) => (x.textContent ?? "").trim().startsWith("修订"));
  if (b) b.click();
});
await page.waitForTimeout(1200);
const panelButtons = await page.evaluate(() =>
  Array.from(document.querySelectorAll("button")).map((b) => (b.textContent ?? "").trim()).filter(Boolean).slice(0, 30),
);
console.log("  面板按钮: " + JSON.stringify(panelButtons));
const accepted = await page.evaluate(async () => {
  const b = Array.from(document.querySelectorAll("button")).find((x) => (x.textContent ?? "").trim().startsWith("接受"));
  if (b) { b.click(); return (b.textContent ?? "").trim(); }
  return false;
});
// 等落库完成：轮询而不是固定 sleep（批量跑时机器负载高，固定等待会偶发失败）
let afterAccept = null;
for (let i = 0; i < 20; i++) {
  await page.waitForTimeout(500);
  afterAccept = await page.evaluate(async (cid) => {
    const o = await import("/src/db/repo/outline.ts");
    const r = await import("/src/db/repo/review.ts");
    const content = await o.getChapterContent(cid);
    const sugs = await r.listReviewSuggestions(cid);
    return {
      text: content.text,
      hasNew: content.text.includes("那三个字从他自己喉咙里滚出来"),
      hasOld: content.text.includes("他听见了自己的名字"),
      status: sugs[0]?.status,
      snapshots: (await o.listSnapshots(cid)).map((s) => s.label),
    };
  }, chId);
  if (afterAccept.status === "accepted") break;
}
check("面板里有接受按钮并点击", accepted);
const afterAcceptFinal = afterAccept;
void (async () => {});
check("正文已替换为新文本", afterAcceptFinal?.hasNew === true, afterAcceptFinal?.text?.slice(-40));
check("旧文本已被移除", afterAcceptFinal?.hasOld === false);
check("建议状态变为已接受", afterAcceptFinal?.status === "accepted", String(afterAcceptFinal?.status));
check(
  "接受前自动存了快照",
  (afterAcceptFinal?.snapshots ?? []).some((s) => s.includes("应用修订建议前")),
  JSON.stringify(afterAcceptFinal?.snapshots),
);

console.log("【锚点漂移后仍能定位】");
const drift = await page.evaluate(async ({ chId }) => {
  const o = await import("/src/db/repo/outline.ts");
  const r = await import("/src/db/repo/review.ts");
  const a = await import("/src/utils/anchor.ts");
  // 在正文最前面插入一段，让所有偏移后移
  const cur = await o.getChapterContent(chId);
  await o.saveChapterContent(chId, "<p>此刻是凌晨三点二十分。</p>" + cur.html, { touchStatus: false });
  const after = (await o.getChapterContent(chId)).text;
  const comments = await r.listComments(chId);
  const c = comments[0];
  if (!c) return { error: "没有批注", after };
  const hit = a.locateAnchor(after, c.anchor);
  return {
    afterText: after,
    quote: c.anchor.quote,
    hasQuote: after.includes(c.anchor.quote),
    idx: after.indexOf(c.anchor.quote),
    located: Boolean(hit),
    via: hit?.via,
    found: hit ? after.slice(hit.from, hit.to) : "",
    expected: c.anchor.quote,
    commentCount: comments.length,
  };
}, { pid, chId });
check("插入新段落后批注仍能重新定位", drift.located, JSON.stringify(drift));
check("定位到的仍然是原来那句话", drift.found === drift.expected, JSON.stringify(drift));
check("定位方式为搜索而非原始偏移", drift.via !== "exact-offset", String(drift.via));

console.log("【审稿台页面】");
await page.goto(BASE + "/p/" + pid + "/review", { waitUntil: "networkidle" });
await page.waitForTimeout(2000);
const reviewText = await page.evaluate(() => document.body.innerText);
check("审稿台可打开", reviewText.includes("审稿台"));
check("审稿台显示跨章节统计", reviewText.includes("待处理批注") && reviewText.includes("待确认修订"));
check("审稿台列出批注", reviewText.includes("他张嘴是要说什么"));
check("审稿台显示已接受状态", reviewText.includes("已接受") || reviewText.includes("已处理修订"));

console.log("【更新日志】");
await page.goto(BASE + "/settings?tab=about", { waitUntil: "networkidle" });
await page.waitForTimeout(1800);
const aboutText = await page.evaluate(() => document.body.innerText);
check("关于页有更新日志", aboutText.includes("更新日志"));
check("显示当前版本号", /v\d+\.\d+\.\d+/.test(aboutText), "");
check("三类分类齐全", aboutText.includes("新增") && aboutText.includes("优化") && aboutText.includes("修复"));
check("最新版本的修复条目可见", aboutText.includes("设置") && aboutText.includes("无反应") || aboutText.includes("心流模式"));
await page.screenshot({ path: "/tmp/nf-changelog.png" });

await context.close();
console.log("");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
console.log("控制台错误: " + (errs.length ? JSON.stringify(errs.slice(0, 6)) : "NONE"));
process.exit(fail === 0 ? 0 : 1);