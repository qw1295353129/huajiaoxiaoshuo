/**
 * 回归：一句话成书的「再次应用」必须幂等。
 *
 * 背景（用户报告的真实 bug）：点一次「再次应用」，人物就重复入库一遍 ——
 * 因为 applyGenesis 里人物用 createCharacter（永远插入），
 * 而世界观和规则用的是 upsertWorldEntry / upsertRule（幂等）。
 * 同一套流程里一半幂等一半不幂等，最不容易被发现。
 *
 * 测试策略：**直接构造一个已知内容的 GenesisRun**，调两次 applyGenesis，比对数据库。
 * 不依赖模型输出 —— 那条路径每次生成的人物名都可能不同，测不出"重复应用"这个语义。
 */
import { gotoApp, launchIsolated } from "./lib/browser.mjs";

const BASE = "http://127.0.0.1:5178";
const context = await launchIsolated(import.meta.url, { viewport: { width: 1512, height: 1000 } });
const page = context.pages()[0] ?? (await context.newPage());
const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 200)));

let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (x ? "  → " + x : "")); } };

await gotoApp(page, BASE + "/");

const out = await page.evaluate(async () => {
  const projects = await import("/src/db/repo/projects.ts");
  const cast = await import("/src/db/repo/cast.ts");
  const outline = await import("/src/db/repo/outline.ts");
  const genesis = await import("/src/ai/genesis.ts");
  const { db } = await import("/src/db/database.ts");

  const proj = await projects.createProject({ title: "幂等验证" });
  const now = new Date().toISOString();

  // 构造一个内容确定的 run：3 人物（其中「沈砚」有别名）、2 分卷、3 章节
  const run = {
    id: "gen_test",
    projectId: proj.id,
    seed: "一个能听见死者遗言的验尸官",
    constraints: {},
    status: "done",
    stages: [
      {
        kind: "premise",
        status: "done",
        data: {
          title: "遗言",
          subtitle: "验尸官的第一具无名尸",
          logline: "他能听见死者的最后一句话，而下一句里出现了他自己的名字。",
          premise: "雾港的验尸官沈砚能在触骨时听见死者的遗言。",
          themes: ["真相的代价"],
          tone: "冷硬、克制",
          characters: [
            { name: "沈砚", aliases: ["沈验尸"], role: "protagonist", tagline: "能听见遗言的验尸官", want: "查清自己的死期", flaw: "不肯信任任何人" },
            { name: "温晚", role: "deuteragonist", tagline: "永安堂的女药师", want: "保住家业" },
            { name: "陆断", role: "antagonist", tagline: "海禁令的执行官", want: "封住所有遗言" },
          ],
          world: [
            { title: "雾港", category: "geography", body: "北方的港口城市，常年有雾。", importance: 5 },
            { title: "触骨", category: "magic", body: "验尸官触骨可闻遗言，不得佩戴金属。", importance: 4 },
          ],
          rules: [
            { title: "遗言只能被听见一次", statement: "同一个死者的遗言只会被听见一次。", severity: "error" },
            { title: "触骨不得佩戴金属", statement: "触骨时佩戴金属会污染遗言。", severity: "error" },
          ],
          openingScene: "雨下了整夜。沈砚掀开白布的时候，死者张了张嘴。",
        },
      },
      {
        kind: "structure",
        status: "done",
        data: [
          { id: "a1", title: "第一卷 无名尸", summary: "第一具无名尸", goal: "引出遗言能力", conflict: "海禁", outcome: "确认死者身份", color: "#7c3aed" },
          { id: "a2", title: "第二卷 自己的名字", summary: "遗言里出现自己的名字", goal: "查清死期", conflict: "陆断阻挠", outcome: "揭开真相", color: "#0ea5e9" },
        ],
      },
      {
        kind: "outline",
        status: "done",
        data: [
          { title: "第一章 雨夜", arcId: "a1", summary: "第一具无名尸", goals: ["建立遗言设定"], tension: 4, hook: "死者说了他的名字" },
          { title: "第二章 海禁", arcId: "a1", summary: "陆断登场", goals: ["引出反派"], tension: 3, hook: "牌照被吊销" },
          { title: "第三章 永安堂", arcId: "a2", summary: "求助温晚", goals: ["建立同盟"], tension: 3, hook: "温晚认出了死者" },
        ],
      },
    ],
    createdAt: now,
    updatedAt: now,
  };

  const countAll = async () => ({
    characters: (await cast.listCharacters(proj.id)).length,
    arcs: (await outline.listArcs(proj.id)).length,
    chapters: (await outline.listChapters(proj.id)).length,
    world: (await db.worldEntries.where("projectId").equals(proj.id).toArray()).length,
    rules: (await db.rules.where("projectId").equals(proj.id).toArray()).length,
  });

  // ---- 第一次应用
  const r1 = await genesis.applyGenesis(proj.id, run);
  const after1 = await countAll();

  // ---- 第二次应用（同一个 run）—— 这就是用户点的「再次应用」
  const r2 = await genesis.applyGenesis(proj.id, run);
  const after2 = await countAll();

  // ---- 第三次，确认不是偶然
  const r3 = await genesis.applyGenesis(proj.id, run);
  const after3 = await countAll();

  // 人物详情：别名匹配也要命中，且不能把作者手写字段覆盖没
  const chars = await cast.listCharacters(proj.id);

  // 模拟"作者已经动笔写了第一章"，再应用一次，正文不能被清掉
  const chs = await outline.listChapters(proj.id);
  const first = chs.sort((a, b) => a.order - b.order)[0];
  await outline.saveChapterContent(first.id, "<p>雨下了整夜。这是作者亲手写的开头。</p>", { touchStatus: true });
  const beforeWords = (await outline.getChapterContent(first.id))?.text ?? "";
  await genesis.applyGenesis(proj.id, run);
  const afterContent = (await outline.getChapterContent(first.id))?.text ?? "";
  const afterFirst = (await outline.listChapters(proj.id)).find((c) => c.id === first.id);

  return {
    projectId: proj.id,
    r1: { created: r1.characters, merged: r1.mergedCharacters, arcs: r1.arcs, mergedArcs: r1.mergedArcs, chapters: r1.chapters, mergedChapters: r1.mergedChapters },
    r2: { created: r2.characters, merged: r2.mergedCharacters, arcs: r2.arcs, mergedArcs: r2.mergedArcs, chapters: r2.chapters, mergedChapters: r2.mergedChapters },
    r3: { created: r3.characters, merged: r3.mergedCharacters },
    after1, after2, after3,
    names: chars.map((c) => c.name).sort(),
    aliases: chars.map((c) => c.name + ":" + c.aliases.join("/")).sort(),
    firstTitle: first.title,
    beforeWords,
    afterContent,
    afterFirstStatus: afterFirst?.status,
    afterFirstWords: afterFirst?.wordCount,
  };
});

console.log("【第一次应用】");
console.log("  新建 " + JSON.stringify(out.r1));
console.log("  库内 " + JSON.stringify(out.after1));
check("第一次应用确实新建了人物", out.r1.created === 3, JSON.stringify(out.r1));
check("第一次应用确实新建了分卷与章节", out.r1.arcs === 2 && out.r1.chapters === 3, JSON.stringify(out.r1));

console.log("【第二次应用（用户点的「再次应用」）】");
console.log("  新建 " + JSON.stringify(out.r2));
console.log("  库内 " + JSON.stringify(out.after2));
check("第二次不再新建人物", out.r2.created === 0, JSON.stringify(out.r2));
check("第二次改为更新人物", out.r2.merged === 3, JSON.stringify(out.r2));
check("第二次不再新建分卷", out.r2.arcs === 0 && out.r2.mergedArcs === 2, JSON.stringify(out.r2));
check("第二次不再新建章节", out.r2.chapters === 0 && out.r2.mergedChapters === 3, JSON.stringify(out.r2));

console.log("【数据库规模必须不变】");
check("人物数没有翻倍", out.after2.characters === out.after1.characters, JSON.stringify({ a: out.after1, b: out.after2 }));
check("分卷数没有翻倍", out.after2.arcs === out.after1.arcs, JSON.stringify({ a: out.after1, b: out.after2 }));
check("章节数没有翻倍", out.after2.chapters === out.after1.chapters, JSON.stringify({ a: out.after1, b: out.after2 }));
check("世界观没有翻倍", out.after2.world === out.after1.world, JSON.stringify({ a: out.after1, b: out.after2 }));
// 硬规则原本也在翻倍：upsertRule 是"按 id upsert"，不传 id 时永远新建，
// 名字里的 upsert 很容易误导（我第一版就以为它按 name 去重）
check("硬规则没有翻倍", out.after2.rules === out.after1.rules, JSON.stringify({ a: out.after1, b: out.after2 }));
check("人物仍然是 3 个（不是 6 个）", out.after2.characters === 3, String(out.after2.characters));

console.log("【第三次应用】");
check("第三次仍然不新增", out.r3.created === 0 && out.r3.merged === 3, JSON.stringify(out.r3));
check("库内规模依旧不变", out.after3.characters === 3 && out.after3.arcs === 2 && out.after3.chapters === 3, JSON.stringify(out.after3));

console.log("【名称与别名】");
check("人物名没有被加后缀（说明是更新而非新建）", JSON.stringify(out.names) === JSON.stringify(["沈砚", "温晚", "陆断"].sort()), JSON.stringify(out.names));
check("别名被保留且可用于匹配", out.aliases.some((a) => a.includes("沈验尸")), JSON.stringify(out.aliases));

console.log("【不能破坏作者已写的内容】");
check("再次应用后正文还在", out.afterContent.includes("作者亲手写的开头"), out.afterContent.slice(0, 60));
check("正文没有被覆盖成开篇", out.afterContent === out.beforeWords, "");
check("已动笔的章节状态没有退回 outlined", out.afterFirstStatus !== "idea", String(out.afterFirstStatus));
check("字数记录还在", (out.afterFirstWords ?? 0) > 0, String(out.afterFirstWords));

console.log("");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
console.log("控制台错误: " + (errs.length ? JSON.stringify(errs.slice(0, 4)) : "NONE"));
await context.close();
process.exit(fail === 0 ? 0 : 1);
