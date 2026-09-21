import { launchIsolated } from "./lib/browser.mjs";
const BASE = "http://127.0.0.1:5178";
const context = await launchIsolated(import.meta.url);
const page = context.pages()[0] ?? (await context.newPage());
const urls = [];
page.on("request", (r) => { const u = r.url(); if (u.indexOf("embedding") >= 0 || u.indexOf("recall") >= 0) urls.push(u.replace(BASE, "")); });
await page.goto(BASE + "/", { waitUntil: "networkidle" });
await page.evaluate(async () => { await import("/src/ai/embedding.ts"); await import("/src/ai/recall.ts"); });
await page.waitForTimeout(500);
console.log("模块 URL：");
for (const u of Array.from(new Set(urls))) console.log("  " + u);
const identity = await page.evaluate(async () => {
  const a = await import("/src/ai/embedding.ts");
  const b = await import("/src/ai/recall.ts");
  // 通过 recall 暴露出来的能力无法直接比较，这里比较"同一个 URL 的模块命名空间"
  const c = await import("/src/ai/embedding.ts");
  return { sameNamespace: a === c, exportsA: Object.keys(a).length, hasBreaker: typeof a.resetEmbeddingBreaker === "function", recallKeys: Object.keys(b).length };
});
console.log(JSON.stringify(identity));
await context.close();
