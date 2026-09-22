/**
 * 回归：设置界面的模型选择、向量模型过滤、密钥清空，以及导航与卡片的样式。
 *
 * 对应四条用户反馈：
 *  1. "模型设置那里把模型显示改成弹窗或者下拉菜单吧，模型显示不全"
 *     → 原生 select 的展开宽度受控件宽度限制，长模型名被截断。
 *  2. "语义召回……改成只显示各家的向量模型"
 *     → 那里原先只是一个文本框 + 前 3 个模型的提示。
 *  3. "产品和密钥没有删除组件，增加删除组件"
 *     → 供应商删除一直有，**密钥没有清空入口**。
 *  4. 卡片彩色渐变底 + 图标在左的圆角导航栏，且**每个主题各自配色**。
 */
import { gotoApp, launchIsolated } from "./lib/browser.mjs";

const BASE = "http://127.0.0.1:5178";
const context = await launchIsolated(import.meta.url, { viewport: { width: 1512, height: 1000 } });
const page = context.pages()[0] ?? (await context.newPage());
const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 180)));

let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (x ? "  → " + x : "")); } };

await gotoApp(page, BASE + "/");
const ids = await page.evaluate(async () => {
  const p = await import("/src/db/repo/projects.ts");
  const proj = await p.createProject({ title: "设置界面回归" });
  const o = await import("/src/db/repo/outline.ts");
  const c = await o.createChapter(proj.id, { title: "第一章" });
  await o.saveChapterContent(c.id, "<p>正文。</p>", { touchStatus: false });
  // 造一个带长模型名的供应商，复现"显示不全"
  const s = await import("/src/db/repo/settings.ts");
  const prov = await s.upsertProvider({ name: "硅基流动 SiliconFlow", baseUrl: "https://api.siliconflow.cn/v1", kind: "openai" });
  await s.upsertProvider({ ...prov, models: ["deepseek-ai/DeepSeek-V3", "Qwen/Qwen2.5-72B-Instruct", "BAAI/bge-m3", "THUDM/glm-4-9b-chat"] });
  s.saveSettings(Object.assign({}, s.loadSettings(), { activeProviderId: prov.id, activeModel: "deepseek-ai/DeepSeek-V3" }));
  return { pid: proj.id, provId: prov.id };
});

console.log("【1. 默认模型用弹窗选择，不是原生 select】");
await gotoApp(page, BASE + "/settings?tab=models", { settle: 2500 });
const picker = await page.evaluate(() => {
  const btns = [...document.querySelectorAll("button")].filter((b) => (b.textContent ?? "").includes("deepseek-ai/DeepSeek-V3"));
  const nativeSelects = [...document.querySelectorAll("select")].filter((s) => (s.textContent ?? "").includes("DeepSeek-V3"));
  return { 有选择按钮: btns.length > 0, 原生select里还有模型: nativeSelects.length };
});
check("模型用按钮触发（不是原生 select）", picker.有选择按钮 === true, JSON.stringify(picker));
check("模型不再出现在原生 select 里", picker.原生select里还有模型 === 0, JSON.stringify(picker));

// 点开弹窗，确认完整显示长模型名
await page.evaluate(() => {
  [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("deepseek-ai/DeepSeek-V3"))?.click();
});
await page.waitForTimeout(700);
const dialog = await page.evaluate(() => {
  const overlay = document.querySelector(".fixed.inset-0");
  if (!overlay) return { open: false };
  const items = [...overlay.querySelectorAll("li button")].map((b) => (b.textContent ?? "").trim());
  const search = overlay.querySelector("input");
  return {
    open: true,
    heading: (overlay.querySelector("h3")?.textContent ?? "").trim(),
    items,
    hasSearch: Boolean(search),
    // 是否因为窄而被截断
    clipped: [...overlay.querySelectorAll("li button span")].some((s2) => s2.scrollWidth > s2.clientWidth + 1),
  };
});
check("弹窗打开了", dialog.open === true, JSON.stringify(dialog));
check("列出的模型名完整（未被截断）", dialog.clipped === false, JSON.stringify({ clipped: dialog.clipped }));
check("弹窗里有搜索框", dialog.hasSearch === true, JSON.stringify(dialog));
check("列出全部 4 个模型", (dialog.items ?? []).length === 4, JSON.stringify(dialog.items));
await page.keyboard.press("Escape");
await page.waitForTimeout(400);

console.log("【2. 语义召回只显示向量模型】");
await gotoApp(page, BASE + "/settings?tab=memory", { settle: 2200 });
const recall = await page.evaluate(async () => {
  const { looksLikeEmbeddingModel } = await import("/src/components/common/ModelSelect.tsx");
  const all = ["deepseek-ai/DeepSeek-V3", "Qwen/Qwen2.5-72B-Instruct", "BAAI/bge-m3", "THUDM/glm-4-9b-chat", "text-embedding-3-small", "nomic-embed-text"];
  return {
    过滤结果: all.filter(looksLikeEmbeddingModel),
    非向量: all.filter((m) => !looksLikeEmbeddingModel(m)),
  };
});
check("bge-m3 被认成向量模型", recall.过滤结果.includes("BAAI/bge-m3"), JSON.stringify(recall));
check("text-embedding-3-small 被认成向量模型", recall.过滤结果.includes("text-embedding-3-small"), JSON.stringify(recall));
check("nomic-embed-text 被认成向量模型", recall.过滤结果.includes("nomic-embed-text"), JSON.stringify(recall));
check("对话模型被排除", recall.非向量.includes("deepseek-ai/DeepSeek-V3") && recall.非向量.includes("THUDM/glm-4-9b-chat"), JSON.stringify(recall.非向量));

console.log("【3. 密钥可以单独清空】");
await gotoApp(page, BASE + "/settings?tab=models", { settle: 2400 });
const keyUi = await page.evaluate(() => {
  const clearBtn = document.querySelector('button[aria-label="清空密钥"]');
  const delBtn = [...document.querySelectorAll("button")].some((b) => (b.textContent ?? "").trim() === "");
  return { 有清空密钥按钮: Boolean(clearBtn), 供应商删除仍存在: delBtn };
});
// 只有填了 Key 才会显示清空按钮，所以先填一个
if (!keyUi.有清空密钥按钮) {
  await page.evaluate(() => {
    const input = [...document.querySelectorAll("input")].find((i) => (i.placeholder ?? "").includes("API Key"));
    if (input) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(input, "sk-test-1234567890");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  await page.waitForTimeout(1200);
}
const afterFill = await page.evaluate(() => Boolean(document.querySelector('button[aria-label="清空密钥"]')));
check("填了 Key 之后出现「清空密钥」按钮", afterFill === true, String(afterFill));
const stillHasDelete = await page.evaluate(() => [...document.querySelectorAll("button")].filter((b) => (b.textContent ?? "").trim() === "").length >= 2);
check("供应商删除按钮仍然存在（两者不冲突）", stillHasDelete === true, String(stillHasDelete));

console.log("【4. 卡片渐变与圆角导航】");
const styleInfo = await page.evaluate(async () => {
  const out = {};
  for (const theme of ["light", "warm", "soft"]) {
    const s = await import("/src/db/repo/settings.ts");
    s.saveSettings(Object.assign({}, s.loadSettings(), { theme }));
    out[theme] = theme;
  }
  return out;
});
void styleInfo;
for (const theme of ["light", "warm", "soft"]) {
  await page.evaluate(async (t) => {
    const s = await import("/src/db/repo/settings.ts");
    s.saveSettings(Object.assign({}, s.loadSettings(), { theme: t }));
  }, theme);
  await gotoApp(page, BASE + "/p/" + ids.pid + "/overview", { settle: 2000 });
  const g = await page.evaluate(() => {
    const solid = document.querySelector(".tone-solid");
    const grad = document.querySelector(".tone-gradient");
    return {
      solidBg: solid ? getComputedStyle(solid).backgroundImage : "",
      gradBg: grad ? getComputedStyle(grad).backgroundImage : "",
    };
  });
  /*
    不再有"实心反色卡"（用户反馈：深色主题里有张白卡、浅色主题里有张黑卡）。
    accent 现在与其它色调一视同仁，只保留主色图标。
  */
  check(theme + " 主题不该出现实心反色卡", g.solidBg === "", g.solidBg.slice(0, 50));
  /*
    卡片着色**按主题开关**（用户反馈"浅色主题出现这几个颜色不搭配"）：
    中性主题完全不着色，只有有配色性格的主题才有彩色卡。
  */
  const tinted = !g.gradBg.includes("oklab(0 0 0 / 0)");
  if (theme === "light") check("中性主题的卡片不着色", tinted === false, g.gradBg.slice(0, 60));
}

// 三个主题的强调色必须**各不相同**（用户要求"每个主题有每个主题的个性"）
const accents = await page.evaluate(async () => {
  const s = await import("/src/db/repo/settings.ts");
  const out = {};
  for (const theme of ["light", "warm", "soft"]) {
    s.saveSettings(Object.assign({}, s.loadSettings(), { theme }));
    const { applyTheme } = await import("/src/app/store.ts");
    applyTheme(theme);
    out[theme] = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
  }
  return out;
});
check(
  "三个主题的强调色各不相同",
  new Set(Object.values(accents)).size === 3,
  JSON.stringify(accents),
);

const navInfo = await page.evaluate(() => {
  const nav = [...document.querySelectorAll("nav")].find((n) => (n.textContent ?? "").includes("一句话成书"));
  const active = nav?.querySelector('a[aria-current="page"]');
  const cs = active ? getComputedStyle(active) : null;
  // 导航项的图标（排除返回书库的箭头）
  const listIcons = [...(nav?.querySelectorAll("ul a svg") ?? [])].map((s2) => Math.round(s2.getBoundingClientRect().left));
  return {
    激活项圆角: cs ? parseFloat(cs.borderRadius) : 0,
    激活项有阴影: cs ? cs.boxShadow !== "none" : false,
    图标左端: listIcons.slice(0, 8),
    图标对齐: new Set(listIcons).size === 1,
  };
});
console.log("  " + JSON.stringify(navInfo));
check("导航项是圆角胶囊（>=8px）", navInfo.激活项圆角 >= 8, String(navInfo.激活项圆角));
check("激活项浮起（有阴影）", navInfo.激活项有阴影 === true, String(navInfo.激活项有阴影));
check("图标在左且所有项左端对齐", navInfo.图标对齐 === true && navInfo.图标左端.length > 3, JSON.stringify(navInfo.图标左端));

console.log("");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
console.log("控制台错误: " + (errs.length ? JSON.stringify(errs.slice(0, 3)) : "NONE"));
await context.close();
process.exit(fail === 0 ? 0 : 1);
