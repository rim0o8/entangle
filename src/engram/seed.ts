import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { EngramLite } from './lite.ts';
import type { Person, Relationship } from './types.ts';

// Seed loader — parses data/seed.json and upserts into EngramLite.
//
// Two profiles:
//  - 'test': all handles are synthetic (+1-555-xxxx), nothing contactable
//  - 'demo': slots marked with ${ENV:VAR} are replaced by process.env[VAR],
//            and we fail fast if any required env var is blank.

export type SeedProfile = 'test' | 'demo';

const HandleSchema = z.object({
  platform: z.literal('imessage'),
  handle: z.string().min(1),
});

const PersonSchema = z.object({
  id: z.string().min(1),
  displayName: z.string(),
  handles: z.array(HandleSchema).min(1),
  preferredPlatforms: z.array(z.literal('imessage')),
  preferences: z.record(z.unknown()),
  availability: z.enum(['free', 'busy', 'traveling', 'declined-recently']).optional(),
});

const RelationshipSchema = z.object({
  fromId: z.string(),
  toId: z.string(),
  type: z.enum(['colleague', 'friend', 'met-once', 'collaborator', 'runs-with']),
  lastContactAt: z.union([z.string(), z.null()]).optional(),
  tags: z.array(z.string()),
});

const SeedSchema = z.object({
  persons: z.array(PersonSchema),
  relationships: z.array(RelationshipSchema),
});

const ENV_PLACEHOLDER = /^\$\{ENV:([A-Z0-9_]+)\}$/;

export interface SeedInput {
  path: string;
  profile: SeedProfile;
  env?: NodeJS.ProcessEnv;
}

export function loadSeedFile(path: string): unknown {
  const raw = readFileSync(path, 'utf8');
  return JSON.parse(raw);
}

export interface LoadedSeed {
  persons: Person[];
  relationships: Relationship[];
}

export function resolveSeed(input: SeedInput): LoadedSeed {
  const parsed = SeedSchema.parse(loadSeedFile(input.path));
  const env = input.env ?? process.env;

  const persons: Person[] = parsed.persons.map((p) => {
    const handles = p.handles.map((h) => ({
      platform: h.platform,
      handle: resolveHandle(h.handle, input.profile, env),
    }));
    const person: Person = {
      id: p.id,
      displayName: p.displayName,
      handles,
      preferredPlatforms: p.preferredPlatforms,
      preferences: p.preferences,
    };
    if (p.availability) person.availability = p.availability;
    return person;
  });

  const relationships: Relationship[] = parsed.relationships.map((r) => ({
    fromId: r.fromId,
    toId: r.toId,
    type: r.type,
    lastContactAt: r.lastContactAt ? new Date(r.lastContactAt) : null,
    tags: r.tags,
  }));

  return { persons, relationships };
}

function resolveHandle(raw: string, profile: SeedProfile, env: NodeJS.ProcessEnv): string {
  const match = ENV_PLACEHOLDER.exec(raw);
  if (!match) return raw;
  const key = match[1];
  if (!key) throw new Error(`seed: malformed env placeholder ${raw}`);
  if (profile === 'test') {
    // In test profile, env placeholders fall back to a deterministic fake.
    return `+1-555-TEST-${key}`;
  }
  const value = env[key];
  if (!value || value.trim() === '') {
    throw new Error(
      `seed: demo profile requires env var ${key} to be set (found in ${raw})`,
    );
  }
  return value.trim();
}

export function applySeed(engram: EngramLite, seed: LoadedSeed): void {
  for (const p of seed.persons) engram.upsertPerson(p);
  for (const r of seed.relationships) engram.upsertRelationship(r);
}
