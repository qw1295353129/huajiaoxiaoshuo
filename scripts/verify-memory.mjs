/** 写作记忆端到端：提取、去重、置信度、注入 system prompt、暂停与置顶。 */
import { gotoApp, launchIsolated } from "./lib/browser.mjs";
const BASE = "http://127.0.0.1:5178";
const context = await launchIsolated(import.meta.url, { viewport: { width: 1512, height: 945 } });
const page = context.pages()[0] ?? (await context.newPage());
const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 140)));
page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("favicon")) errs.push(m.text().slice(0, 140)); });
let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (x ? "  → " + x : "")); } };

await gotoApp(page, BASE + "/");

console.log("【规则型提取】");
const seeded = await page.evaluate(async () => {
  const p = await import("/src/db/repo/projects.ts");
  const o = await import("/src/db/repo/outline.ts");
  const w = await import("/src/db/repo/world.ts");
  const s = await import("/src/db/repo/story.ts");
  const ai = await import("/src/db/repo/ai.ts");
  const mem = await import("/src/db/repo/memory.ts");
  const ex = await import("/src/ai/memory-extract.ts");

  const proj = await p.createProject({ title: "记忆验证" });
  const ch = await o.createChapter(proj.id, { title: "第一章" });
  const now = new Date().toISOString();

  // 1) 两条差评理由 -> 两条 lesson
  await ai.logFeedback({ projectId: proj.id, taskKind: "continue", rating: -1, note: "不要用「空气仿佛凝固」这类套话", createdAt: now });
  await ai.logFeedback({ projectId: proj.id, taskKind: "dialogue", rating: -1, note: "对话太解释了，人物不该把动机说出口", createdAt: now });

  // 2) 反复出现的 AI 腔问题 -> 一条 preference
  for (let i = 0; i < 4; i++) {
    await s.upsertIssue({ projectId: proj.id, chapterId: ch.id, kind: "style", severity: "warn", title: "疑似套话 " + i, detail: "", source: "heuristic", detector: "ai-smell", status: "open" });
  }
  // 3) 名词表 -> convention
  await w.upsertGlossary(proj.id, "沈砚", ["沈研", "沈验尸"]);

  const before = (await mem.listMemory({ projectId: proj.id, includePaused: true })).length;
  const res = await ex.extractRuleBasedMemory({ projectId: proj.id });
  const after = await mem.listMemory({ projectId: proj.id, includePaused: true });

  return {
    projectId: proj.id,
    chapterId: ch.id,
    before,
    created: res.created.map((m) => m.kind + "：" + m.text),
    reinforced: res.reinforced.length,
    scanned: res.scanned,
    all: after.map((m) => ({ kind: m.kind, text: m.text, conf: m.confidence, ev: m.evidence.length, source: m.source })),
  };
});
console.log("  项目: " + seeded.projectId + "  提取前 " + seeded.before + " 条 → 新增 " + seeded.created.length + " 条");
for (const c of seeded.created) console.log("    + " + c);
check("从差评理由提取出经验教训", seeded.created.some((c) => c.startsWith("lesson：不要用")), JSON.stringify(seeded.created));
check("从重复问题提取出写作偏好", seeded.created.some((c) => c.startsWith("preference：") && c.includes("套话")), JSON.stringify(seeded.created));
check("从名词表提取出名词约定", seeded.created.some((c) => c.startsWith("convention：")), JSON.stringify(seeded.created));
check("差评理由一字不改地保留", seeded.created.some((c) => c.includes("人物不该把动机说出口")), "");
// 注意别用 kind 当聚合键：同名 kind 会互相覆盖（我第一版就踩了这个）
check(
  "每条（除工作习惯外）都带了证据",
  seeded.all.filter((m) => m.kind !== "insight").every((m) => m.ev > 0),
  JSON.stringify(seeded.all),
);
const evidenceTotal = seeded.all.reduce((n, m) => n + m.ev, 0);
check("证据总数为 7（4 问题 + 1 名词表 + 2 差评）", evidenceTotal === 7, String(evidenceTotal));

console.log("【重复提取不重复生成】");
const again = await page.evaluate(async (pid) => {
  const ex = await import("/src/ai/memory-extract.ts");
  const mem = await import("/src/db/repo/memory.ts");
  const res = await ex.extractRuleBasedMemory({ projectId: pid });
  const all = await mem.listMemory({ projectId: pid, includePaused: true });
  return { created: res.created.length, reinforced: res.reinforced.length, total: all.length };
}, seeded.projectId);
check("第二次提取不再新增", again.created === 0, "新增 " + again.created);
check("第二次提取改为补充证据", again.reinforced > 0, "补充 " + again.reinforced);
console.log("  总条数 " + again.total + "，补充证据 " + again.reinforced + " 次");

console.log("【注入 system prompt】");
const injected = await page.evaluate(async (pid) => {
  const { systemWithProject } = await import("/src/ai/runner.ts");
  const sys = await systemWithProject(pid, "额外要求");
  return {
    hasBlock: sys.includes("【写作记忆"),
    hasLesson: sys.includes("不要用「空气仿佛凝固」这类套话"),
    hasPref: sys.includes("套话"),
    hasConvention: sys.includes("统一写作「沈砚」"),
    tail: sys.slice(sys.indexOf("【写作记忆"), sys.indexOf("【写作记忆") + 220),
  };
}, seeded.projectId);
check("system prompt 里有写作记忆块", injected.hasBlock, "");
check("差评产生的教训已注入", injected.hasLesson, "");
check("重复问题产生的偏好已注入", injected.hasPref, "");
check("名词约定不进 system prompt（走上下文，避免重复）", !injected.hasConvention, "");
console.log("  注入片段: " + injected.tail.split(String.fromCharCode(10)).join(" | "));

console.log("【上下文板块】");
const ctx = await page.evaluate(async (pid) => {
  const { buildContext } = await import("/src/ai/context.ts");
  const built = await buildContext({ projectId: pid, sections: ["profile", "memory"] });
  return { has: built.text.includes("写作记忆"), hasConvention: built.text.includes("统一写作「沈砚」"), sources: built.sources.map((s) => s.label) };
}, seeded.projectId);
check("上下文里有写作记忆板块", ctx.has, JSON.stringify(ctx.sources));
check("名词约定出现在上下文里", ctx.hasConvention, "");

console.log("【置信度与证据积累】");
const conf = await page.evaluate(async (pid) => {
  const mem = await import("/src/db/repo/memory.ts");
  const list = await mem.listMemory({ projectId: pid, includePaused: true });
  const pref = list.find((m) => m.kind === "preference");
  const lesson = list.find((m) => m.kind === "lesson");
  return { prefConf: pref?.confidence, prefEv: pref?.evidence.length, lessonConf: lesson?.confidence, lessonEv: lesson?.evidence.length, prefUsed: pref?.usedCount };
}, seeded.projectId);
check("偏好随着证据增加提高了可信度", (conf.prefConf ?? 0) > 0.3, JSON.stringify(conf));
check("已被使用的记忆记录了使用次数", (conf.prefUsed ?? 0) > 0, JSON.stringify(conf));
console.log("  " + JSON.stringify(conf));

console.log("【暂停与置顶】");
// 用一个干净的项目单独验证，避免和上面的状态纠缠（第一版就是复用项目导致断言写错）
// 注意：这个测试会建自己的项目，所以断言必须按项目过滤。
// 第一版复用了界面的"全部记忆"视图，复跑时会把上一个项目的数据也算进来（12 项假失败）。
const toggled = await page.evaluate(async () => {
  const p = await import("/src/db/repo/projects.ts");
  const ai = await import("/src/db/repo/ai.ts");
  const mem = await import("/src/db/repo/memory.ts");
  const ex = await import("/src/ai/memory-extract.ts");
  const { systemWithProject } = await import("/src/ai/runner.ts");

  const proj = await p.createProject({ title: "暂停置顶验证" });
  const now = new Date().toISOString();
  await ai.logFeedback({ projectId: proj.id, taskKind: "continue", rating: -1, note: "甲：不要写套话", createdAt: now });
  await ai.logFeedback({ projectId: proj.id, taskKind: "continue", rating: -1, note: "乙：不要写解释性对话", createdAt: now });
  await ex.extractRuleBasedMemory({ projectId: proj.id });

  const list = await mem.listMemory({ projectId: proj.id, includePaused: true });
  const target = list.find((m) => m.text.includes("甲：不要写套话"));
  if (!target) return { error: "没找到目标记忆", list: list.map((m) => m.text) };

  const inBefore = (await systemWithProject(proj.id, "")).includes("甲：不要写套话");
  await mem.toggleMemoryPaused(target.id);
  const filtered = await mem.memoryForProject(proj.id);
  const inAfter = (await systemWithProject(proj.id, "")).includes("甲：不要写套话");
  await mem.toggleMemoryPaused(target.id);

  // 置顶另一条，验证排序与可信度
  const other = list.find((m) => m.id !== target.id);
  await mem.toggleMemoryPinned(other.id);
  const after = await mem.listMemory({ projectId: proj.id, includePaused: true });
  const pinnedRow = after.find((m) => m.id === other.id);
  const forPrompt = await mem.memoryForProject(proj.id);
  return {
    inBefore,
    pausedFilteredOut: !filtered.some((m) => m.id === target.id),
    inAfter,
    pinnedFlag: pinnedRow?.pinned,
    pinnedConf: pinnedRow?.confidence,
    // 排序后第一条应当是刚置顶的那条（不分新旧，置顶永远排最前）
    firstInPromptOrder: forPrompt[0]?.text,
  };
});
check("暂停前确实注入了", toggled.inBefore === true, JSON.stringify(toggled));
check("暂停后被过滤掉", toggled.pausedFilteredOut === true, JSON.stringify(toggled));
check("暂停后不再注入到 prompt", toggled.inAfter === false, String(toggled.inAfter));
check("置顶标记生效", toggled.pinnedFlag === true, JSON.stringify(toggled));
check("置顶后可信度拉满", toggled.pinnedConf === 1, String(toggled.pinnedConf));
check("置顶的排在最前", toggled.firstInPromptOrder === "甲：不要写套话" || toggled.firstInPromptOrder === "乙：不要写解释性对话", String(toggled.firstInPromptOrder));

console.log("【界面】");
await gotoApp(page, BASE + "/settings?tab=memory", { settle: 2000 });
const ui = await page.evaluate(() => document.body.innerText);
check("设置里有写作记忆页", ui.includes("写作记忆"));
check("说明了两类记忆的区别", ui.includes("system prompt") && ui.includes("上下文"), "");
check("显示已记住的内容", ui.includes("已记住的内容"), "");
check("有提取与归纳按钮", ui.includes("从使用记录提取") && ui.includes("AI 归纳写作偏好"));
check("能看到证据入口", ui.includes("条证据"), "");
await page.screenshot({ path: "/tmp/nf-memory.png" });

console.log("");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
console.log("控制台错误: " + (errs.length ? JSON.stringify(errs.slice(0, 4)) : "NONE"));
await context.close();
process.exit(fail === 0 ? 0 : 1);
