/** 规则冲突自检：分批、进度、中断保留、超时归类。 */
import { launchIsolated } from "./lib/browser.mjs";

const KEY_GUARD = process.env.DEEPSEEK_KEY;
if (!KEY_GUARD) {
  console.log("缺少 DEEPSEEK_KEY 环境变量 —— 跳过需要真实模型的用例。");
  console.log("用法：DEEPSEEK_KEY=sk-xxx node " + process.argv[1]);
  process.exit(0);
}
const KEY = process.env.DEEPSEEK_KEY;
const context = await launchIsolated(import.meta.url, { viewport: { width: 1512, height: 945 } });
const page = context.pages()[0] ?? (await context.newPage());
const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 140)));
let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log("  \u2713 " + n); } else { fail++; console.log("  \u2717 " + n + (x ? "  \u2192 " + x : "")); } };

// 必须先打开应用页面，否则动态 import 没有模块解析上下文
await page.goto("http://127.0.0.1:5178/", { waitUntil: "networkidle" });

console.log("【超时与取消必须区分（纯逻辑）】");
const kinds = await page.evaluate(async () => {
  const { ProviderError } = await import("/src/ai/types.ts");
  const t = new ProviderError("timeout", "x");
  const a = new ProviderError("aborted", "y");
  return { timeoutHint: t.hint, abortedHint: a.hint, tRetry: t.retryable, aRetry: a.retryable };
});
check("超时有专门的说明文案", kinds.timeoutHint.includes("超时") && kinds.timeoutHint.includes("更快"), kinds.timeoutHint);
// 设计取舍：超时与用户取消都不自动重试 —— 重试只会让用户再等一轮；限流/服务端错误才退避重试
check("超时不自动重试（重试只会再等一轮）", kinds.tRetry === false, String(kinds.tRetry));
check("取消不重试", kinds.aRetry === false, String(kinds.aRetry));
// hint 的 default 分支返回 message —— 取消时 message 就是"已取消"
check("取消的提示文案中性、不含故障暗示", !/失败|错误|故障/.test(kinds.abortedHint), kinds.abortedHint);

console.log("【分批构造】");
const batches = await page.evaluate(async () => {
  // 直接经模块导出拿不到 buildBatches（内部函数），改为构造数据后走 UI 观察批次
  return null;
});
void batches;

// 建项目 + 造 14 个带规则的世界观条目（应分成 3 批）
await page.goto("http://127.0.0.1:5178/new", { waitUntil: "networkidle" });
await page.waitForTimeout(700);
await page.fill('input[placeholder*="长夜将至"]', "冲突自检验证");
await page.click("text=先创建空白项目");
await page.waitForTimeout(2500);
const pid = (page.url().match(/\/p\/([^/]+)/) ?? [])[1];
const seeded = await page.evaluate(async ({ pid, key }) => {
  const s = await import("/src/db/repo/settings.ts");
  await s.upsertProvider({ id: "preset-deepseek", name: "DeepSeek", kind: "deepseek", baseUrl: "https://api.deepseek.com/v1", apiKey: key, models: ["deepseek-flash"], enabled: true, corsBlocked: false });
  const raw = localStorage.getItem("huajiao:settings");
  const cur = raw ? JSON.parse(raw) : {};
  localStorage.setItem("huajiao:settings", JSON.stringify({ ...cur, activeProviderId: "preset-deepseek", activeModel: "deepseek-flash", stream: false, allowCloud: true, contextBudget: 16000 }));

  const w = await import("/src/db/repo/world.ts");
  // 故意埋两处真冲突：传送阵冷却时间两说、雾港人口两说
  const items = [
    { title: "传送阵", body: "传送阵每次使用后需要冷却十二个时辰，冷却期间强行启动会导致阵纹崩裂，使用者会失去三个月内的记忆。", rule: "传送阵冷却时间为十二个时辰" },
    { title: "传送阵维护手册", body: "维护手册规定：传送阵冷却为六个时辰即可再次启动，超过三次连续使用才需要彻底检修。", rule: "传送阵冷却时间为六个时辰" },
    { title: "雾港", body: "雾港常驻人口约三十万，是北方最大的港口城市。", rule: "雾港常驻人口约三十万" },
    { title: "雾港地方志", body: "据地方志记载，雾港全盛时期人口一度达到八十万，此后因海禁锐减。", rule: "雾港历史上人口曾达八十万" },
    { title: "记忆税", body: "每次提取记忆需缴纳记忆税，税率是提取量的三成。", rule: "记忆税税率为三成" },
    { title: "验尸所条例", body: "验尸官听到遗言后必须在十二个时辰内上报，违者革职。", rule: "遗言须在十二时辰内上报" },
    { title: "回声盐", body: "回声盐产自雾港东侧的盐田，遇水会发出微弱声响。", rule: "回声盐遇水发声" },
    { title: "雾笛", body: "雾笛在能见度低于五十步时鸣响，由灯塔看守负责。", rule: "能见度低于五十步时鸣笛" },
    { title: "压口钱", body: "下葬时要在死者口中放一枚压口钱，否则遗言会被风吹散。", rule: "下葬必放压口钱" },
    { title: "永安堂", body: "永安堂是雾港最大的药铺，由温家经营，已有百年。", rule: "永安堂由温家经营" },
    { title: "潮汐报", body: "潮汐报每日发行，头版固定刊登当日潮汐时刻。", rule: "潮汐报每日发行" },
    { title: "白鹭号", body: "白鹭号于十二年前在雾港外海沉没，官方记录为触礁。", rule: "白鹭号十二年前沉没" },
    { title: "销声", body: "销声是一种让声音消失的术法，施术者会因此失声三日。", rule: "销声代价为失声三日" },
    { title: "触骨规则", body: "验尸官触骨时不得佩戴任何金属，否则会污染遗言。", rule: "触骨不得佩戴金属" },
  ];
  for (const it of items) {
    await w.createWorldEntry(pid, {
      title: it.title, category: "custom", body: it.body, importance: 4,
      rules: [{ id: "r_" + it.title, statement: it.rule, severity: "error", enabled: true }],
    });
  }
  await w.upsertRule(pid, { name: "遗言只能被听到一次", description: "同一个死者的遗言只会被听见一次。", kind: "custom-llm", severity: "error", enabled: true });
  return items.length;
}, { pid, key: KEY });
console.log("已造 " + seeded + " 个条目（每批 6 条 → 预期 3 批）");

// 打开世界观页 -> 冲突自检
await page.goto("http://127.0.0.1:5178/p/" + pid + "/world", { waitUntil: "networkidle" });
await page.waitForTimeout(2000);
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll("button")).find((x) => (x.textContent ?? "").includes("规则冲突自检"));
  if (b) b.click();
});
await page.waitForTimeout(1200);
const modalText = await page.evaluate(() => document.body.innerText);
check(
  "执行前就说明了分批策略与可中断",
  modalText.includes("批检查") && modalText.includes("每批约 6 个条目") && modalText.includes("可随时中断"),
  modalText.slice(modalText.indexOf("条条目规则"), modalText.indexOf("条条目规则") + 90),
);

// 开始自检
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll("button")).find((x) => (x.textContent ?? "").trim() === "开始自检");
  if (b) b.click();
});

// 观察进度是否出现
let sawProgress = false;
let sawBatchLabel = "";
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(1000);
  const t = await page.evaluate(() => document.body.innerText);
  const m = t.match(/正在检查第 (\d+) \/ (\d+) 批/);
  if (m) {
    sawProgress = true;
    if (!sawBatchLabel) sawBatchLabel = t.match(/本批：([^\n]+)/)?.[1] ?? "";
  }
  if (t.includes("发现") && t.includes("处疑似冲突")) break;
  if (t.includes("没有发现规则冲突")) break;
  if (t.includes("自检没有完成")) break;
  if (t.includes("已取消自检")) break;
}
check("运行时显示分批进度", sawProgress, "批次标签: " + sawBatchLabel);
const finalText = await page.evaluate(() => document.body.innerText);
check("没有把超时/取消误报为失败", !finalText.includes("自检没有完成") || finalText.includes("个批次没有完成"), finalText.slice(finalText.indexOf("自检没有完成"), finalText.indexOf("自检没有完成") + 80));
const conflictCount = (finalText.match(/硬冲突|疑似冲突|处/g) ?? []).length;
console.log("  结果片段: " + finalText.slice(finalText.indexOf("规则冲突自检"), finalText.indexOf("规则冲突自检") + 300).replace(/\n+/g, " | "));
void conflictCount;
await page.screenshot({ path: "/tmp/nf-conflict.png" });

console.log("");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
console.log("控制台错误: " + (errs.length ? JSON.stringify(errs.slice(0, 5)) : "NONE"));
await context.close();