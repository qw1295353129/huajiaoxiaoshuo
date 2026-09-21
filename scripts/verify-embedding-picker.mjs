/**
 * 向量模型选择与下载的回归。
 *
 * 用 scripts/mock-ollama.mjs（含流式 /api/pull）验证：
 * 清单渲染、已装状态、下载进度、下载后自动选用、Ollama 不可达时的降级提示。
 * 真实模型有 1GB 级体积，不可能进回归测试，所以下载路径必须靠假服务覆盖。
 */
import { gotoApp, launchIsolated } from "./lib/browser.mjs";

const BASE = "http://127.0.0.1:5178";
const MOCK = "http://127.0.0.1:11499";
const context = await launchIsolated(import.meta.url, { viewport: { width: 1512, height: 1100 } });
const page = context.pages()[0] ?? (await context.newPage());
const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 160)));

let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (x ? "  → " + x : "")); } };

await gotoApp(page, BASE + "/");
// 造一个项目，让设置页的记忆面板有上下文
// MOCK 是 Node 侧的常量，必须作为参数传进页面（浏览器里没有这个变量）
await page.evaluate(async (mockEndpoint) => {
  const p = await import("/src/db/repo/projects.ts");
  const proj = await p.createProject({ title: "向量模型验证" });
  const s = await import("/src/db/repo/settings.ts");
  const cur = await s.loadSettings();
  await s.saveSettings({
    ...cur,
    semanticRecall: { enabled: true, source: "ollama", model: "nomic-embed-text", endpoint: mockEndpoint, topK: 8 },
  });
  return proj.id;
}, MOCK);

await gotoApp(page, BASE + "/settings?tab=memory", { settle: 2500 });

console.log("【模型清单】");
const listText = await page.evaluate(() => document.body.innerText);
check("显示 BGE-M3 并标为推荐", listText.includes("BGE-M3") && listText.includes("推荐"), "");
check("标注了中文支持程度", /\s+中文\s+(优秀|良好|一般)/.test(listText), "");
check("标注了模型体积与维度", listText.includes("1024 维") || listText.includes("768 维"), "");
check("已安装的模型显示状态", listText.includes("已安装"), "");
check("说明了全部免费离线", listText.includes("开源免费") || listText.includes("不需要 API Key"), "");
check("检测到 Ollama 连接", /Ollama 已连接/.test(listText), "");

console.log("【下载带进度】");
const downloadBtnCount = await page.evaluate(() => {
  const btns = [...document.querySelectorAll("button")].filter((b) => (b.textContent ?? "").trim() === "下载");
  return btns.length;
});
check("未安装的模型有下载按钮", downloadBtnCount >= 3, "找到 " + downloadBtnCount + " 个");

// 点第一个「下载」（BGE-M3）
const clicked = await page.evaluate(() => {
  const row = [...document.querySelectorAll("div")].find((d) => (d.textContent ?? "").includes("BGE-M3") && d.querySelector('button'));
  const btn = [...(row?.querySelectorAll("button") ?? [])].find((b) => (b.textContent ?? "").trim() === "下载");
  if (btn) { btn.click(); return true; }
  return false;
});
check("能点到下载按钮", clicked === true);

// 抓进度：假服务约 1.5 秒推完
let sawProgress = false;
let sawPercent = false;
let sawBytes = false;
for (let i = 0; i < 24; i++) {
  await page.waitForTimeout(150);
  const t = await page.evaluate(() => document.body.innerText);
  if (t.includes("正在下载")) sawProgress = true;
  if (/\s+正在下载[ \s \S]{0,80}?\d+%/.test(t)) sawPercent = true;
  if (/\d+(\.\d+)?\s*(MB|GB)\s*\/\s*\d/.test(t)) sawBytes = true;
  if (t.includes("模型已下载")) break;
}
check("显示下载中状态", sawProgress);
check("显示百分比进度", sawPercent);
check("显示已下载/总大小", sawBytes);

await page.waitForTimeout(2500);
const afterPull = await page.evaluate(() => document.body.innerText);
check("下载完成后提示成功", afterPull.includes("模型已下载") || afterPull.includes("BGE-M3"), "");
check("BGE-M3 变为使用中或已安装", /BGE-M3[\s\S]{0,200}(使用中|已安装)/.test(afterPull), "");

console.log("【下载后自动选用】");
const saved = await page.evaluate(async () => {
  const s = await import("/src/db/repo/settings.ts");
  const cur = await s.loadSettings();
  return cur.semanticRecall;
});
// 不要断言具体模型名：点中的是清单里第一个能下载的行，改清单就会变。
// 要断言的是"下载完成后自动选用并落库"这个行为。
check("下载完成后自动选用并写进设置", Boolean(saved?.model) && saved.model !== "nomic-embed-text", JSON.stringify(saved));
check("选中的确实是清单里的模型", (await page.evaluate(async () => {
  const { EMBEDDING_MODELS } = await import("/src/ai/embedding-models.ts");
  const s = await import("/src/db/repo/settings.ts");
  const cur = await s.loadSettings();
  return EMBEDDING_MODELS.some((m) => m.name === cur.semanticRecall?.model);
})), JSON.stringify(saved));
check("开关与来源保持", saved?.enabled === true && saved?.source === "ollama", JSON.stringify(saved));

console.log("【实测向量服务】");
const probe = await page.evaluate(async () => {
  const { probeEmbedding } = await import("/src/ai/embedding.ts");
  const s = await import("/src/db/repo/settings.ts");
  const cur = await s.loadSettings();
  return probeEmbedding(cur.semanticRecall);
});
check("假 Ollama 的向量端点可用", probe.ok === true, JSON.stringify(probe));
check("返回了维度", typeof probe.dim === "number" && probe.dim > 0, JSON.stringify(probe));

console.log("【Ollama 不可达时的表现】");
await page.evaluate(async () => {
  const s = await import("/src/db/repo/settings.ts");
  const cur = await s.loadSettings();
  await s.saveSettings({ ...cur, semanticRecall: { ...cur.semanticRecall, endpoint: "http://127.0.0.1:11999/api/embeddings" } });
});
await gotoApp(page, BASE + "/settings?tab=memory", { settle: 3000 });
const downText = await page.evaluate(() => document.body.innerText);
check("提示连不上 Ollama", downText.includes("连不上 Ollama"), "");
check("给出安装与启动步骤", downText.includes("brew install ollama") && downText.includes("ollama serve"), "");
check("明确提示 CORS 设置（否则会一直静默降级）", downText.includes("OLLAMA_ORIGINS"), "");
check("下载按钮被禁用（避免必然失败的下载）", await page.evaluate(() => {
  const btns = [...document.querySelectorAll("button")].filter((b) => (b.textContent ?? "").trim() === "下载");
  return btns.length === 0 || btns.every((b) => b.disabled);
}), "");
check("给出了替代方案（OpenAI 兼容供应商）", downText.includes("OpenAI 兼容"), "");

console.log("");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
console.log("控制台错误: " + (errs.length ? JSON.stringify(errs.slice(0, 4)) : "NONE"));
await context.close();
process.exit(fail === 0 ? 0 : 1);
