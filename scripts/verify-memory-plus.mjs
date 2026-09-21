/**
 * 记忆三件套端到端回归：
 *   一、冲突检测的纯函数单测（正例 + 反例，重点验证"相似但不冲突不误报"）
 *   二、冲突检测的数据层与处置（裁决后不重复提示、合并、新记忆即时提示）
 *   三、效果追踪（注入 → 记录 → 差评 → 差评率上升 → 建议暂停）
 *   四、语义召回（假 embedding 端点验证召回排序、缓存、内容变更重算、降级、熔断、置顶）
 *   五、默认关闭时的行为回归（与改动前逐字一致，且一个额外请求都不发）
 *   六、界面（冲突条、注入次数与差评率、语义召回设置、真实点击裁决）
 *
 * 不依赖任何真实服务：聊天补全与向量端点都由页面里 monkey-patch 的 fetch 回答。
 * 假向量用"字符二元组哈希"算，保证语义相近的文本余弦相似度真的更高 ——
 * 如果用随机向量，召回排序测了等于没测。
 */
import { gotoApp, launchIsolated, waitFor } from "./lib/browser.mjs";
const BASE = "http://127.0.0.1:5178";
const NL = String.fromCharCode(10);
const context = await launchIsolated(import.meta.url, { viewport: { width: 1512, height: 945 } });
const page = context.pages()[0] ?? (await context.newPage());
const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 160)));
page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("favicon")) errs.push(m.text().slice(0, 160)); });
let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (x ? "  → " + x : "")); } };
const section = (t) => console.log(NL + "【" + t + "】");

/**
 * 假 fetch。用 addInitScript 装，页面刷新后依然生效。
 * 聊天端点：返回固定正文（让 runText 能真的跑完并落库）。
 * 向量端点：Ollama 风格与 OpenAI 兼容风格都支持，方便两种来源各测一遍。
 */
await page.addInitScript(() => {
  const state = { chat: 0, embed: 0, failEmbed: false, failChat: false, dim: 8192 };
  window.__fake = state;
  // 维度必须够大：64 维时哈希冲突会让无关文本也拿到正相似度，召回排序就测不准了
  const vec = (text, dim) => {
    const d = dim || state.dim;
    const v = new Array(d).fill(0);
    const t = String(text == null ? "" : text).replace(/\s|\p{P}/gu, "");
    for (let i = 0; i < t.length; i++) {
      const g = t.slice(i, i + 2) || t[i];
      let h = 0;
      for (const ch of g) h = (h * 31 + ch.codePointAt(0)) >>> 0;
      v[h % d] += 1;
    }
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
    return v.map((x) => x / norm);
  };
  const json = (body, status) => new Response(JSON.stringify(body), { status: status || 200, headers: { "Content-Type": "application/json" } });
  const real = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    if (url.indexOf("/chat/completions") >= 0) {
      state.chat += 1;
      if (state.failChat) return json({ error: { message: "假模型故障" } }, 500);
      return json({
        choices: [{ message: { content: "假模型输出 " + state.chat }, finish_reason: "stop" }],
        usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
      });
    }
    if (url.indexOf("/embeddings") >= 0 || url.indexOf("/api/embed") >= 0) {
      state.embed += 1;
      if (state.failEmbed) throw new TypeError("Failed to fetch");
      const body = init && init.body ? JSON.parse(String(init.body)) : {};
      const raw = body.prompt !== undefined ? body.prompt : body.input;
      const texts = Array.isArray(raw) ? raw : [raw];
      state.lastTexts = texts.slice(0, 3);
      if (url.indexOf("/api/") >= 0) return json({ embedding: vec(texts[0]) });
      return json({ model: body.model, data: texts.map((t, i) => ({ index: i, embedding: vec(t) })) });
    }
    return real(input, init);
  };
});

await gotoApp(page, BASE + "/");

/* ================================================================== *
 * 一、冲突检测纯函数
 * ================================================================== */
section("一、冲突检测纯函数（正例 + 反例）");
const pure = await page.evaluate(async () => {
  const mc = await import("/src/core/memory-conflict.ts");
  const mk = (kind, text, extra) => Object.assign({
    id: "m_" + Math.random().toString(36).slice(2, 9),
    scope: "global", kind, text, source: "user", evidence: [], confidence: 1,
    pinned: false, paused: false, usedCount: 0,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  }, extra || {});
  const positives = [
    ["一禁一求（套话）", ["preference", "不要用「空气仿佛凝固」这类套话"], ["preference", "多用「空气仿佛凝固」这类套话"], "negation"],
    ["不要写 vs 多写", ["preference", "不要写解释性对话"], ["lesson", "多写解释性对话"], "negation"],
    ["避免 vs 保持", ["lesson", "避免长段心理描写"], ["preference", "保持长段心理描写"], "negation"],
    ["温度轴：冷硬 vs 温暖细腻", ["preference", "文风要冷硬"], ["preference", "文风要温暖细腻"], "antonym"],
    ["密度轴：简洁 vs 华丽", ["preference", "语言要简洁"], ["preference", "语言要华丽"], "antonym"],
    ["同一话题面内一冷一暖", ["preference", "对话要克制"], ["preference", "对话要细腻"], "antonym"],
  ];
  const negatives = [
    ["相似但同向（解释性 vs 说明性）", ["preference", "对话不要用解释性台词"], ["preference", "对话不要用说明性台词"]],
    ["不同话题面（对话克制 vs 描写细腻）", ["preference", "对话要克制"], ["preference", "描写要细腻"]],
    ["同 kind 无对立（冷硬 vs 第三人称）", ["preference", "文风要冷硬"], ["preference", "用第三人称视角"]],
    ["无关事实（铜钟 vs 住址）", ["fact", "铜钟只在死者出现时响"], ["fact", "沈砚住在城南"]],
    ["工作习惯不进模型", ["insight", "平均每次写作会话新增 1200 字"], ["insight", "平均每次写作会话新增 800 字"]],
    ["跨 kind 家族（偏好 vs 设定）", ["preference", "文风要冷硬"], ["fact", "文风要温暖细腻"]],
    ["任务范围不相交", ["preference", "文风要冷硬", { taskKinds: ["continue"] }], ["preference", "文风要温暖细腻", { taskKinds: ["polish"] }]],
    ["已暂停的不参与", ["preference", "文风要冷硬"], ["preference", "文风要温暖细腻", { paused: true }]],
    ["否定轴词不算反义（冷硬+不要抒情）", ["preference", "文风要冷硬，不要抒情"], ["preference", "文风要冷硬"]],
  ];
  const results = [];
  for (const c of positives) {
    const r = mc.detectMemoryConflict(mk(c[1][0], c[1][1], c[1][2]), mk(c[2][0], c[2][1], c[2][2]));
    results.push({ name: c[0], group: "pos", want: c[3], got: r ? r.type : null, reason: r ? r.reason : "", sim: r ? Number(r.similarity.toFixed(2)) : 0 });
  }
  for (const c of negatives) {
    const r = mc.detectMemoryConflict(mk(c[1][0], c[1][1], c[1][2]), mk(c[2][0], c[2][1], c[2][2]));
    results.push({ name: c[0], group: "neg", want: null, got: r ? r.type : null, reason: r ? r.reason : "", sim: r ? Number(r.similarity.toFixed(2)) : 0 });
  }
  const sim = {
    same: Number(mc.textSimilarity("不要写套话", "不要写套话").toFixed(2)),
    para: Number(mc.textSimilarity("对话不要用解释性台词", "对话不要用说明性台词").toFixed(2)),
    reordered: Number(mc.textSimilarity("文风要冷硬", "要冷硬的文风").toFixed(2)),
    far: Number(mc.textSimilarity("对话不要用解释性台词", "第三章要多写雨景与潮气").toFixed(2)),
  };
  const A = mk("preference", "不要写解释性对话");
  const B = mk("preference", "多写解释性对话");
  const C = mk("preference", "文风要冷硬");
  const D = mk("preference", "文风要温暖细腻");
  const batch = mc.findMemoryConflicts([A, B, C, D, mk("preference", "每章结尾留钩子")]);
  const resolvedA = Object.assign({}, A, { conflictsResolvedWith: [B.id] });
  const afterResolve = mc.findMemoryConflicts([resolvedA, B]);
  const dup = mc.isNearDuplicate("对话不要用解释性台词", "对话不要用说明性台词");
  const dupFar = mc.isNearDuplicate("对话不要用解释性台词", "第三章要多写雨景");
  // 规模与耗时：成对比较是 O(n²)，要知道"记忆涨到几百条时会不会卡住面板"
  const big = [];
  for (let i = 0; i < 120; i++) {
    big.push(mk("preference", i % 2 === 0 ? "第 " + i + " 条：对话不要用解释性台词" : "第 " + i + " 条：注意段落节奏与标点规范"));
  }
  big.push(mk("preference", "文风要冷硬"));
  big.push(mk("preference", "文风要温暖细腻"));
  const t0 = performance.now();
  const bigFound = mc.findMemoryConflicts(big);
  const scaleMs = Number((performance.now() - t0).toFixed(1));
  return {
    results, sim, batch: batch.map((x) => x.type), afterResolve: afterResolve.length, dup, dupFar,
    scaleMs, scaleCount: big.length, scaleFound: bigFound.length,
  };
});
for (const r of pure.results) {
  const ok = r.group === "pos" ? r.got === r.want : r.got === null;
  check("单测 " + (r.group === "pos" ? "正例" : "反例") + "：" + r.name, ok, "got=" + r.got + " want=" + r.want + " " + r.reason);
}
console.log("  相似度：完全同句 " + pure.sim.same + " · 同义改写 " + pure.sim.para + " · 语序调换 " + pure.sim.reordered + " · 无关 " + pure.sim.far);
check("同一句话相似度为 1", pure.sim.same === 1, String(pure.sim.same));
check("同义改写相似度 > 0.7（相似度够高但不是冲突）", pure.sim.para > 0.7, String(pure.sim.para));
check("无关文本相似度 < 0.25", pure.sim.far < 0.25, String(pure.sim.far));
check("批量扫描扫出 2 处冲突（否定对立 + 反义维度）", pure.batch.length === 2, JSON.stringify(pure.batch));
check("已处置的组合不再出现在扫描结果里", pure.afterResolve === 0, String(pure.afterResolve));
check("重复检测：同义改写判定为重复", pure.dup === true, String(pure.dup));
check("重复检测：无关文本不判定为重复", pure.dupFar === false, String(pure.dupFar));
check("规模：" + pure.scaleCount + " 条记忆两两比较耗时可接受（" + pure.scaleMs + " ms）", pure.scaleMs < 500, pure.scaleMs + " ms");
check("规模：120 条里只扫出该有的冲突（不误报）", pure.scaleFound === 1, "扫出 " + pure.scaleFound + " 处");
const oneReason = pure.results.find((r) => r.reason);
console.log("  冲突理由示例：" + oneReason.reason);

/* ================================================================== *
 * 二、冲突检测：数据层与处置
 * ================================================================== */
section("二、冲突检测：数据层与处置");
const conflictE2E = await page.evaluate(async () => {
  const p = await import("/src/db/repo/projects.ts");
  const mem = await import("/src/db/repo/memory.ts");
  const { systemWithProject } = await import("/src/ai/runner.ts");
  const proj = await p.createProject({ title: "冲突检测验证" });

  const a = await mem.addMemory({ scope: "project", projectId: proj.id, kind: "preference", text: "文风要冷硬，不要抒情" });
  const b = await mem.addMemory({ scope: "project", projectId: proj.id, kind: "preference", text: "文风要温暖细腻" });
  const sys = await systemWithProject(proj.id);
  const plain = await mem.scanMemoryConflicts(proj.id);

  await mem.resolveMemoryConflict(a.id, b.id, "keep-a");
  const afterKeepA = (await mem.scanMemoryConflicts(proj.id)).length;
  const bPaused = (await mem.listMemory({ projectId: proj.id, includePaused: true })).find((m) => m.id === b.id);

  await mem.toggleMemoryPaused(b.id);
  const afterResume = (await mem.scanMemoryConflicts(proj.id)).length;

  const c = await mem.addMemory({ scope: "project", projectId: proj.id, kind: "preference", text: "对话不要用解释性台词" });
  const d = await mem.addMemory({ scope: "project", projectId: proj.id, kind: "preference", text: "对话要多用解释性台词" });
  await mem.resolveMemoryConflict(c.id, d.id, "keep-both");
  const bothScan = (await mem.scanMemoryConflicts(proj.id)).length;
  const bothRows = (await mem.listMemory({ projectId: proj.id, includePaused: true })).filter((m) => m.id === c.id || m.id === d.id);

  const e = await mem.addMemory({ scope: "project", projectId: proj.id, kind: "preference", text: "节奏要快，不要拖" });
  const f = await mem.addMemory({ scope: "project", projectId: proj.id, kind: "preference", text: "节奏要慢，要舒缓" });
  const merged = await mem.resolveMemoryConflict(e.id, f.id, "merge", { mergedText: "整体节奏要快，但每章留一处呼吸" });
  const afterMerge = (await mem.scanMemoryConflicts(proj.id)).length;
  const mergeRows = (await mem.listMemory({ projectId: proj.id, includePaused: true })).filter((m) => m.id === e.id || m.id === f.id);

  const preview = await mem.previewMemoryConflicts({ scope: "project", projectId: proj.id, kind: "preference", text: "文风要温暖细腻" }, proj.id);
  const previewDup = await mem.previewNearDuplicates({ scope: "project", projectId: proj.id, kind: "preference", text: "文风要冷硬，不要抒情" }, proj.id);

  return {
    projectId: proj.id,
    promptHasBoth: sys.indexOf("文风要冷硬") >= 0 && sys.indexOf("文风要温暖细腻") >= 0,
    plainCount: plain.length,
    plainType: plain[0] ? plain[0].conflict.type : null,
    plainReason: plain[0] ? plain[0].conflict.reason : "",
    aId: a.id, bId: b.id,
    afterKeepA,
    bPaused: bPaused ? bPaused.paused : null,
    afterResume,
    bothScan,
    bothPinned: bothRows.every((m) => m.pinned),
    afterMerge,
    mergedText: merged ? merged.text : null,
    mergedPinned: merged ? merged.pinned : null,
    mergeOriginalsPaused: mergeRows.every((m) => m.paused),
    previewCount: preview.length,
    previewHitsA: preview.some((x) => x.b.id === a.id),
    previewDupCount: previewDup.length,
    previewDupTop: previewDup[0] ? Number(previewDup[0].similarity.toFixed(2)) : 0,
  };
});
check("冲突的记忆确实会被同时注入 prompt（这就是问题本身）", conflictE2E.promptHasBoth === true, "");
check("扫描出 1 对冲突", conflictE2E.plainCount === 1, String(conflictE2E.plainCount));
check("冲突类型判定为取向相反", conflictE2E.plainType === "antonym", String(conflictE2E.plainType));
console.log("  冲突理由：" + conflictE2E.plainReason);
check("「保留 A」把 B 暂停（不是删除）", conflictE2E.bPaused === true, String(conflictE2E.bPaused));
check("处置后冲突条不再显示这一对", conflictE2E.afterKeepA === 0, String(conflictE2E.afterKeepA));
check("把 B 恢复后也不会重复提示（决定被记住了）", conflictE2E.afterResume === 0, String(conflictE2E.afterResume));
check("「两条都保留并置顶」两条都 pinned 且不再提示", conflictE2E.bothPinned === true && conflictE2E.bothScan === 0, JSON.stringify({ pinned: conflictE2E.bothPinned, scan: conflictE2E.bothScan }));
check("「合并成一条」生成了新记忆", conflictE2E.mergedText === "整体节奏要快，但每章留一处呼吸", String(conflictE2E.mergedText));
check("合并出来的那条是置顶的", conflictE2E.mergedPinned === true, String(conflictE2E.mergedPinned));
check("合并后原来两条被暂停且不再提示", conflictE2E.mergeOriginalsPaused === true && conflictE2E.afterMerge === 0, JSON.stringify({ paused: conflictE2E.mergeOriginalsPaused, scan: conflictE2E.afterMerge }));
check("新记忆入库前能预检到与已有记忆冲突", conflictE2E.previewCount === 1 && conflictE2E.previewHitsA === true, JSON.stringify({ count: conflictE2E.previewCount, hitA: conflictE2E.previewHitsA }));
check("新记忆入库前能识别出重复", conflictE2E.previewDupCount === 1 && conflictE2E.previewDupTop === 1, JSON.stringify({ count: conflictE2E.previewDupCount, sim: conflictE2E.previewDupTop }));

/* ================================================================== *
 * 三、语义召回
 * ================================================================== */
section("三、语义召回（假向量端点）");
const setup = await page.evaluate(async () => {
  const s = await import("/src/db/repo/settings.ts");
  await s.seedProviders();
  const prov = await s.upsertProvider({ name: "离线假模型", kind: "openai", baseUrl: "http://127.0.0.1:59999/v1", models: ["fake-model", "fake-embed"] });
  await s.seedRouting();
  await s.updateRouting("continue", { primary: prov.id + "::fake-model" });
  await s.updateRouting("chat", { primary: prov.id + "::fake-model" });
  return { providerId: prov.id };
});
console.log("  已配置离线假模型供应商：" + setup.providerId);

const sem = await page.evaluate(async (providerId) => {
  const p = await import("/src/db/repo/projects.ts");
  const o = await import("/src/db/repo/outline.ts");
  const mem = await import("/src/db/repo/memory.ts");
  const ai = await import("/src/db/repo/ai.ts");
  const s = await import("/src/db/repo/settings.ts");
  const rc = await import("/src/ai/recall.ts");
  const { systemWithProject } = await import("/src/ai/runner.ts");
  const NLx = String.fromCharCode(10);

  const proj = await p.createProject({ title: "语义召回验证" });
  const ch = await o.createChapter(proj.id, { title: "雨夜", summary: "主角在雨里等一个人，雨声盖住了脚步" });
  // 正文里出现与那条记忆相同的关键词（雨声/潮气/体感）：真实场景本就如此，
  // 记忆之所以"相关"，正是因为正文里能对上。
  await o.saveChapterContent(ch.id, "<p>" + "雨点砸在铁皮棚上，雨声密得像有人在数钱。潮气从领口钻进来，体感冷得发抖。".repeat(3) + "</p>");

  const rain = await mem.addMemory({
    scope: "project", projectId: proj.id, kind: "preference", source: "feedback",
    text: "下雨的场景要多写雨声、潮气与体感",
    evidence: [{ kind: "feedback", quote: "雨写得太平了", at: new Date().toISOString() }],
  });
  const fillers = [];
  for (let i = 0; i < 12; i++) {
    fillers.push(await mem.addMemory({ scope: "project", projectId: proj.id, kind: "preference", source: "user", text: "第 " + (i + 1) + " 条通用规则：注意段落节奏与标点规范" }));
  }

  const base = s.loadSettings();
  const cfgOff = { enabled: false, source: "ollama", model: "nomic-embed-text", endpoint: "http://127.0.0.1:11434/api/embeddings", topK: 8 };
  const cfgOn = { enabled: true, source: "ollama", model: "nomic-embed-text", endpoint: "http://127.0.0.1:11434/api/embeddings", topK: 8 };

  // ---- 默认关闭 ----
  s.saveSettings(Object.assign({}, base, { semanticRecall: cfgOff }));
  const callsBeforeOff = window.__fake.embed;
  const sysOff = await systemWithProject(proj.id);
  const callsOff = window.__fake.embed - callsBeforeOff;
  const order = await mem.memoryForProject(proj.id);
  const expected = order.filter((m) => m.kind === "preference" || m.kind === "lesson").slice(0, 12);
  const expectedBlock = expected.map((m) => "- " + m.text).join(NLx);
  const explicitOff = await rc.recallMemories({ projectId: proj.id, facts: order });

  // ---- 开启 ----
  s.saveSettings(Object.assign({}, base, { semanticRecall: cfgOn }));
  const callsBeforeOn = window.__fake.embed;
  const sysOn = await systemWithProject(proj.id);
  const callsOn = window.__fake.embed - callsBeforeOn;
  const recalled = await rc.recallMemories({ projectId: proj.id, facts: await mem.memoryForProject(proj.id) });

  // ---- 缓存：再召回一次，一个请求都不该发 ----
  const cacheBefore = window.__fake.embed;
  const again = await rc.recallMemories({ projectId: proj.id, facts: await mem.memoryForProject(proj.id) });
  const cacheCalls = window.__fake.embed - cacheBefore;
  const all1 = await mem.memoryForProject(proj.id);
  const rows = await ai.listEmbeddings(proj.id, "memory");
  const rowsMatchText = rows.every((r) => {
    const f = all1.find((m) => m.id === r.refId);
    return Boolean(f) && r.text === f.text && r.model === "nomic-embed-text" && r.vector.length === 8192;
  });

  // ---- 内容变了才重算：只应多出 1 次请求 ----
  await mem.updateMemory(rain.id, { text: "下雨的场景要多写雨声、潮气与体感，不要用比喻" });
  const recomputeBefore = window.__fake.embed;
  const afterEdit = await rc.recallMemories({ projectId: proj.id, facts: await mem.memoryForProject(proj.id) });
  const recomputeCalls = window.__fake.embed - recomputeBefore;

  // ---- 置顶永远注入 ----
  await mem.toggleMemoryPinned(fillers[0].id);
  const pinnedFacts = await mem.memoryForProject(proj.id);
  const pinnedRecall = await rc.recallMemories({ projectId: proj.id, facts: pinnedFacts });

  // ---- 纯函数：合并顺序（用置顶之后的快照，别拿旧对象当输入） ----
  const merged = rc.mergeRecallOrder(pinnedFacts, [fillers[5].id, rain.id], 4);

  return {
    projectId: proj.id,
    rainId: rain.id,
    fillerCount: fillers.length,
    ruleOrderLast: order.slice(-1)[0] ? order.slice(-1)[0].text : "",
    callsOff,
    ruleOrderOk: sysOff.indexOf(expectedBlock) >= 0,
    offHasRain: sysOff.indexOf("下雨的场景") >= 0,
    explicitOffSemantic: explicitOff.semantic,
    onHasRain: sysOn.indexOf("下雨的场景") >= 0,
    callsOn,
    recalledSemantic: recalled.semantic,
    recalledPicked: recalled.pickedIds.indexOf(rain.id) >= 0,
    pickedTexts: recalled.pickedIds.map((id) => {
      const f = order.find((m) => m.id === id);
      return f ? f.text.slice(0, 16) : id;
    }),
    pickedCount: recalled.pickedIds.length,
    cacheCalls,
    againSemantic: again.semantic,
    embRows: rows.length,
    rowsMatchText,
    recomputeCalls,
    afterEditSemantic: afterEdit.semantic,
    afterEditPicked: afterEdit.pickedIds.indexOf(rain.id) >= 0,
    pinnedFirst: pinnedRecall.facts[0] ? pinnedRecall.facts[0].id === fillers[0].id : false,
    pinnedStillSemantic: pinnedRecall.semantic,
    mergedOrderLen: merged.length,
    mergedFirstIsPinned: merged[0] ? merged[0].pinned : false,
    mergedHasPicked: merged.some((m) => m.id === rain.id),
    mergedUnique: new Set(merged.map((m) => m.id)).size === merged.length,
  };
});

/**
 * 降级与熔断只能在"模块内存态全新"的页面里测。
 *
 * 为什么必须刷新：查询向量缓存与熔断器都活在模块作用域里，而 Vite 开发服务器
 * 把应用模块当作 "/src/ai/embedding.ts?t=时间戳" 加载 —— evaluate 里写
 * import("/src/ai/embedding.ts") 拿到的是**另一个模块实例**，调它的
 * resetEmbeddingBreaker() 影响不到应用那条链路（第一版就栽在这里：
 * 降级测试"通过了"，其实根本没走到失败路径）。刷新页面才是真正的重置。
 * 详见 docs/GOTCHAS.md。
 */
await gotoApp(page, BASE + "/");
const degraded = await page.evaluate(async (pid) => {
  const mem = await import("/src/db/repo/memory.ts");
  const rc = await import("/src/ai/recall.ts");
  const { systemWithProject } = await import("/src/ai/runner.ts");
  window.__fake.failEmbed = true;
  const b1 = window.__fake.embed;
  const r1 = await rc.recallMemories({ projectId: pid, facts: await mem.memoryForProject(pid) });
  const attempts = window.__fake.embed - b1;
  const b2 = window.__fake.embed;
  const r2 = await rc.recallMemories({ projectId: pid, facts: await mem.memoryForProject(pid) });
  const breakAttempts = window.__fake.embed - b2;
  const b3 = window.__fake.embed;
  const sys = await systemWithProject(pid);
  const sysAttempts = window.__fake.embed - b3;
  return { semantic: r1.semantic, note: r1.note || "", attempts, r2Semantic: r2.semantic, breakAttempts, sysHasRain: sys.indexOf("下雨的场景") >= 0, sysAttempts, sysLen: sys.length };
}, sem.projectId);

await gotoApp(page, BASE + "/");
const viaProvider = await page.evaluate(async (args) => {
  const s = await import("/src/db/repo/settings.ts");
  const mem = await import("/src/db/repo/memory.ts");
  const rc = await import("/src/ai/recall.ts");
  const base = s.loadSettings();
  s.saveSettings(Object.assign({}, base, {
    semanticRecall: { enabled: true, source: "provider", providerId: args.providerId, model: "fake-embed", endpoint: "", topK: 8 },
  }));
  const before = window.__fake.embed;
  const r = await rc.recallMemories({ projectId: args.pid, facts: await mem.memoryForProject(args.pid) });
  return { semantic: r.semantic, picked: r.pickedIds.indexOf(args.rainId) >= 0, calls: window.__fake.embed - before, note: r.note || "" };
}, { pid: sem.projectId, rainId: sem.rainId, providerId: setup.providerId });

console.log("  按规则排序：" + sem.fillerCount + " 条高可信 + 1 条低可信（雨景）→ 最后一条是「" + sem.ruleOrderLast + "」");
check("默认关闭：语义召回不产生任何额外请求", sem.callsOff === 0, "embed 调用 " + sem.callsOff + " 次");
check("默认关闭：注入块与改动前逐字一致（顺序也一致）", sem.ruleOrderOk === true, "");
check("默认关闭：相关的雨景记忆挤不进前 12 条（问题本身）", sem.offHasRain === false, "");
check("默认关闭：recallMemories 明确返回未使用语义召回", sem.explicitOffSemantic === false, String(sem.explicitOffSemantic));
check("开启后：雨景记忆被召回并注入", sem.onHasRain === true && sem.recalledPicked === true, JSON.stringify({ inPrompt: sem.onHasRain, picked: sem.recalledPicked }));
check("开启后：确实调用了向量端点", sem.callsOn > 0, "embed 调用 " + sem.callsOn + " 次");
check("开启后：召回结果里包含这条低可信记忆", sem.recalledPicked === true, String(sem.recalledPicked));
console.log("  召回顺序（相似度降序）：" + sem.pickedTexts.join(" / ") + "（共 " + sem.pickedCount + " 条）");
check("召回结果里排第一的是那条雨景记忆", Boolean(sem.pickedTexts[0]) && sem.pickedTexts[0].indexOf("下雨") >= 0, JSON.stringify(sem.pickedTexts.slice(0, 3)));
check("向量落库（embeddings 表被真正用起来：内容/模型/维度都对）", sem.embRows === sem.fillerCount + 1 && sem.rowsMatchText === true, "行数 " + sem.embRows);
check("缓存命中：再召回一次一个请求都不发", sem.cacheCalls === 0 && sem.againSemantic === true, JSON.stringify({ calls: sem.cacheCalls, semantic: sem.againSemantic }));
check("记忆内容改了才重算（只多发 1 次请求）", sem.recomputeCalls === 1 && sem.afterEditPicked === true, JSON.stringify({ calls: sem.recomputeCalls, picked: sem.afterEditPicked }));
check("置顶记忆永远注入且排第一", sem.pinnedFirst === true && sem.pinnedStillSemantic === true, JSON.stringify({ first: sem.pinnedFirst, semantic: sem.pinnedStillSemantic }));
check("向量服务不可达：真的尝试过且失败（降级测试不是空跑）", degraded.attempts > 0, "尝试 " + degraded.attempts + " 次");
check("向量服务不可达：静默降级回规则排序", degraded.semantic === false, JSON.stringify({ semantic: degraded.semantic, note: degraded.note }));
check("降级原因只留在设置页，不抛给写作路径", degraded.note.length > 0, degraded.note);
check("降级期间 system prompt 照常生成（雨景记忆没进来，但没报错）", degraded.sysLen > 0 && degraded.sysHasRain === false, JSON.stringify({ len: degraded.sysLen, rain: degraded.sysHasRain }));
check("失败后熔断：后续调用一次请求都不发", degraded.breakAttempts === 0 && degraded.sysAttempts === 0, JSON.stringify({ second: degraded.breakAttempts, sys: degraded.sysAttempts }));
check("熔断期间调用依然返回规则排序（不报错）", degraded.r2Semantic === false, String(degraded.r2Semantic));
check("OpenAI 兼容来源同样可用", viaProvider.semantic === true && viaProvider.picked === true && viaProvider.calls > 0, JSON.stringify(viaProvider));
check("合并顺序：置顶在前、召回命中次之、去重后受 limit 约束", sem.mergedFirstIsPinned === true && sem.mergedHasPicked === true && sem.mergedUnique === true && sem.mergedOrderLen === 4, JSON.stringify({ pinned: sem.mergedFirstIsPinned, picked: sem.mergedHasPicked, uniq: sem.mergedUnique, len: sem.mergedOrderLen }));

/* ================================================================== *
 * 四、效果追踪
 * ================================================================== */
section("四、效果追踪（注入 → 记录 → 差评率）");
const track = await page.evaluate(async () => {
  const p = await import("/src/db/repo/projects.ts");
  const ai = await import("/src/db/repo/ai.ts");
  const mem = await import("/src/db/repo/memory.ts");
  const { systemWithProject, runText } = await import("/src/ai/runner.ts");

  const proj = await p.createProject({ title: "效果追踪验证" });
  const m1 = await mem.addMemory({ scope: "global", kind: "preference", text: "对话不要用解释性台词", source: "user" });
  const m2 = await mem.addMemory({ scope: "global", kind: "preference", text: "不要写总结腔与 AI 腔", source: "user" });

  const seen = new Set((await ai.listGenerations(proj.id, 500)).map((g) => g.id));
  const genIds = [];
  const runs = [];
  for (let i = 0; i < 5; i++) {
    const system = await systemWithProject(proj.id);
    const res = await runText({ taskKind: "continue", projectId: proj.id, system, user: "写第 " + (i + 1) + " 段" });
    runs.push(res.ok ? "ok" : "fail:" + res.error);
    const fresh = (await ai.listGenerations(proj.id, 500)).find((g) => !seen.has(g.id));
    if (fresh) { seen.add(fresh.id); genIds.push(fresh.id); }
  }

  const afterRuns = (await mem.memoryEffectStats(proj.id)).get(m1.id);
  const usageRows = await mem.memoryUsageForGeneration(genIds[0]);
  const viaValues = Array.from(new Set(usageRows.map((r) => r.via)));

  await ai.logFeedback({ projectId: proj.id, taskKind: "continue", generationId: genIds[0], rating: 1 });
  await ai.logFeedback({ projectId: proj.id, taskKind: "continue", generationId: genIds[1], rating: -1, note: "解释太多" });
  const mid = (await mem.memoryEffectStats(proj.id)).get(m1.id);

  await ai.logFeedback({ projectId: proj.id, taskKind: "continue", generationId: genIds[2], rating: -1, note: "还是解释太多" });
  await ai.logFeedback({ projectId: proj.id, taskKind: "continue", generationId: genIds[3], rating: -1, note: "套话又来了" });
  await ai.logFeedback({ projectId: proj.id, taskKind: "continue", generationId: genIds[4], rating: 1 });
  const final = (await mem.memoryEffectStats(proj.id)).get(m1.id);
  const other = (await mem.memoryEffectStats(proj.id)).get(m2.id);

  // 好评对照：另造一条记忆与 5 条只用了它的生成记录，全部好评。
  // 之所以直接写 memoryUsage：track 项目里每次生成都会同时注入 m1/m2，
  // 想让一条记忆"只被好评过"，就没法用真实生成来构造。
  const m3 = await mem.addMemory({ scope: "project", projectId: proj.id, kind: "preference", text: "每章结尾留一个钩子", source: "user" });
  const goodGenIds = ["gen_good_a", "gen_good_b", "gen_good_c", "gen_good_d", "gen_good_e"];
  await mem.recordMemoryUsage(goodGenIds.map((generationId) => ({ projectId: proj.id, generationId: generationId, factId: m3.id, via: "rule" })));
  for (const generationId of goodGenIds) {
    await ai.logFeedback({ projectId: proj.id, taskKind: "continue", generationId: generationId, rating: 1 });
  }
  const goodOnly = (await mem.memoryEffectStats(proj.id)).get(m3.id);

  const conflictA = await mem.addMemory({ scope: "project", projectId: proj.id, kind: "preference", text: "文风要冷硬" });
  const conflictB = await mem.addMemory({ scope: "project", projectId: proj.id, kind: "preference", text: "文风要温暖细腻" });

  return {
    projectId: proj.id,
    runs,
    genCount: genIds.length,
    usageRowCount: usageRows.length,
    usageGenerationsMatch: usageRows.every((r) => r.generationId === genIds[0]),
    usageIds: usageRows.map((r) => r.factId).sort(),
    m1Id: m1.id,
    m2Id: m2.id,
    viaValues,
    afterRuns,
    mid,
    final,
    other,
    goodOnly,
    conflictPair: [conflictA.id, conflictB.id],
  };
});
check("5 次生成全部成功（离线假模型）", track.runs.every((r) => r === "ok"), JSON.stringify(track.runs));
check("每次生成都落了一条 memoryUsage，且 generationId 指向本次生成", track.usageRowCount > 0 && track.usageGenerationsMatch === true, JSON.stringify({ rows: track.usageRowCount, match: track.usageGenerationsMatch }));
check("memoryUsage 记录了被注入的 fact", track.usageIds.indexOf(track.m1Id) >= 0 && track.usageIds.indexOf(track.m2Id) >= 0, JSON.stringify(track.usageIds));
check("记录了选择来源 via（规则/语义）", track.viaValues.length === 1 && track.viaValues[0] === "rule", JSON.stringify(track.viaValues));
check("注入次数统计为 5", track.afterRuns && track.afterRuns.injections === 5, JSON.stringify(track.afterRuns));
check("没有评价时差评率为 0（不能算成「差」）", track.afterRuns && track.afterRuns.rated === 0 && track.afterRuns.badRate === 0, JSON.stringify(track.afterRuns));
check("差评后差评率从 0 上升到 50%", track.mid && track.mid.rated === 2 && track.mid.negative === 1 && Math.abs(track.mid.badRate - 0.5) < 1e-9, JSON.stringify(track.mid));
check("5 次评价 3 次差评 → 差评率 60%", track.final && track.final.rated === 5 && track.final.negative === 3 && Math.abs(track.final.badRate - 0.6) < 1e-9, JSON.stringify(track.final));
check("注入 ≥5 且差评率 ≥50% 触发「建议暂停」", track.final && track.final.suggestPause === true, JSON.stringify(track.final));
check("同样注入 5 次但全是好评的记忆不触发提示", track.goodOnly && track.goodOnly.injections === 5 && track.goodOnly.rated === 5 && track.goodOnly.badRate === 0 && track.goodOnly.suggestPause === false, JSON.stringify(track.goodOnly));
console.log("  统计明细：" + JSON.stringify(track.final));

/* ================================================================== *
 * 五、界面
 * ================================================================== */
section("五、界面");
await gotoApp(page, BASE + "/settings?tab=memory", { settle: 2500 });
// 等冲突条真正渲染出来，而不是靠固定等待（负载高时会偶发失败）
await waitFor(page, () => document.body.innerText.indexOf("处记忆冲突") >= 0);
const uiText = await page.evaluate(() => document.body.innerText);
const conflictCount = (uiText.match(/发现 (\d+) 处记忆冲突/) || [])[1];
check("界面显示冲突提示条", conflictCount === "1", "匹配到 " + conflictCount);
check("冲突条给出四种处置", uiText.indexOf("保留 A") >= 0 && uiText.indexOf("保留 B") >= 0 && uiText.indexOf("两条都保留并置顶") >= 0 && uiText.indexOf("合并成一条") >= 0, "");
check("冲突条说明了为什么（理由文案可见）", uiText.indexOf("同时注入会让模型摇摆") >= 0 || uiText.indexOf("这一维度上取向相反") >= 0, "");
check("记忆条目显示注入次数", /注入 5 次/.test(uiText), "");
check("记忆条目显示差评率", /差评率 60%（5 次评价）/.test(uiText), "");
check("高风险记忆给出「建议暂停」提示", uiText.indexOf("建议暂停") >= 0, "");
check("有语义召回开关与模型设置", uiText.indexOf("语义召回（可选）") >= 0 && uiText.indexOf("测试向量服务") >= 0, "");
check("语义召回说明了降级行为", uiText.indexOf("静默退回原来的规则排序") >= 0, "");
await page.screenshot({ path: "/tmp/nf-memory-plus.png" });

const keepA = page.locator('button:has-text("保留 A")').first();
const clicked = await keepA.count() > 0;
if (clicked) await keepA.click();
await waitFor(page, () => document.body.innerText.indexOf("处记忆冲突") < 0);
const afterText = await page.evaluate(() => document.body.innerText);
check("点「保留 A」后冲突条消失（真实点击，不是只看状态）", clicked && afterText.indexOf("处记忆冲突") < 0, clicked ? "" : "没找到按钮");
const persisted = await page.evaluate(async () => {
  const mem = await import("/src/db/repo/memory.ts");
  const list = await mem.listMemory({ includePaused: true });
  return list.filter((m) => m.paused).length;
});
check("裁决结果落库（有记忆被暂停）", persisted > 0, "暂停 " + persisted + " 条");

/* ================================================================== *
 * 六、数据库升级 v3 → v4（放在最后：这一步会把库删掉重建）
 * ================================================================== */
section("六、数据库升级（v3 → v4，老库不能坏）");
const upgrade = await page.evaluate(async () => {
  const schema = await import("/src/db/schema.ts");
  const stores = await import("/src/db/v1-stores.ts");
  const dbm = await import("/src/db/database.ts");
  const mem = await import("/src/db/repo/memory.ts");
  const db = dbm.db;

  // 用 Dexie 基类造一个"只声明到 v3"的老库：这正是老用户浏览器里那份数据
  const Dexie = Object.getPrototypeOf(Object.getPrototypeOf(db)).constructor;
  await db.delete();
  const old = new Dexie(schema.DB_NAME);
  old.version(1).stores(stores.V1_STORES);
  old.version(2).stores(stores.V2_STORES);
  old.version(3).stores(stores.V3_STORES);
  await old.open();
  const verBefore = old.verno;
  const hasUsageBefore = old.tables.some((t) => t.name === "memoryUsage");
  const now = new Date().toISOString();
  await old.table("projects").put({
    id: "prj_upgrade", title: "升级前就存在的作品", author: undefined, genres: [], tags: [], themes: [],
    pov: "third-limited", tense: "past", targetWords: 250000, targetChapterWords: 3000, lengthClass: "novel",
    status: "planning", forbidden: [], language: "zh-CN",
    stats: { words: 0, chapters: 0, scenes: 0, writingDays: 0 }, createdAt: now, updatedAt: now,
  });
  await old.table("memory").put({
    id: "mem_upgrade", scope: "global", kind: "preference", text: "升级前就存在的记忆：对话不要用解释性台词",
    source: "user", evidence: [], confidence: 1, pinned: false, paused: false, usedCount: 7,
    dedupeKey: "preference::升级前就存在的记忆", createdAt: now, updatedAt: now,
  });
  old.close();

  // 再用应用自己的 db（v4）打开：Dexie 会在这里按 v3 → v4 的差异升级。
  // 必须先 open()：db.delete() 之后 Dexie 会把实例标记成已关闭，
  // 不会自动重开（项目里的 wipeDatabase() 也是 delete() 后补 open()）。
  await db.open();
  const projects = await db.projects.toArray();
  const memories = await db.memory.toArray();
  const usageOk = await db.memoryUsage.count().then(() => true).catch(() => false);
  const list = await mem.listMemory({ includePaused: true });
  const effect = (await mem.memoryEffectStats(undefined)).get("mem_upgrade");
  return {
    verBefore,
    hasUsageBefore,
    verno: db.verno,
    storeNames: db.tables.map((t) => t.name),
    projectTitles: projects.map((p) => p.title),
    memoryTexts: memories.map((m) => m.text),
    usedCount: memories[0] ? memories[0].usedCount : null,
    usageOk,
    listCount: list.length,
    legacyInjections: effect ? effect.injections : null,
  };
});
check("造的确实是 v3 老库（没有 memoryUsage 表）", upgrade.verBefore === 3 && upgrade.hasUsageBefore === false, JSON.stringify({ ver: upgrade.verBefore, hasUsage: upgrade.hasUsageBefore }));
check("打开后自动升到 v4", upgrade.verno === 4, "verno=" + upgrade.verno);
check("v4 多了 memoryUsage 表且可查询", upgrade.usageOk === true && upgrade.storeNames.indexOf("memoryUsage") >= 0, JSON.stringify(upgrade.storeNames));
check("升级不丢数据：作品还在", upgrade.projectTitles.indexOf("升级前就存在的作品") >= 0, JSON.stringify(upgrade.projectTitles));
check("升级不丢数据：记忆与它的计数器都还在", upgrade.memoryTexts.length === 1 && upgrade.usedCount === 7, JSON.stringify({ texts: upgrade.memoryTexts, usedCount: upgrade.usedCount }));
check("老记忆没有 usage 行时用 usedCount 兜底（不会显示成 0 次）", upgrade.legacyInjections === 7, String(upgrade.legacyInjections));

console.log("");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
console.log("控制台错误: " + (errs.length ? JSON.stringify(errs.slice(0, 5)) : "NONE"));
// 注意：这里统计的是"最后一次刷新页面之后"的次数，前面几节的计数在刷新时已归零
console.log("假服务调用次数（最后一次刷新后）: " + JSON.stringify(await page.evaluate(() => ({ chat: window.__fake.chat, embed: window.__fake.embed }))));
await context.close();
process.exit(fail === 0 ? 0 : 1);
