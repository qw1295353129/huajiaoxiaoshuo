import type { BlueprintRecord, ID, StoryBlueprint } from "@/core";
import { db } from "../database";
import { newId } from "@/utils/id";
import { countWords } from "@/utils/text";

/**
 * 拆书蓝图的存取。
 *
 * 原始参考文本与蓝图存在一起：原创性自检需要拿原文比对，
 * 分两张表反而要多一次关联查询，且容易在删除时漏掉一边。
 */
export async function listBlueprints(projectId: ID): Promise<BlueprintRecord[]> {
  const rows = await db.blueprints.where("projectId").equals(projectId).toArray();
  return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function getBlueprint(id: ID): Promise<BlueprintRecord | undefined> {
  return db.blueprints.get(id);
}

export async function saveBlueprint(input: {
  projectId: ID;
  sourceTitle: string;
  sourceText: string;
  blueprint: StoryBlueprint;
}): Promise<BlueprintRecord> {
  const now = new Date().toISOString();
  const row: BlueprintRecord = {
    id: newId("bp"),
    projectId: input.projectId,
    sourceTitle: input.sourceTitle.trim() || "未命名参考书",
    sourceText: input.sourceText,
    wordCount: countWords(input.sourceText),
    blueprint: input.blueprint,
    createdAt: now,
    updatedAt: now,
  };
  await db.blueprints.put(row);
  return row;
}

export async function updateBlueprint(id: ID, patch: Partial<BlueprintRecord>): Promise<void> {
  await db.blueprints.where("id").equals(id).modify((r) => {
    Object.assign(r, patch, { updatedAt: new Date().toISOString() });
  });
}

export async function deleteBlueprint(id: ID): Promise<void> {
  await db.blueprints.delete(id);
}

/** 一个项目最多留几份拆解，避免参考书全文把库撑大 */
export const MAX_BLUEPRINTS = 8;

export async function pruneBlueprints(projectId: ID, keep = MAX_BLUEPRINTS): Promise<number> {
  const rows = await listBlueprints(projectId);
  const extra = rows.slice(keep);
  for (const r of extra) await db.blueprints.delete(r.id);
  return extra.length;
}
