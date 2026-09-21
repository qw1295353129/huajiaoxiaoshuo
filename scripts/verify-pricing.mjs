/**
 * 回归：模型单价必须真的能填，并且真的影响「AI 用量」的估算成本。
 *
 * 用户报告："AI 用量里有个去填写单价，这是个空的按钮" ——
 * 用量页让你去「设置 → 模型与 AI → 计费」填单价，但设置页里**根本没有这个表单**，
 * 只有仓储函数（upsertPricing）没人调用。这类"按钮指向不存在的地方"在本项目出现过多次
 * （设置入口、CORS 代理），所以专门做一条回归把闭环钉住。
 *
 * 闭环要验的：填单价 → 生成 → 用量页显示非「—」的成本，且金额与 token 数吻合。
 */
import { gotoApp, launchIsolated } from "./lib/browser.mjs";

const BASE = "http://127.0.0.1:5178";
const MOCK = "http://127.0.0.1:8765/v1";
const context = await launchIsolated(import.meta.url, { viewport: { width: 1512, height: 1050 } });
const page = context.pages()[0] ?? (await context.newPage());
const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 180)));

let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (x ? "  → " + x : "")); } };

await gotoApp(page, BASE + "/");
const pid = await page.evaluate(async (mockBase) => {
  const p = await import("/src/db/repo/projects.ts");
  const s = await import("/src/db/repo/settings.ts");
  const o = await import("/src/db/repo/outline.ts");
  const proj = await p.createProject({ title: "单价验证", logline: "验尸官能听见遗言" });
  const ch = await o.createChapter(proj.id, { title: "第一章" });
  await o.saveChapterContent(ch.id, "<p>雨下了整夜。沈砚掀开白布。</p>", { touchStatus: false });
  await s.upsertProvider({ id: "prov_mock", name: "假模型", kind: "custom", baseUrl: mockBase, apiKey: "mock", models: ["mock-model"], enabled: true, corsBlocked: false });
  const cur = await s.loadSettings();
  await s.saveSettings({ ...cur, activeProviderId: "prov_mock", activeModel: "mock-model", stream: false, allowCloud: true });
  return proj.id;
}, MOCK);

console.log("【设置页必须有单价表单】");
await gotoApp(page, BASE + "/settings?tab=models", { settle: 2500 });
const settingsText = await page.evaluate(() => document.body.innerText);
check("设置里有「模型单价」区块", settingsText.includes("模型单价"), "");
check("有输入单价的地方", settingsText.includes("填写单价"), "");
check("说明了单位是每百万 token", settingsText.includes("每百万"), "");
check("给出了查价来源", settingsText.includes("官网") || settingsText.includes("deepseek.com"), "");

console.log("【空状态提示用过的模型】");
check("列出了可填的模型（无调用记录时来自供应商配置）", settingsText.includes("prov_mock::mock-model"), settingsText.slice(settingsText.indexOf("模型单价"), settingsText.indexOf("模型单价") + 300).replace(/\n/g, " | "));

console.log("【通过界面填单价】");
// 点候选 chip 预填
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => (x.textContent ?? "").trim() === "prov_mock::mock-model");
  if (b) b.click();
});
await page.waitForTimeout(600);
// 填价格
await page.evaluate(() => {
  const inputs = [...document.querySelectorAll('input[type="number"]')];
  const setVal = (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };
  if (inputs[0]) setVal(inputs[0], "2");
  if (inputs[1]) setVal(inputs[1], "8");
});
await page.waitForTimeout(400);
const clickedSave = await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => (x.textContent ?? "").includes("保存这条"));
  if (b) { b.click(); return true; }
  return false;
});
check("能点保存这条", clickedSave === true);
await page.waitForTimeout(1200);

const saved = await page.evaluate(async () => {
  const s = await import("/src/db/repo/settings.ts");
  const rows = await s.listPricing();
  return rows.map((r) => ({ key: r.key, in: r.inputPerM, out: r.outputPerM }));
});
check("单价已落库", saved.some((r) => r.key === "prov_mock::mock-model"), JSON.stringify(saved));
const row = saved.find((r) => r.key === "prov_mock::mock-model");
check("输入单价正确（2）", row?.in === 2, JSON.stringify(row));
check("输出单价正确（8）", row?.out === 8, JSON.stringify(row));
const listText = await page.evaluate(() => document.body.innerText);
check("已填单价出现在列表里", listText.includes("输入 ¥2") && listText.includes("输出 ¥8"), "");

console.log("【生成一次，成本应被记下】");
const gen = await page.evaluate(async (projectId) => {
  const { runText } = await import("/src/ai/runner.ts");
  const ai = await import("/src/db/repo/ai.ts");
  const res = await runText({
    taskKind: "continue",
    projectId,
    system: "你是小说家。",
    user: "续写一段。",
    context: { projectId, sections: ["profile"] },
  });
  const list = await ai.listGenerations(projectId, 10);
  const last = list[0];
  return {
    ok: res.ok,
    prompt: last?.promptTokens ?? 0,
    completion: last?.completionTokens ?? 0,
    cost: last?.cost ?? 0,
    model: last?.model,
    providerId: last?.providerId,
  };
}, pid);
console.log("  本次调用: " + JSON.stringify(gen));
check("生成成功", gen.ok === true, JSON.stringify(gen));
check("记录了 token 数", gen.prompt > 0 && gen.completion > 0, JSON.stringify(gen));
check("成本被算出并记下（> 0）", gen.cost > 0, JSON.stringify(gen));
// 金额应与公式吻合：prompt/1e6*2 + completion/1e6*8
const expected = (gen.prompt / 1_000_000) * 2 + (gen.completion / 1_000_000) * 8;
check("金额与「用量 × 单价」吻合", Math.abs(gen.cost - expected) < 1e-9, JSON.stringify({ got: gen.cost, expected }));

console.log("【用量页不再显示空成本】");
await gotoApp(page, BASE + "/p/" + pid + "/usage", { settle: 2500 });
const usageText = await page.evaluate(() => document.body.innerText);
check("不再提示「成本暂时算不出来」", !usageText.includes("成本暂时算不出来"), "");
check("显示已填写的模型单价", usageText.includes("已填写的模型单价") || usageText.includes("输入 ¥2"), usageText.slice(usageText.indexOf("估算成本"), usageText.indexOf("估算成本") + 200).replace(/\n/g, " | "));
check("有非零的成本金额", /¥0\.\d{4}|¥\d+\.\d{2}/.test(usageText), usageText.slice(usageText.indexOf("估算成本"), usageText.indexOf("估算成本") + 120));

console.log("【删除单价】");
await gotoApp(page, BASE + "/settings?tab=models", { settle: 2000 });
const deleted = await page.evaluate(async () => {
  const s = await import("/src/db/repo/settings.ts");
  await s.deletePricing("prov_mock::mock-model");
  const rows = await s.listPricing();
  return rows.length;
});
check("能删除单价", deleted === 0, String(deleted));

console.log("");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
console.log("控制台错误: " + (errs.length ? JSON.stringify(errs.slice(0, 4)) : "NONE"));
await context.close();
process.exit(fail === 0 ? 0 : 1);
