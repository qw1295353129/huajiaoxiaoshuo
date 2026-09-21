import type { GenesisRun, ID } from '@/core';
import { db } from '../database';
import { newId } from '@/utils/id';

export async function createGenesisRun(projectId: ID, seed: string, constraints: GenesisRun['constraints']): Promise<GenesisRun> {
  const now = new Date().toISOString();
  const run: GenesisRun = {
    id: newId('gen_run'),
    projectId,
    seed,
    seedKind: 'idea',
    constraints,
    stages: [],
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  };
  await db.genesis.put(run);
  return run;
}

export async function getGenesisRun(id: ID): Promise<GenesisRun | undefined> {
  return db.genesis.get(id);
}

export async function listGenesisRuns(projectId: ID): Promise<GenesisRun[]> {
  const list = await db.genesis.where('projectId').equals(projectId).toArray();
  return list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function updateGenesisRun(id: ID, patch: Partial<GenesisRun>): Promise<void> {
  await db.genesis.where('id').equals(id).modify((x) => { Object.assign(x, patch, { updatedAt: new Date().toISOString() }); });
}
