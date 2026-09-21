/**
 * 数据库升级回归：老库能不能安全升到新版本。
 *
 * 这是最危险的一处：升级路径写错不会报错、类型也对、新库测试全过，
 * 但老用户的数据库会丢数据。所以必须造一个**真的老库**来测。
 *
 * 两个曾经踩过的坑（第一版测试因此给出了假结论）：
 *  1. 必须用**原生 IndexedDB** 按历史版本号建库。用 Dexie 的 version(n).stores(...)
 *     声明建出来的库，实际版本是"声明里的最高版本"——我第一版以为建了 v3，其实建的是 v4，
 *     升级路径根本没被执行，测了个寂寞。
 *  2. Dexie 的 db.verno 返回的是**声明版本**，不是底层 IndexedDB 的真实版本。
 *     要用原生读 idb.version 才能确认老库真的是 v3。
 *
 * 表结构从 src/db/v1-stores.ts 的真实历史快照生成，不手抄 —— 手抄会抄错，
 * 而且快照一变就过期。
 */
import { gotoApp, launchIsolated } from "./lib/browser.mjs";

const BASE = "http://127.0.0.1:5178";
const context = await launchIsolated(import.meta.url, { viewport: { width: 1300, height: 900 } });
const page = context.pages()[0] ?? (await context.newPage());
const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 200)));

let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (x ? "  → " + x : "")); } };

await gotoApp(page, BASE + "/");
const meta = await page.evaluate(async () => {
  const stores = await import("/src/db/v1-stores.ts");
  const schema = await import("/src/db/schema.ts");
  const { db } = await import("/src/db/database.ts");
  return { dbName: db.name, currentVersion: schema.DB_VERSION };
});
console.log("库名 " + meta.dbName + "，目标版本 v" + meta.currentVersion);

// 关键：应用以 v4 持有这个库，所以必须
//   ① 关掉 Dexie 连接  ② 刷新页面让所有残留连接消失  ③ 才能删库并建成 v3。
// 少了第 ② 步，deleteDatabase 会被阻塞，随后 open(name, 3) 就成了"版本降级"，
// IndexedDB 直接中止事务（我在这里卡了两轮）。
await page.evaluate(async () => {
  const { db } = await import("/src/db/database.ts");
  db.close();
});
await gotoApp(page, BASE + "/", { settle: 300 });
await page.evaluate(async (dbName) => {
  await new Promise((res) => { const q = indexedDB.deleteDatabase(dbName); q.onsuccess = q.onerror = q.onblocked = () => res(); });
}, meta.dbName);

/**
 * 生成 v3 老库：原生 IndexedDB，版本号写 3。
 *
 * 注意：**不要在 evaluate 的参数里传整个表结构**。37 张表的定义过 Playwright 的
 * 序列化边界会出问题，表现为 onupgradeneeded 里事务被中止（我在这里卡了两轮）。
 * 让浏览器侧自己 import 快照即可。
 */
const built = await page.evaluate(async (dbName) => {
  const stores = await import("/src/db/v1-stores.ts");
  const v3stores = stores.V3_STORES;
  const delResult = await new Promise((res) => {
    const q = indexedDB.deleteDatabase(dbName);
    q.onsuccess = () => res("ok");
    q.onerror = () => res("error:" + q.error?.name);
    q.onblocked = () => res("blocked");
    setTimeout(() => res("timeout"), 3000);
  });
  if (delResult !== "ok") throw new Error("删库失败：" + delResult + "（说明还有连接占着这个库）");

  const parseSpec = (spec) => {
    const parts = spec.split(",").map((s) => s.trim()).filter(Boolean);
    const indexes = parts.slice(1).map((p) => {
      const m = p.match(/^[(.+)]$/);
      return m ? { name: p, keyPath: m[1].split("+") } : { name: p, keyPath: p };
    });
    return { keyPath: parts[0], indexes };
  };

  const idb = await new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 3); // ← 真的 v3
    let upgradeError = null;
    req.onupgradeneeded = () => {
      try {
        for (const [name, spec] of Object.entries(v3stores)) {
          const def = parseSpec(spec);
          const st = req.result.createObjectStore(name, { keyPath: def.keyPath });
          for (const ix of def.indexes) st.createIndex(ix.name, ix.keyPath);
        }
      } catch (e) {
        upgradeError = (e && e.name ? e.name + ": " + e.message : String(e)) + " @ " + (e && e.stack ? e.stack.split("\n")[1]?.trim() : "");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new Error("open 失败: " + req.error?.name));
    req.onabort = () => reject(new Error("事务中止 — 建表异常: " + (upgradeError ?? "（未捕获到异常，可能是别的原因）")));
  });

  const now = new Date().toISOString();
  const rows = {
    projects: [{ id: "p1", title: "老库里的书", status: "drafting", genres: [], targetWords: 100000, createdAt: now, updatedAt: now }],
    chapters: [{ id: "c1", projectId: "p1", title: "第一章", order: 0, status: "drafted", wordCount: 42, createdAt: now, updatedAt: now }],
    memory: [
      { id: "m1", scope: "project", projectId: "p1", kind: "preference", text: "老库里的偏好", source: "user", evidence: [], confidence: 1, pinned: true, paused: false, usedCount: 7, dedupeKey: "preference::老库里的偏好", createdAt: now, updatedAt: now },
      { id: "m2", scope: "global", kind: "lesson", text: "老库里的教训", source: "feedback", evidence: [], confidence: 0.45, pinned: false, paused: false, usedCount: 3, dedupeKey: "lesson::老库里的教训", createdAt: now, updatedAt: now },
    ],
    comments: [{ id: "cm1", projectId: "p1", chapterId: "c1", body: "老批注", author: "我", resolved: false, createdAt: now, updatedAt: now }],
    characters: [{ id: "cr1", projectId: "p1", name: "沈砚", role: "protagonist", aliases: [], traits: [], createdAt: now, updatedAt: now }],
  };
  const written = {};
  for (const [store, list] of Object.entries(rows)) {
    written[store] = await new Promise((resolve, reject) => {
      const tx = idb.transaction(store, "readwrite");
      for (const r of list) tx.objectStore(store).put(r);
      tx.oncomplete = () => resolve(list.length);
      tx.onerror = () => reject(tx.error);
    });
  }
  const realVersion = idb.version;
  const storeNames = [...idb.objectStoreNames];
  idb.close();
  return { written, realVersion, storeCount: storeNames.length, hasUsageBefore: storeNames.includes("memoryUsage") };
}, meta.dbName);

console.log("【造真的 v3 老库】");
console.log("  原生版本号 " + built.realVersion + "，表 " + built.storeCount + " 张，写入 " + JSON.stringify(built.written));
check("老库确实是 v3（原生版本号）", built.realVersion === 3, String(built.realVersion));
check("老库没有 memoryUsage 表", built.hasUsageBefore === false);
check("老数据写入成功", built.written.memory === 2 && built.written.comments === 1, JSON.stringify(built.written));

console.log("【让应用打开并升级】");
await gotoApp(page, BASE + "/", { settle: 2500 });

const after = await page.evaluate(async (expect) => {
  const { db } = await import("/src/db/database.ts");
  await db.open();
  const mem = await db.memory.toArray();
  const chapter = await db.chapters.get("c1");
  const comment = await db.comments.get("cm1");
  const project = await db.projects.get("p1");
  let usageWritable = false;
  try {
    await db.memoryUsage.put({ id: "probe", projectId: "p1", generationId: "g1", factId: "m1", createdAt: new Date().toISOString() });
    usageWritable = true;
  } catch { usageWritable = false; }
  const rawVersion = await new Promise((resolve) => {
    const q = indexedDB.open(db.name);
    q.onsuccess = () => { const v = q.result.version; q.result.close(); resolve(v); };
    q.onerror = () => resolve(-1);
  });
  return {
    declaredVerno: db.verno,
    rawVersion,
    expectVersion: expect,
    hasUsage: db.tables.some((t) => t.name === "memoryUsage"),
    usageWritable,
    memoryCount: mem.length,
    memoryTexts: mem.map((m) => m.text).sort(),
    usedCount: mem.find((m) => m.id === "m1")?.usedCount,
    pinned: mem.find((m) => m.id === "m1")?.pinned,
    projectTitle: project?.title,
    chapterTitle: chapter?.title,
    commentBody: comment?.body,
  };
}, meta.currentVersion);

console.log("  升级后：原生版本 " + after.rawVersion + "，Dexie 声明 " + after.declaredVerno);

check("底层库真的升到了 v4", after.rawVersion === 4, String(after.rawVersion));
check("新增 memoryUsage 表", after.hasUsage === true);
check("新表可读可写", after.usageWritable === true);

console.log("【老数据必须一条不少】");
check("老作品还在", after.projectTitle === "老库里的书", String(after.projectTitle));
check("老章节还在", after.chapterTitle === "第一章", String(after.chapterTitle));
check("老批注还在（v2 加的表）", after.commentBody === "老批注", String(after.commentBody));
check("两条老记忆都在（v3 加的表）", after.memoryCount === 2, JSON.stringify(after.memoryTexts));
check("记忆内容没变", JSON.stringify(after.memoryTexts) === JSON.stringify(["老库里的偏好", "老库里的教训"].sort()), JSON.stringify(after.memoryTexts));
check("usedCount 保留（=7）", after.usedCount === 7, String(after.usedCount));
check("pinned 保留", after.pinned === true, String(after.pinned));

console.log("【升级后功能正常】");
const usable = await page.evaluate(async () => {
  const mem = await import("/src/db/repo/memory.ts");
  const before = await mem.listMemory({ projectId: "p1", includePaused: true });
  await mem.addMemory({ scope: "project", projectId: "p1", kind: "convention", text: "升级后新增", source: "user" });
  const afterAdd = await mem.listMemory({ projectId: "p1", includePaused: true });
  return { before: before.length, after: afterAdd.length, stats: await mem.memoryStats("p1") };
});
check("能读到老记忆", usable.before >= 2, JSON.stringify(usable));
check("能往老库加新记忆", usable.after === usable.before + 1, JSON.stringify(usable));
check("统计功能正常", (usable.stats?.total ?? 0) > 0, JSON.stringify(usable.stats));

console.log("");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
console.log("控制台错误: " + (errs.length ? JSON.stringify(errs.slice(0, 4)) : "（有，见下）"));
if (errs.length) for (const e of errs.slice(0, 3)) console.log("    " + e);
await context.close();
process.exit(fail === 0 ? 0 : 1);
