import { launchIsolated } from "./lib/browser.mjs";
const BASE = "http://127.0.0.1:5178";
const context = await launchIsolated(import.meta.url);
const page = context.pages()[0] ?? (await context.newPage());
page.on("pageerror", (e) => console.log("PAGEERROR", String(e.message).slice(0, 200)));
await page.addInitScript(() => {
  const state = { embed: 0, failEmbed: false, dim: 8192, seen: [] };
  window.__fake = state;
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
  const json = (b, s) => new Response(JSON.stringify(b), { status: s || 200, headers: { "Content-Type": "application/json" } });
  const real = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    if (url.indexOf("/embeddings") >= 0 || url.indexOf("/api/embed") >= 0) {
      state.embed += 1;
      state.seen.push(url.slice(-30));
      if (state.failEmbed) throw new TypeError("Failed to fetch");
      const body = init && init.body ? JSON.parse(String(init.body)) : {};
      const raw = body.prompt !== undefined ? body.prompt : body.input;
      const texts = Array.isArray(raw) ? raw : [raw];
      if (url.indexOf("/api/") >= 0) return json({ embedding: vec(texts[0]) });
      return json({ data: texts.map((t, i) => ({ index: i, embedding: vec(t) })) });
    }
    return real(input, init);
  };
});
await page.goto(BASE + "/", { waitUntil: "networkidle" });
const out = await page.evaluate(async () => {
  const p = await import("/src/db/repo/projects.ts");
  const o = await import("/src/db/repo/outline.ts");
  const mem = await import("/src/db/repo/memory.ts");
  const s = await import("/src/db/repo/settings.ts");
  const emb = await import("/src/ai/embedding.ts");
  const rc = await import("/src/ai/recall.ts");
  const proj = await p.createProject({ title: "debug2" });
  const ch = await o.createChapter(proj.id, { title: "雨夜", summary: "主角在雨里等一个人" });
  await o.saveChapterContent(ch.id, "<p>" + "雨点砸在铁皮棚上，雨声密得像有人在数钱。潮气从领口钻进来，体感冷得发抖。".repeat(3) + "</p>");
  const rain = await mem.addMemory({ scope: "project", projectId: proj.id, kind: "preference", source: "feedback", text: "下雨的场景要多写雨声、潮气与体感", evidence: [{ kind: "feedback", quote: "x", at: new Date().toISOString() }] });
  for (let i = 0; i < 12; i++) await mem.addMemory({ scope: "project", projectId: proj.id, kind: "preference", source: "user", text: "第 " + i + " 条通用规则：注意段落节奏与标点规范" });
  const base = s.loadSettings();
  const cfg = { enabled: true, source: "ollama", model: "nomic-embed-text", endpoint: "http://127.0.0.1:11434/api/embeddings", topK: 8 };
  s.saveSettings(Object.assign({}, base, { semanticRecall: cfg }));
  const c = emb.embeddingSettings();
  const facts = await mem.memoryForProject(proj.id);
  const r1 = await rc.recallMemories({ projectId: proj.id, facts });
  const q = await mem.buildRecallQuery(proj.id);
  const qv = await emb.embedOne(q, c);
  const mv = await emb.memoryVectors(proj.id, facts, c);
  const ranked = facts.map((f) => ({ t: f.text.slice(0, 10), score: mv.vectors.has(f.id) && qv ? Number(emb.cosine(qv, mv.vectors.get(f.id)).toFixed(5)) : null })).sort((a, b) => (b.score || 0) - (a.score || 0));
  // 失败路径
  window.__fake.failEmbed = true;
  emb.resetEmbeddingBreaker();
  const before = window.__fake.embed;
  const r2 = await rc.recallMemories({ projectId: proj.id, facts });
  const after = window.__fake.embed;
  return {
    r1Semantic: r1.semantic, r1Picked: r1.pickedIds.length, r1HasRain: r1.pickedIds.indexOf(rain.id) >= 0, r1Note: r1.note,
    qvLen: qv ? qv.length : null, rankTop: ranked.slice(0, 5), rainRank: ranked.findIndex((x) => x.t.indexOf("下雨") >= 0),
    failDelta: after - before, r2Semantic: r2.semantic, r2Picked: r2.pickedIds.length, r2Note: r2.note,
    lastErr: emb.lastEmbeddingError(), breakerOpen: emb.embeddingBreakerOpen(),
    fakeSeen: window.__fake.seen.slice(-3),
  };
});
console.log(JSON.stringify(out, null, 1));
await context.close();
