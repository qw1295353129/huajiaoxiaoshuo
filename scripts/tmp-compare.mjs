import { gotoApp, launchIsolated } from "./lib/browser.mjs";
const context = await launchIsolated(import.meta.url, { viewport: { width: 1512, height: 950 } });
const page = context.pages()[0] ?? (await context.newPage());
const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 140)));
await gotoApp(page, "http://127.0.0.1:5178/");
const ids = await page.evaluate(async () => {
  const p = await import("/src/db/repo/projects.ts");
  const proj = await p.createProject({ title: "重生超级战舰" });
  const o = await import("/src/db/repo/outline.ts");
  const c = await o.createChapter(proj.id, { title: "第一章" });
  await o.saveChapterContent(c.id, "<p>正文。</p>", { touchStatus: false });
  return proj.id;
});
for (const theme of ["light", "warm", "soft"]) {
  await page.evaluate(async (t) => {
    const s = await import("/src/db/repo/settings.ts");
    s.saveSettings(Object.assign({}, s.loadSettings(), { theme: t }));
  }, theme);
  await gotoApp(page, "http://127.0.0.1:5178/p/" + ids + "/overview", { settle: 2200 });
  const info = await page.evaluate(() => {
    const g = document.querySelector(".tone-gradient");
    const s2 = document.querySelector(".tone-solid");
    const cs = g ? getComputedStyle(g) : null;
    return {
      theme: document.documentElement.getAttribute("data-theme") ?? "light",
      渐变卡底: cs ? cs.backgroundImage.slice(0, 58) : null,
      实心卡: s2 ? getComputedStyle(s2).backgroundImage.slice(0, 46) : null,
    };
  });
  console.log(JSON.stringify(info));
  await page.screenshot({ path: "/tmp/nf-cmp-" + theme + ".png", clip: { x: 370, y: 480, width: 960, height: 150 } });
}
console.log("错误: " + (errs.length ? JSON.stringify(errs.slice(0, 2)) : "NONE"));
await context.close();
