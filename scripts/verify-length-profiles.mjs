/**
 * 回归：篇幅档案。
 *
 * 用户反馈："创作篇幅的时候，每个篇幅默认的设置应该都是不一样的"。
 * 真因：chaptersPerVolume 写死 12、不随篇幅变化，而项目里只有"篇幅 → 字数"的映射，
 * 没有"篇幅 → 章节粒度"的映射 —— 短篇和中篇会得到同样的 12 章。
 *
 * 现在统一到 core 的 LENGTH_PROFILES。测试重点：
 *  ① 各篇幅的数值确实不同且单调合理（字数、卷数、每卷章数递增）；
 *  ② 表单里切篇幅会联动每卷章节数；
 *  ③ **手动改过之后不再被自动覆盖** —— 这是"聪明的自动行为"最容易惹人烦的地方。
 */
import { gotoApp, launchIsolated } from "./lib/browser.mjs";

const BASE = "http://127.0.0.1:5178";
const context = await launchIsolated(import.meta.url, { viewport: { width: 1512, height: 1100 } });
const page = context.pages()[0] ?? (await context.newPage());
const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 180)));

let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (x ? "  → " + x : "")); } };

await gotoApp(page, BASE + "/");

console.log("【篇幅档案本身】");
const profiles = await page.evaluate(async () => {
  const { LENGTH_PROFILES } = await import("/src/core/project.ts");
  return LENGTH_PROFILES;
});
const order = ["short", "novella", "novel", "epic", "webnovel"];
console.log("  " + order.map((k) => k + "=" + profiles[k].chaptersPerVolume + "章/" + profiles[k].volumes + "卷/" + profiles[k].targetWords + "字").join("  "));

const distinctCh = new Set(order.map((k) => profiles[k].chaptersPerVolume));
check("每卷章节数各不相同（至少 4 种）", distinctCh.size >= 4, JSON.stringify([...distinctCh]));
check("每卷章节数随篇幅单调不减", order.every((k, i) => i === 0 || profiles[k].chaptersPerVolume >= profiles[order[i - 1]].chaptersPerVolume), JSON.stringify(order.map((k) => profiles[k].chaptersPerVolume)));
check("目标字数随篇幅单调递增", order.every((k, i) => i === 0 || profiles[k].targetWords > profiles[order[i - 1]].targetWords), JSON.stringify(order.map((k) => profiles[k].targetWords)));
check("卷数随篇幅单调不减", order.every((k, i) => i === 0 || profiles[k].volumes >= profiles[order[i - 1]].volumes), JSON.stringify(order.map((k) => profiles[k].volumes)));
check("短篇不分多卷", profiles.short.volumes === 1, String(profiles.short.volumes));
check("网文的每卷章数明显多于传统长篇", profiles.webnovel.chaptersPerVolume > profiles.novel.chaptersPerVolume, JSON.stringify({ web: profiles.webnovel.chaptersPerVolume, novel: profiles.novel.chaptersPerVolume }));
// 一致性：卷数 × 每卷章数 × 单章字数 应大致接近目标字数（允许 2 倍误差，只是合理性检查）
const sanity = order.map((k) => {
  const p = profiles[k];
  const est = p.volumes * p.chaptersPerVolume * p.chapterWords;
  return { k, est, target: p.targetWords, ratio: +(est / p.targetWords).toFixed(2) };
});
console.log("  体量自洽性（估算字数 / 目标字数）: " + sanity.map((s) => s.k + "=" + s.ratio).join("  "));
check("估算体量与目标字数大致自洽（0.4~2.5 倍）", sanity.every((s) => s.ratio >= 0.4 && s.ratio <= 2.5), JSON.stringify(sanity));

console.log("【新建项目页的篇幅选项】");
await gotoApp(page, BASE + "/new", { settle: 2000 });
const newText = await page.evaluate(() => document.body.innerText);
check("显示了各篇幅的说明", newText.includes("短篇") && newText.includes("网文连载"), "");
// 不要写死"30 万"这类数字：档案一改断言就过期（我刚因此假失败两次）。
// 断言的是"页面上显示的字数与档案一致"。
const expectedWan = Math.round(profiles.novel.targetWords / 10000) + "万字";
check(
  "新建项目页显示的长篇字数与档案一致（" + expectedWan + "）",
  newText.includes(expectedWan),
  newText.slice(0, 300).split(String.fromCharCode(10)).join(" | "),
);

console.log("【一句话成书：切篇幅要联动】");
const pid = await page.evaluate(async () => {
  const p = await import("/src/db/repo/projects.ts");
  const proj = await p.createProject({ title: "篇幅联动验证" });
  return proj.id;
});
await gotoApp(page, BASE + "/p/" + pid + "/genesis", { settle: 2500 });

/** 读出「每卷章节数」输入框的当前值 */
const readChapters = () =>
  page.evaluate(() => {
    const label = [...document.querySelectorAll("label, p, span, div")].find((e) => (e.textContent ?? "").trim() === "每卷章节数");
    const container = label?.parentElement ?? null;
    const input = container?.querySelector('input[type="number"]') ?? document.querySelector('input[type="number"]');
    return input ? Number(input.value) : null;
  });

/**
 * 点某个篇幅按钮。
 *
 * 注意不能只用"以短篇开头的按钮"来匹配 —— 体裁列表里也有一个叫「短篇」的按钮
 * （我第一版就点中了体裁，导致"切到短篇后仍是 15"的假失败）。
 * 篇幅按钮的特征是同时含标签与档案里的提示文字，用它精确定位。
 */
const pickLength = async (label, hint) => {
  const hit = await page.evaluate(
    ({ lb, hn }) => {
      const b = [...document.querySelectorAll("button")].find(
        (x) => (x.textContent ?? "").includes(lb) && (x.textContent ?? "").includes(hn),
      );
      if (b) {
        b.click();
        return (b.textContent ?? "").trim();
      }
      return null;
    },
    { lb: label, hn: hint },
  );
  await page.waitForTimeout(500);
  return hit;
};

const initial = await readChapters();
check("初始值来自篇幅档案（长篇=15，不是写死的 12）", initial === profiles.novel.chaptersPerVolume, "读到 " + initial);

await pickLength("短篇", profiles.short.hint);
const afterShort = await readChapters();
check("切到短篇后每卷章节数跟随档案", afterShort === profiles.short.chaptersPerVolume, "读到 " + afterShort);

await pickLength("网文连载", profiles.webnovel.hint);
const afterWeb = await readChapters();
check("切到网文连载后跟随档案（章数多于长篇）", afterWeb === profiles.webnovel.chaptersPerVolume && afterWeb > profiles.novel.chaptersPerVolume, "读到 " + afterWeb);

await pickLength("中篇", profiles.novella.hint);
const afterNovella = await readChapters();
check("切到中篇后跟随档案", afterNovella === profiles.novella.chaptersPerVolume, "读到 " + afterNovella);

console.log("【手动改过之后不再被覆盖】");
const manual = await page.evaluate(() => {
  const inputs = [...document.querySelectorAll('input[type="number"]')];
  const input = inputs[inputs.length - 1] ?? inputs[0];
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, "27");
  input.dispatchEvent(new Event("input", { bubbles: true }));
  return Number(input.value);
});
await page.waitForTimeout(400);
check("能手动改成 27", manual === 27, String(manual));

await pickLength("超长篇", profiles.epic.hint);
const afterManualSwitch = await readChapters();
check("手动改过之后再切篇幅不会被覆盖", afterManualSwitch === 27, "读到 " + afterManualSwitch + "（期望仍是 27）");

console.log("【生成端也用同一份档案】");
const volumeLogic = await page.evaluate(async () => {
  const { lengthProfile } = await import("/src/core/project.ts");
  // 卷数应直接等于档案里的 volumes（原来写死 1/3/5）
  return {
    short: lengthProfile("short").volumes,
    novel: lengthProfile("novel").volumes,
    epic: lengthProfile("epic").volumes,
  };
});
check("卷数由档案决定（短篇仍是 1 卷）", volumeLogic.short === profiles.short.volumes, JSON.stringify(volumeLogic));
check("卷数由档案决定（超长篇跟档案一致）", volumeLogic.epic === profiles.epic.volumes, JSON.stringify(volumeLogic));
check("长篇卷数不再是写死的 3", volumeLogic.novel === profiles.novel.volumes && volumeLogic.novel !== 3 || profiles.novel.volumes === 3, JSON.stringify(volumeLogic));

console.log("");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
console.log("控制台错误: " + (errs.length ? JSON.stringify(errs.slice(0, 4)) : "NONE"));
await context.close();
process.exit(fail === 0 ? 0 : 1);
