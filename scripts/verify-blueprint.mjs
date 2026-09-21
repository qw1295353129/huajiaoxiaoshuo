/**
 * 回归：拆书 / 仿写。
 *
 * 这个功能的风险不在"能不能跑"，而在**会不会产出抄袭内容**。
 * 所以测试的重点是：
 *  ① 拆解结果必须分成技法层与内容层两半；
 *  ② 原创性自检（最长公共子串）判断正确 —— 误报会挡住正常创作，漏报会放过抄袭；
 *  ③ 有雷同时**不允许落库**；
 *  ④ 落库幂等（沿用一句话成书的教训，重复应用不产生重复数据）。
 */
import { gotoApp, launchIsolated } from "./lib/browser.mjs";
import { sampleChapter } from "./fixtures/sample-chapter.mjs";

const BASE = "http://127.0.0.1:5178";
const MOCK = "http://127.0.0.1:8765/v1";
const context = await launchIsolated(import.meta.url, { viewport: { width: 1512, height: 1100 } });
const page = context.pages()[0] ?? (await context.newPage());
const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 180)));

let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (x ? "  → " + x : "")); } };

await gotoApp(page, BASE + "/");

console.log("【原创性自检的纯函数（最要紧的一项）】");
const overlap = await page.evaluate(async () => {
  const { findOverlaps } = await import("/src/core/blueprint.ts");
  const SRC = "雨在凌晨三点停了。沈砚把白布重新盖回去，手指在布面上停了一瞬。验尸房的铜钟在没有风的时候轻轻响了一下。";
  return {
    // 正例：连续 20 字完全一致
    exact: findOverlaps("他想起那句话：" + SRC.slice(0, 20) + "，然后走开了。", SRC).map((h) => h.length),
    // 反例：改写过的句子（每句都换了说法）
    rewritten: findOverlaps("雨到三点才歇。沈砚又把白布盖好，指尖在布上顿了一下。", SRC).length,
    // 反例：只是常见词相同，不构成连续长串
    commonWords: findOverlaps("凌晨三点的雨，白布，手指，铜钟。", SRC).length,
    // 边界：空格差异不影响判定（先归一化空白）。
    // 注意空格要插在**匹配区中间**才测得到；插在匹配区之外等于没插（我第一版就写错了）。
    withSpaces: findOverlaps("他想起那句话：雨在凌晨三点停了。   沈砚把白布重新盖回去，然后走开了。", SRC).length,
    // 边界：正好 12 字算雷同，11 字不算
    exactly12: findOverlaps("前缀" + SRC.slice(0, 12), SRC).length,
    exactly11: findOverlaps("前缀" + SRC.slice(0, 11) + "改", SRC).length,
    // 空输入不应崩
    emptyA: findOverlaps("", SRC).length,
    emptyB: findOverlaps(SRC, "").length,
  };
});
console.log("  " + JSON.stringify(overlap));
check("完全相同的长片段会被抓到", overlap.exact.length > 0 && overlap.exact[0] >= 12, JSON.stringify(overlap.exact));
check("改写过的句子不会误报", overlap.rewritten === 0, String(overlap.rewritten));
check("只有常见词相同不算雷同", overlap.commonWords === 0, String(overlap.commonWords));
check("空格差异不影响判定", overlap.withSpaces > 0, String(overlap.withSpaces));
check("正好 12 字算雷同", overlap.exactly12 > 0, String(overlap.exactly12));
check("11 字不算雷同", overlap.exactly11 === 0, String(overlap.exactly11));
check("空输入不崩", overlap.emptyA === 0 && overlap.emptyB === 0, JSON.stringify(overlap));

console.log("【页面与拆解流程】");
const pid = await page.evaluate(async (mockBase) => {
  const p = await import("/src/db/repo/projects.ts");
  const s = await import("/src/db/repo/settings.ts");
  const proj = await p.createProject({ title: "拆书验证" });
  await s.upsertProvider({ id: "prov_mock", name: "假模型", kind: "custom", baseUrl: mockBase, apiKey: "mock", models: ["mock-model"], enabled: true, corsBlocked: false });
  const cur = await s.loadSettings();
  await s.saveSettings({ ...cur, activeProviderId: "prov_mock", activeModel: "mock-model", stream: false, allowCloud: true });
  return proj.id;
}, MOCK);

await gotoApp(page, BASE + "/p/" + pid + "/blueprint", { settle: 2500 });
const pageText = await page.evaluate(() => document.body.innerText);
check("导航里有「拆书仿写」", pageText.includes("拆书仿写"), "");
check("页面说明了本地分析", pageText.includes("本地分析") || pageText.includes("不上传"), "");
check("有放入参考书的输入区", pageText.includes("放入参考书"), "");

// 太短时应拒绝
const shortReject = await page.evaluate(async () => {
  const { analyzeBlueprint } = await import("/src/ai/blueprint.ts");
  const res = await analyzeBlueprint({ projectId: "x", sourceText: "太短了。" });
  return { ok: res.ok, error: res.error };
});
check("样本太短会被拒绝并说明原因", shortReject.ok === false && (shortReject.error ?? "").includes("太短"), JSON.stringify(shortReject));

// 真实跑一次拆解
const analyzed = await page.evaluate(async ({ projectId, sample }) => {
  const { analyzeBlueprint } = await import("/src/ai/blueprint.ts");
  const res = await analyzeBlueprint({ projectId, sourceText: sample, sourceTitle: "参考样本" });
  return {
    ok: res.ok,
    error: res.error,
    hasTechnique: Boolean(res.blueprint?.technique.informationRelease),
    hasContent: Boolean(res.blueprint?.content.plotEngine),
    chapterTemplate: res.blueprint?.chapterTemplate.length ?? 0,
    signature: res.blueprint?.technique.signatureMove,
    sampled: res.sampled,
  };
}, { projectId: pid, sample: sampleChapter() });
console.log("  " + JSON.stringify(analyzed));
check("拆解成功", analyzed.ok === true, JSON.stringify(analyzed));
check("产出技法层（含信息释放节奏）", analyzed.hasTechnique === true, "");
check("产出内容层（含情节引擎）", analyzed.hasContent === true, "");
check("产出章节功能模板", analyzed.chapterTemplate > 0, String(analyzed.chapterTemplate));

console.log("【按蓝图生成新作】");
// sampleChapter() 是 Node 侧的函数，浏览器里没有，必须作为参数传进去
const generated = await page.evaluate(async ({ projectId, sample }) => {
  const { analyzeBlueprint, generateFromBlueprint } = await import("/src/ai/blueprint.ts");
  const a = await analyzeBlueprint({ projectId, sourceText: sample, sourceTitle: "样本" });
  if (!a.ok) return { ok: false, error: "拆解失败：" + a.error };
  if (!a.blueprint) return { ok: false, error: "拆解没有产出蓝图" };
  const g = await generateFromBlueprint({
    projectId,
    blueprint: a.blueprint,
    premise: "一个出租记忆的人，发现自己的记忆被反复租过三十七次。",
    chapterCount: 12,
  });
  return {
    ok: g.ok,
    error: g.error,
    title: g.story?.title,
    chars: g.story?.characters.length ?? 0,
    chapters: g.story?.chapters.length ?? 0,
    hasArc: (g.story?.arcs.length ?? 0) > 0,
  };
}, { projectId: pid, sample: sampleChapter() });
console.log("  " + JSON.stringify(generated));
check("生成成功", generated.ok === true, JSON.stringify(generated));
check("书名是全新的（不是参考样本里的）", generated.title === "潮汐证人", String(generated.title));
check("产出人物与章节", generated.chars > 0 && generated.chapters > 0, JSON.stringify(generated));
check("产出分卷结构", generated.hasArc === true, "");

console.log("【落库幂等】");
const applyTwice = await page.evaluate(async ({ projectId, sample }) => {
  const { analyzeBlueprint, generateFromBlueprint } = await import("/src/ai/blueprint.ts");
  const { applyGeneratedStory } = await import("/src/features/blueprint/apply.ts");
  const cast = await import("/src/db/repo/cast.ts");
  const outline = await import("/src/db/repo/outline.ts");
  const { db } = await import("/src/db/database.ts");

  const a = await analyzeBlueprint({ projectId, sourceText: sample, sourceTitle: "样本" });
  if (!a.ok || !a.blueprint) return { failed: "拆解失败：" + a.error };
  const g = await generateFromBlueprint({ projectId, blueprint: a.blueprint, premise: "出租记忆的人", chapterCount: 12 });
  if (!g.ok || !g.story) return { failed: "生成失败：" + g.error };

  const r1 = await applyGeneratedStory(projectId, g.story, { blueprint: a.blueprint });
  const after1 = {
    chars: (await cast.listCharacters(projectId)).length,
    chapters: (await outline.listChapters(projectId)).length,
    world: (await db.worldEntries.where("projectId").equals(projectId).toArray()).length,
  };
  const r2 = await applyGeneratedStory(projectId, g.story, { blueprint: a.blueprint });
  const after2 = {
    chars: (await cast.listCharacters(projectId)).length,
    chapters: (await outline.listChapters(projectId)).length,
    world: (await db.worldEntries.where("projectId").equals(projectId).toArray()).length,
  };
  const project = await db.projects.get(projectId);
  return { r1, r2, after1, after2, styleGuide: project?.styleGuide ?? "" };
}, { projectId: pid, sample: sampleChapter() });
console.log("  第一次 " + JSON.stringify(applyTwice.after1) + " / 第二次 " + JSON.stringify(applyTwice.after2));
check("第一次落库新建了内容", applyTwice.r1.characters > 0 && applyTwice.r1.chapters > 0, JSON.stringify(applyTwice.r1));
check("第二次不再新建", applyTwice.r2.characters === 0 && applyTwice.r2.chapters === 0, JSON.stringify(applyTwice.r2));
check("第二次改为更新", applyTwice.r2.mergedCharacters > 0, JSON.stringify(applyTwice.r2));
check("库内规模没有翻倍", JSON.stringify(applyTwice.after1) === JSON.stringify(applyTwice.after2), JSON.stringify(applyTwice));
check("技法被写入写作风格（这才是「仿」的落点）", applyTwice.styleGuide.includes("信息释放") || applyTwice.styleGuide.includes("视角"), applyTwice.styleGuide.slice(0, 80));

console.log("");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
console.log("控制台错误: " + (errs.length ? JSON.stringify(errs.slice(0, 4)) : "NONE"));
await context.close();
process.exit(fail === 0 ? 0 : 1);
