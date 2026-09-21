import type { Character, CharacterAppearance, CharacterMilestone, ID, Relationship } from '@/core';
import { db } from '../database';
import { newId } from '@/utils/id';

export async function listCharacters(projectId: ID): Promise<Character[]> {
  const list = await db.characters.where('projectId').equals(projectId).toArray();
  return list.sort((a, b) => roleWeight(a.role) - roleWeight(b.role) || a.name.localeCompare(b.name, 'zh'));
}

function roleWeight(role: Character['role']): number {
  const w: Record<Character['role'], number> = {
    protagonist: 0, antagonist: 1, deuteragonist: 2, mentor: 3, 'love-interest': 4,
    foil: 5, sidekick: 6, minor: 7, cameo: 8,
  };
  return w[role] ?? 9;
}

export async function getCharacter(id: ID): Promise<Character | undefined> {
  return db.characters.get(id);
}

export async function createCharacter(projectId: ID, patch: Partial<Character> & { name: string }): Promise<Character> {
  const now = new Date().toISOString();
  const character: Character = {
    id: newId('chr'),
    projectId,
    name: patch.name.trim(),
    aliases: patch.aliases ?? [],
    role: patch.role ?? 'minor',
    tagline: patch.tagline,
    age: patch.age,
    gender: patch.gender,
    pronouns: patch.pronouns,
    appearance: patch.appearance,
    personality: patch.personality,
    voice: patch.voice,
    background: patch.background,
    want: patch.want,
    need: patch.need,
    fear: patch.fear,
    flaw: patch.flaw,
    arc: patch.arc,
    secrets: patch.secrets,
    abilities: patch.abilities ?? [],
    factionIds: patch.factionIds ?? [],
    firstAppearanceChapterId: patch.firstAppearanceChapterId,
    status: patch.status ?? 'alive',
    writingNotes: patch.writingNotes,
    color: patch.color,
    avatarEmoji: patch.avatarEmoji,
    tags: patch.tags ?? [],
    milestones: patch.milestones ?? [],
    custom: patch.custom ?? {},
    createdAt: now,
    updatedAt: now,
  };
  await db.characters.put(character);
  return character;
}

export async function updateCharacter(id: ID, patch: Partial<Character>): Promise<void> {
  await db.characters.where('id').equals(id).modify((x) => { Object.assign(x, patch, { updatedAt: new Date().toISOString() }); });
}

export async function deleteCharacter(id: ID): Promise<void> {
  await db.transaction('rw', [db.characters, db.relationships, db.characterAppearances], async () => {
    await db.characters.delete(id);
    await db.relationships.where('fromId').equals(id).delete();
    await db.relationships.where('toId').equals(id).delete();
    await db.characterAppearances.where('characterId').equals(id).delete();
  });
}

export async function addMilestone(characterId: ID, milestone: Omit<CharacterMilestone, 'id'>): Promise<void> {
  await db.characters.where('id').equals(characterId).modify((c) => {
    c.milestones = [...c.milestones, { ...milestone, id: newId('ms') }];
    c.updatedAt = new Date().toISOString();
  });
}

export async function removeMilestone(characterId: ID, milestoneId: ID): Promise<void> {
  await db.characters.where('id').equals(characterId).modify((c) => {
    c.milestones = c.milestones.filter((m) => m.id !== milestoneId);
    c.updatedAt = new Date().toISOString();
  });
}

// ---------------- 关系 ----------------

export async function listRelationships(projectId: ID): Promise<Relationship[]> {
  return db.relationships.where('projectId').equals(projectId).toArray();
}

export async function upsertRelationship(
  projectId: ID,
  fromId: ID,
  toId: ID,
  patch: Partial<Relationship> = {},
): Promise<Relationship> {
  const existing = await db.relationships.where('fromId').equals(fromId).filter((r) => r.toId === toId).first();
  const now = new Date().toISOString();
  if (existing) {
    const next = { ...existing, ...patch, updatedAt: now };
    await db.relationships.put(next);
    return next;
  }
  const rel: Relationship = {
    id: newId('rel'),
    projectId,
    fromId,
    toId,
    kind: patch.kind ?? 'acquaintance',
    affinity: patch.affinity ?? 0,
    visibility: patch.visibility ?? 'public',
    description: patch.description,
    sinceChapterId: patch.sinceChapterId,
    endedChapterId: patch.endedChapterId,
    history: patch.history ?? [],
    createdAt: now,
    updatedAt: now,
  };
  await db.relationships.put(rel);
  return rel;
}

export async function deleteRelationship(id: ID): Promise<void> {
  await db.relationships.delete(id);
}

// ---------------- 出场统计 ----------------

export async function listAppearances(characterId: ID): Promise<CharacterAppearance[]> {
  const list = await db.characterAppearances.where('characterId').equals(characterId).toArray();
  return list;
}

export async function replaceAppearances(chapterId: ID, rows: Omit<CharacterAppearance, 'id'>[]): Promise<void> {
  await db.transaction('rw', [db.characterAppearances], async () => {
    await db.characterAppearances.where('chapterId').equals(chapterId).delete();
    for (const r of rows) {
      await db.characterAppearances.put({ ...r, id: `${r.characterId}::${r.chapterId}` });
    }
  });
}

/** 角色首次出场自动补全 */
export async function syncFirstAppearance(projectId: ID): Promise<void> {
  const [chapters, characters] = await Promise.all([db.chapters.where('projectId').equals(projectId).toArray(), listCharacters(projectId)]);
  const orderMap = new Map(chapters.map((c) => [c.id, c.order]));
  const listed = new Map<ID, number>();
  await db.transaction('rw', [db.chapters, db.characters], async () => {
    for (const ch of characters) {
      const orders = chapters.filter((c) => c.characterIds.includes(ch.id)).map((c) => c.order);
      const first = orders.length ? Math.min(...orders) : undefined;
      const firstId = first === undefined ? undefined : chapters.find((c) => c.order === first)?.id;
      if (firstId !== ch.firstAppearanceChapterId) {
        await db.characters.where('id').equals(ch.id).modify((c) => { c.firstAppearanceChapterId = firstId; });
      }
      if (first !== undefined) listed.set(ch.id, first);
    }
  });
  void orderMap; void listed;
}
