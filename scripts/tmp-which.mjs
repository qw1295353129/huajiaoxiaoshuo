import { gotoApp, launchIsolated } from "./lib/browser.mjs";
const context = await launchIsolated(import.meta.url, { viewport: { width: 1512, height: 950 } });
const page = context.pages()[0] ?? (await context.newPage());
await gotoApp(page, "http://127.0.0.1:5178/");
const info = await page.evaluate(async () => {
  const s = await import("/src/db/repo/settings.ts");
  const cur = s.loadSettings();
  return { theme: cur.theme };
});
console.log("当前保存的主题: " + JSON.stringify(info));
await context.close();
