import type { Character, ID, StoryBlueprint } from "@/core";
import { db } from "@/db/database";
import type { GeneratedStory } from "@/ai/blueprint";
import { createCharacter, listCharacters, updateCharacter } from "@/db/repo/cast";
import { createArc, createChapter, listArcs, listChapters, updateArc, updateChapter } from "@/db/repo/outline";
import { upsertRule, upsertWorldEntry, upsertGlossary } from "@/db/repo/world";
import { updateProject } from "@/db/repo/projects";
import { normalizeCategory } from "@/ai/cast-gen";

/**
 * 把按蓝图生成的故事写进项目。
 *
 * 幂等口径与「一句话成书」完全一致（那边踩过重复入库的坑）：
 * 按名称匹配，命中就更新，重复应用不会产生重复数据。
 * 名称统一加前缀是**刻意的**：让作者一眼看出哪些是这次生成的，
 * 与既有的人物/条目区分开，误删时也好辨认。
 */
export interface ApplyBlueprintResult {
  characters: number;
  mergedCharacters: number;
  worldEntries: number;
  rules: number;
  arcs: number;
  mergedArcs: number;
  chapters: number;
  mergedChapters: number;
  title?: string;
}

export async function applyGeneratedStory(
  projectId: ID,
  story: GeneratedStory,
  opts: { prefix?: string; renameProject?: boolean; blueprint?: StoryBlueprint } = {},
): Promise<ApplyBlueprintResult> {
  const prefix = opts.prefix ?? "";
  const result: ApplyBlueprintResult = {
    characters: 0, mergedCharacters: 0, worldEntries: 0, rules: 0,
    arcs: 0, mergedArcs: 0, chapters: 0, mergedChapters: 0,
  };

  if (opts.renameProject && story.title) {
    await updateProject(projectId, {
      title: story.title,
      logline: story.logline || undefined,
      synopsis: story.premise || undefined,
    });
    result.title = story.title;
  }

  // 拆书得到的技法写进 styleGuide，之后所有生成都会带上它 —— 这才是"仿"的落点
  if (opts.blueprint) {
    const t = opts.blueprint.technique;
    await updateProject(projectId, {
      styleGuide: [
        t.pov ? "视角：" + t.pov : "",
        t.proseStyle ? "语言：" + t.proseStyle : "",
        t.paragraphing ? "段落与场景：" + t.paragraphing : "",
        t.informationRelease ? "信息释放：" + t.informationRelease : "",
        t.hooks ? "钩子：" + t.hooks : "",
        t.dialogueRatio ? "对话配比：" + t.dialogueRatio : "",
        t.signatureMove ? "关键一招：" + t.signatureMove : "",
      ].filter(Boolean).join("\n"),
    });
  }

  // ---- 人物
  const existingChars = await listCharacters(projectId);
  const charByName = new Map<string, Character>();
  for (const c of existingChars) charByName.set(c.name, c);
  for (const row of story.characters) {
    const name = prefix + row.name;
    const patch = {
      name,
      role: (row.role as Character["role"]) ?? "minor",
      tagline: row.tagline,
      want: row.want,
      flaw: row.flaw,
      tags: ["拆书仿写"],
    };
    const hit = charByName.get(name);
    if (hit) {
      await updateCharacter(hit.id, patch);
      result.mergedCharacters += 1;
    } else {
      const made = await createCharacter(projectId, patch);
      charByName.set(made.name, made);
      result.characters += 1;
    }
    await upsertGlossary(projectId, name, []);
  }

  // ---- 世界观与规则（这两个仓储本身就是按名称 upsert 的）
  for (const row of story.world) {
    await upsertWorldEntry(projectId, {
      title: prefix + row.title,
      category: normalizeCategory(row.category),
      body: row.body,
      importance: row.importance,
      tags: ["拆书仿写"],
    });
    result.worldEntries += 1;
  }

  const ruleByName = new Map((await db.rules.where("projectId").equals(projectId).toArray()).map((r) => [r.name, r]));
  for (const row of story.rules) {
    const name = prefix + row.title;
    const hit = ruleByName.get(name);
    const patch = {
      name,
      description: row.statement,
      kind: "custom-llm" as const,
      value: row.statement,
      severity: (/error|硬/.test(row.severity) ? "error" : "warn") as "error" | "warn",
      enabled: true,
    };
    if (hit) await upsertRule(projectId, { ...patch, id: hit.id });
    else {
      const made = await upsertRule(projectId, patch);
      ruleByName.set(made.name, made);
    }
    result.rules += 1;
  }

  // ---- 分卷
  const arcByTitle = new Map((await listArcs(projectId)).map((a) => [a.title, a]));
  const arcIdMap = new Map<string, ID>();
  for (const row of story.arcs) {
    const title = prefix + row.title;
    const patch = { kind: "volume" as const, summary: row.summary, goal: row.goal, conflict: row.conflict, outcome: row.outcome };
    const hit = arcByTitle.get(title);
    if (hit) {
      await updateArc(hit.id, patch);
      arcIdMap.set(row.title, hit.id);
      result.mergedArcs += 1;
    } else {
      const made = await createArc(projectId, title, patch);
      arcByTitle.set(made.title, made);
      arcIdMap.set(row.title, made.id);
      result.arcs += 1;
    }
  }

  // ---- 章节（按标题匹配，只更新大纲层面，不动正文与状态）
  const chapterByTitle = new Map((await listChapters(projectId)).map((c) => [c.title, c]));
  for (const row of story.chapters) {
    const title = prefix + row.title;
    const hit = chapterByTitle.get(title);
    if (hit) {
      await updateChapter(hit.id, { summary: row.summary, tension: row.tension, hook: row.hook });
      result.mergedChapters += 1;
    } else {
      const made = await createChapter(projectId, { title, summary: row.summary });
      await updateChapter(made.id, { tension: row.tension, hook: row.hook, status: "outlined" });
      chapterByTitle.set(made.title, made);
      result.chapters += 1;
    }
  }

  return result;
}
