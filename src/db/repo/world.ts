import type { ContinuityRule, Entity, EntityKind, EntityMention, Faction, GlossaryTerm, ID, WorldCategory, WorldEntry } from '@/core';
import { db } from '../database';
import { newId } from '@/utils/id';
import { normalizeForCompare } from '@/utils/text';

// ---------------- 世界观条目 ----------------

export async function listWorldEntries(projectId: ID): Promise<WorldEntry[]> {
  const list = await db.worldEntries.where('projectId').equals(projectId).toArray();
  return list.sort((a, b) => b.importance - a.importance || a.title.localeCompare(b.title, 'zh'));
}

export async function getWorldEntry(id: ID): Promise<WorldEntry | undefined> {
  return db.worldEntries.get(id);
}

export async function upsertWorldEntry(projectId: ID, patch: Partial<WorldEntry> & { title: string; category: WorldCategory }): Promise<WorldEntry> {
  const existing = (await db.worldEntries.where("projectId").equals(projectId).toArray()).find(
    (e) => e.title === patch.title.trim(),
  );
  if (existing) {
    await updateWorldEntry(existing.id, patch);
    return { ...existing, ...patch };
  }
  return createWorldEntry(projectId, patch);
}

export async function createWorldEntry(
  projectId: ID,
  patch: Partial<WorldEntry> & { title: string; category: WorldCategory },
): Promise<WorldEntry> {
  const now = new Date().toISOString();
  const entry: WorldEntry = {
    id: newId('wld'),
    projectId,
    category: patch.category,
    title: patch.title.trim(),
    aliases: patch.aliases ?? [],
    body: patch.body ?? '',
    parentId: patch.parentId,
    tags: patch.tags ?? [],
    rules: patch.rules ?? [],
    refs: [],
    importance: patch.importance ?? 3,
    imageIds: patch.imageIds ?? [],
    custom: patch.custom ?? {},
    createdAt: now,
    updatedAt: now,
  };
  await db.worldEntries.put(entry);
  return entry;
}

export async function updateWorldEntry(id: ID, patch: Partial<WorldEntry>): Promise<void> {
  await db.worldEntries.where('id').equals(id).modify((x) => { Object.assign(x, patch, { updatedAt: new Date().toISOString() }); });
}

export async function deleteWorldEntry(id: ID): Promise<void> {
  await db.transaction('rw', [db.worldEntries], async () => {
    const children = await db.worldEntries.where('parentId').equals(id).toArray();
    for (const c of children) await db.worldEntries.where('id').equals(c.id).modify((x) => { x.parentId = undefined; });
    await db.worldEntries.delete(id);
  });
}

// ---------------- 势力 ----------------

export async function listFactions(projectId: ID): Promise<Faction[]> {
  return db.factions.where('projectId').equals(projectId).toArray();
}

export async function upsertFaction(projectId: ID, patch: Partial<Faction> & { name: string }): Promise<Faction> {
  const now = new Date().toISOString();
  if (patch.id) {
    const existing = await db.factions.get(patch.id);
    if (existing) {
      const next = { ...existing, ...patch, updatedAt: now } as Faction;
      await db.factions.put(next);
      return next;
    }
  }
  const faction: Faction = {
    id: patch.id ?? newId('fac'),
    projectId,
    name: patch.name,
    description: patch.description,
    leaderId: patch.leaderId,
    memberIds: patch.memberIds ?? [],
    stance: patch.stance ?? {},
    power: patch.power ?? 1,
    color: patch.color,
    createdAt: now,
    updatedAt: now,
  };
  await db.factions.put(faction);
  return faction;
}

export async function deleteFaction(id: ID): Promise<void> {
  await db.factions.delete(id);
}

// ---------------- 实体 ----------------

export async function listEntities(projectId: ID): Promise<Entity[]> {
  const list = await db.entities.where('projectId').equals(projectId).toArray();
  return list.sort((a, b) => b.mentions - a.mentions || a.name.localeCompare(b.name, 'zh'));
}

export async function upsertEntity(
  projectId: ID,
  name: string,
  kind: EntityKind,
  patch: Partial<Entity> = {},
): Promise<Entity> {
  const key = normalizeForCompare(name);
  const all = await db.entities.where('projectId').equals(projectId).toArray();
  const existing = all.find((e) => normalizeForCompare(e.name) === key || e.aliases.some((a) => normalizeForCompare(a) === key));
  const now = new Date().toISOString();
  if (existing) {
    const next: Entity = {
      ...existing,
      aliases: Array.from(new Set([...existing.aliases, ...(patch.aliases ?? []), ...(existing.name === name ? [] : [name])])),
      summary: patch.summary ?? existing.summary,
      mentions: existing.mentions + (patch.mentions ?? 0),
      firstChapterId: existing.firstChapterId ?? patch.firstChapterId,
      confirmed: existing.confirmed || (patch.confirmed ?? false),
      updatedAt: now,
    };
    await db.entities.put(next);
    return next;
  }
  const entity: Entity = {
    id: newId('ent'),
    projectId,
    kind,
    name,
    aliases: patch.aliases ?? [],
    refId: patch.refId,
    summary: patch.summary,
    firstChapterId: patch.firstChapterId,
    mentions: patch.mentions ?? 0,
    confirmed: patch.confirmed ?? false,
    tags: patch.tags ?? [],
    createdAt: now,
    updatedAt: now,
  };
  await db.entities.put(entity);
  return entity;
}

export async function updateEntity(id: ID, patch: Partial<Entity>): Promise<void> {
  await db.entities.where('id').equals(id).modify((x) => { Object.assign(x, patch, { updatedAt: new Date().toISOString() }); });
}

export async function deleteEntity(id: ID): Promise<void> {
  await db.transaction('rw', [db.entities, db.entityMentions], async () => {
    await db.entities.delete(id);
    await db.entityMentions.where('entityId').equals(id).delete();
  });
}

export async function replaceMentions(chapterId: ID, rows: Omit<EntityMention, 'id'>[]): Promise<void> {
  await db.transaction('rw', [db.entityMentions], async () => {
    await db.entityMentions.where('chapterId').equals(chapterId).delete();
    for (const r of rows) {
      await db.entityMentions.put({ ...r, id: `${r.entityId}::${chapterId}` });
    }
  });
}

export async function listMentionsForChapter(chapterId: ID): Promise<EntityMention[]> {
  return db.entityMentions.where('chapterId').equals(chapterId).toArray();
}

// ---------------- 名词表 ----------------

export async function listGlossary(projectId: ID): Promise<GlossaryTerm[]> {
  return db.glossary.where('projectId').equals(projectId).toArray();
}

export async function upsertGlossary(
  projectId: ID,
  canonical: string,
  variants: string[],
  patch: Partial<GlossaryTerm> = {},
): Promise<GlossaryTerm> {
  const all = await db.glossary.where('projectId').equals(projectId).toArray();
  const existing = all.find((g) => normalizeForCompare(g.canonical) === normalizeForCompare(canonical));
  const now = new Date().toISOString();
  if (existing) {
    const next: GlossaryTerm = {
      ...existing,
      variants: Array.from(new Set([...existing.variants, ...variants])),
      strict: patch.strict ?? existing.strict,
      note: patch.note ?? existing.note,
      updatedAt: now,
    };
    await db.glossary.put(next);
    return next;
  }
  const term: GlossaryTerm = {
    id: newId('glo'),
    projectId,
    canonical,
    variants,
    strict: patch.strict ?? true,
    note: patch.note,
    createdAt: now,
    updatedAt: now,
  };
  await db.glossary.put(term);
  return term;
}

export async function deleteGlossary(id: ID): Promise<void> {
  await db.glossary.delete(id);
}

// ---------------- 连续性规则 ----------------

export async function listRules(projectId: ID): Promise<ContinuityRule[]> {
  return db.rules.where('projectId').equals(projectId).toArray();
}

export async function upsertRule(projectId: ID, patch: Partial<ContinuityRule> & { name: string; description: string }): Promise<ContinuityRule> {
  const now = new Date().toISOString();
  if (patch.id) {
    const existing = await db.rules.get(patch.id);
    if (existing) {
      const next = { ...existing, ...patch, updatedAt: now } as ContinuityRule;
      await db.rules.put(next);
      return next;
    }
  }
  const rule: ContinuityRule = {
    id: patch.id ?? newId('rule'),
    projectId,
    name: patch.name,
    description: patch.description,
    kind: patch.kind ?? 'forbidden',
    value: patch.value ?? '',
    severity: patch.severity ?? 'warn',
    enabled: patch.enabled ?? true,
    scope: patch.scope ?? 'project',
    scopeId: patch.scopeId,
    createdAt: now,
    updatedAt: now,
  };
  await db.rules.put(rule);
  return rule;
}

export async function deleteRule(id: ID): Promise<void> {
  await db.rules.delete(id);
}
