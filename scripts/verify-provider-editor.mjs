/**
 * 回归：编辑供应商弹窗。
 *
 * 用户反馈两点：
 *  ① "输入 key 后自动拉取列表，这里改下" ——
 *     原来只有保存到主界面、再往 Key 输入框打字才会触发自动拉取；
 *     在弹窗里填完地址与 Key 却拿不到列表，而那正是最需要它的时刻。
 *     → 弹窗里加「拉取模型列表」，用**草稿里的**地址与 Key 探测，不必先保存。
 *  ② "那个协议类型，是不是多余的啊" —— 确实是。
 *     它只提供 openai/deepseek/ollama/custom 等标签，代码里没有任何分支依赖它，
 *     非本地供应商全走 OpenAI 兼容。→ 移除，改由接口地址推断。
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
const pid = await page.evaluate(async () => {
  const p = await import("/src/db/repo/projects.ts");
  const proj = await p.createProject({ title: "供应商弹窗" });
  return proj.id;
});
void pid;

console.log("【协议类型下拉已移除】");
await gotoApp(page, BASE + "/settings?tab=models", { settle: 2400 });
const before = await page.evaluate(() => {
  const hasKindLabel = document.body.innerText.includes("协议类型");
  return { hasKindLabel };
});
check("设置页上没有「协议类型」字样", before.hasKindLabel === false, JSON.stringify(before));

// 打开一个供应商的编辑弹窗
await page.evaluate(() => {
  [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === "编辑")?.click();
});
await page.waitForTimeout(900);
const dlg = await page.evaluate(() => {
  const overlay = document.querySelector(".fixed.inset-0");
  if (!overlay) return { open: false };
  return {
    open: true,
    heading: (overlay.querySelector("h3")?.textContent ?? "").trim(),
    hasKindSelect: (overlay.textContent ?? "").includes("协议类型"),
    hasFetchBtn: [...overlay.querySelectorAll("button")].some((b) => (b.textContent ?? "").includes("拉取模型列表")),
    labels: [...overlay.querySelectorAll("label")].map((l) => (l.textContent ?? "").trim()),
  };
});
console.log("  " + JSON.stringify(dlg));
check("编辑弹窗打开了", dlg.open === true, JSON.stringify(dlg));
check("弹窗里没有「协议类型」", dlg.hasKindSelect === false, JSON.stringify(dlg));
check("弹窗里有「拉取模型列表」按钮", dlg.hasFetchBtn === true, JSON.stringify(dlg));
check("模型列表字段仍在", (dlg.labels ?? []).some((l) => l.includes("模型列表")), JSON.stringify(dlg.labels));

console.log("【拉取按钮真的会发请求（用草稿值）】");
// 指向 mock LLM，验证它用的是弹窗里填的地址而不是库里的
const reqs = [];
page.on("request", (r) => {
  if (r.url().includes("/models")) reqs.push(r.url());
});
await page.evaluate(() => {
  const overlay = document.querySelector(".fixed.inset-0");
  const inputs = [...(overlay?.querySelectorAll("input") ?? [])];
  const setVal = (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };
  // 第二个 input 是接口地址
  if (inputs[1]) setVal(inputs[1], "http://127.0.0.1:8765/v1");
  if (inputs[2]) setVal(inputs[2], "sk-mock-test-key-1234567890");
});
await page.waitForTimeout(600);
await page.evaluate(() => {
  const overlay = document.querySelector(".fixed.inset-0");
  [...(overlay?.querySelectorAll("button") ?? [])].find((b) => (b.textContent ?? "").includes("拉取模型列表"))?.click();
});
await page.waitForTimeout(2500);

const afterFetch = await page.evaluate(() => {
  const overlay = document.querySelector(".fixed.inset-0");
  const ta = overlay?.querySelector("textarea");
  const note = [...(overlay?.querySelectorAll("p") ?? [])].map((p) => (p.textContent ?? "").trim()).find((t) => t.includes("拉取") || t.includes("模型"));
  return { textarea: ta ? ta.value : null, note };
});
console.log("  请求: " + JSON.stringify(reqs.slice(0, 3)));
console.log("  结果: " + JSON.stringify(afterFetch));
check("确实向接口地址发了 /models 请求", reqs.length > 0, JSON.stringify(reqs.slice(0, 2)));
check("请求打到草稿里的地址（127.0.0.1:8765）", reqs.some((u) => u.includes("127.0.0.1:8765")), JSON.stringify(reqs.slice(0, 2)));
check("模型列表被填入（用了草稿的 Key，无需先保存）", (afterFetch.textarea ?? "").trim().length > 0, JSON.stringify(afterFetch));
check("给出了拉取结果提示", Boolean(afterFetch.note), JSON.stringify(afterFetch.note));

console.log("");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
console.log("控制台错误: " + (errs.length ? JSON.stringify(errs.slice(0, 3)) : "NONE"));
await context.close();
process.exit(fail === 0 ? 0 : 1);
