/**
 * 回归：人物页与世界观页的「AI 生成」入口。
 *
 * 用户的反馈是"这两个页面怎么没有 AI 生成按钮" —— 之前只有「一句话成书」那条
 * 五阶段流水线会产生人物与世界观，作者想单独补几个人物没有轻量入口。
 *
 * 这里用假模型（scripts/mock-llm.mjs，已支持 cast-gen / world-gen）端到端验证：
 * 按钮在、对话框能开、能出候选、勾选落库、**重复生成不产生重复数据**。
 */
import { gotoApp, launchIsolated } from "./lib/browser.mjs";

const BASE = "http://127.0.0.1:5178";
const context = await launchIsolated(import.meta.url, { viewport: { width: 1512, height: 1050 } });
const page = context.pages()[0] ?? (await context.newPage());
const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 180)));

let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (x ? "  → " + x : "")); } };

await gotoApp(page, BASE + "/");
const pid = await page.evaluate(async () => {
  const p = await import("/src/db/repo/projects.ts");
  const s = await import("/src/db/repo/settings.ts");
  const proj = await p.createProject({ title: "AI 生成验证", logline: "一个能听见死者遗言的验尸官" });
  await s.upsertProvider({ id: "preset-mock", name: "假模型", kind: "custom", baseUrl: "http://127.0.0.1:8765/v1", apiKey: "mock", models: ["mock-model"], enabled: true, corsBlocked: false });
  const cur = await s.loadSettings();
  await s.saveSettings({ ...cur, activeProviderId: "preset-mock", activeModel: "mock-model", stream: false, allowCloud: true });
  return proj.id;
});

console.log("【人物页】");
await gotoApp(page, BASE + "/p/" + pid + "/characters", { settle: 2500 });
const charText = await page.evaluate(() => document.body.innerText);
check("页面上有「AI 生成人物」按钮", charText.includes("AI 生成人物"), "");

const openedCast = await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => (x.textContent ?? "").includes("AI 生成人物"));
  if (b) { b.click(); return true; }
  return false;
});
await page.waitForTimeout(1200);
check("能打开对话框", openedCast === true);
const dialogText = await page.evaluate(() => document.body.innerText);
check("对话框说明了会带上已有设定", dialogText.includes("避免重名") || dialogText.includes("已有的人物"), "");
check("可以填要求与数量", dialogText.includes("想要什么样的人物"), "");

// 生成
const clickedRun = await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => (x.textContent ?? "").trim() === "开始生成");
  if (b) { b.click(); return true; }
  return false;
});
check("能点开始生成", clickedRun === true);

let gotCandidates = false;
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(500);
  const t = await page.evaluate(() => document.body.innerText);
  if (t.includes("温晚") || t.includes("陆断")) { gotCandidates = true; break; }
  if (t.includes("生成失败") || t.includes("没有给出可用")) break;
}
const resultsText = await page.evaluate(() => document.body.innerText);
check("生成出了候选人物", gotCandidates, resultsText.slice(resultsText.indexOf("生成结果"), resultsText.indexOf("生成结果") + 120));
check("候选展示了欲望/缺陷等细节", resultsText.includes("想要：") || resultsText.includes("缺陷："), "");
// 不用正则：heredoc 会把反斜杠转义吃掉（这个坑今天踩了四次）
check("默认全选", resultsText.includes("已选") && !resultsText.includes("已选 0 /"), "");

// 落库
const clickedApply = await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => /加入选中的/.test(x.textContent ?? ""));
  if (b) { b.click(); return true; }
  return false;
});
check("能点加入", clickedApply === true);
await page.waitForTimeout(2500);

const afterApply = await page.evaluate(async (projectId) => {
  const cast = await import("/src/db/repo/cast.ts");
  const list = await cast.listCharacters(projectId);
  return { count: list.length, names: list.map((c) => c.name).sort() };
}, pid);
check("人物已落库", afterApply.count === 2, JSON.stringify(afterApply));
check("姓名正确", JSON.stringify(afterApply.names) === JSON.stringify(["温晚", "陆断"].sort()), JSON.stringify(afterApply.names));

console.log("【重复生成不产生重复人物】");
const again = await page.evaluate(async (projectId) => {
  const { generateCharacters } = await import("/src/ai/cast-gen.ts");
  const gen = await import("/src/ai/cast-gen.ts");
  void gen;
  const cast = await import("/src/db/repo/cast.ts");
  const before = (await cast.listCharacters(projectId)).length;
  // 走一遍"生成 → 落库"的完整逻辑（与对话框一致）
  const res = await generateCharacters({ projectId, count: 2 });
  let created = 0;
  let merged = 0;
  const current = await cast.listCharacters(projectId);
  const byName = new Map(current.map((c) => [c.name, c]));
  for (const row of res.characters) {
    const patch = { name: row.name, aliases: row.aliases, role: row.role, tagline: row.tagline, voice: row.voice, tags: ["AI 建档"] };
    const hit = byName.get(row.name);
    if (hit) { await cast.updateCharacter(hit.id, patch); merged += 1; }
    else { const made = await cast.createCharacter(projectId, patch); byName.set(made.name, made); created += 1; }
  }
  const after = (await cast.listCharacters(projectId)).length;
  return { ok: res.ok, before, after, created, merged, names: res.characters.map((c) => c.name) };
}, pid);
check("第二次生成成功", again.ok === true, JSON.stringify(again));
check("第二次没有新建人物", again.created === 0, JSON.stringify(again));
check("第二次改为更新同名人物", again.merged === 2, JSON.stringify(again));
check("人物总数没有增加", again.after === again.before, JSON.stringify(again));

console.log("【世界观页】");
await gotoApp(page, BASE + "/p/" + pid + "/world", { settle: 2500 });
const worldText = await page.evaluate(() => document.body.innerText);
check("页面上有「AI 生成条目」按钮", worldText.includes("AI 生成条目"), "");

const openedWorld = await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => (x.textContent ?? "").includes("AI 生成条目"));
  if (b) { b.click(); return true; }
  return false;
});
await page.waitForTimeout(1200);
check("能打开世界观生成框", openedWorld === true);
const wd = await page.evaluate(() => document.body.innerText);
check("有分类选择（含自动判断）", wd.includes("按内容自动判断"), "");
check("有数量选择", wd.includes("想要什么样的设定"), "");

await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => (x.textContent ?? "").trim() === "开始生成");
  if (b) b.click();
});
let gotEntries = false;
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(500);
  const t = await page.evaluate(() => document.body.innerText);
  if (t.includes("触骨") || t.includes("海禁")) { gotEntries = true; break; }
  if (t.includes("生成失败")) break;
}
check("生成出了世界观候选", gotEntries, "");

await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => /加入选中的/.test(x.textContent ?? ""));
  if (b) b.click();
});
await page.waitForTimeout(2500);
const worldAfter = await page.evaluate(async (projectId) => {
  const { db } = await import("/src/db/database.ts");
  const rows = await db.worldEntries.where("projectId").equals(projectId).toArray();
  return { count: rows.length, titles: rows.map((r) => r.title).sort(), cats: rows.map((r) => r.category).sort() };
}, pid);
check("世界观条目已落库", worldAfter.count === 2, JSON.stringify(worldAfter));
check("分类被正确归一化", worldAfter.cats.includes("magic") && worldAfter.cats.includes("politics"), JSON.stringify(worldAfter.cats));

// 重复落库（upsert 按标题）不应新增
const worldAgain = await page.evaluate(async (projectId) => {
  const { db } = await import("/src/db/database.ts");
  const w = await import("/src/db/repo/world.ts");
  const before = (await db.worldEntries.where("projectId").equals(projectId).toArray()).length;
  await w.upsertWorldEntry(projectId, { title: "触骨", category: "magic", body: "改过的内容", importance: 5 });
  const rows = await db.worldEntries.where("projectId").equals(projectId).toArray();
  return { before, after: rows.length, body: rows.find((r) => r.title === "触骨")?.body };
}, pid);
check("同标题再入库是更新而非新增", worldAgain.after === worldAgain.before, JSON.stringify(worldAgain));
check("内容确实被更新了", worldAgain.body === "改过的内容", String(worldAgain.body));

console.log("");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
console.log("控制台错误: " + (errs.length ? JSON.stringify(errs.slice(0, 4)) : "NONE"));
await context.close();
process.exit(fail === 0 ? 0 : 1);
