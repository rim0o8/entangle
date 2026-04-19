import { readFileSync } from 'node:fs';
import * as z from 'zod/v3';
import type { EngramLite } from './lite.js';
import {
  AvailabilitySchema,
  PersonSchema,
  PlatformHandleSchema,
  PlatformIdSchema,
  RelationshipTypeSchema,
} from './types.js';

export const SeedPersonSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  handles: z.array(PlatformHandleSchema),
  preferredPlatforms: z.array(PlatformIdSchema),
  preferences: z.record(z.string(), z.unknown()).default({}),
  availability: AvailabilitySchema.optional(),
  real: z.boolean().optional(),
});

export const SeedRelationshipSchema = z.object({
  fromId: z.string().min(1),
  toId: z.string().min(1),
  type: RelationshipTypeSchema,
  lastContactAt: z.string().datetime().nullable(),
  tags: z.array(z.string()).default([]),
});

export const SeedFileSchema = z.object({
  persons: z.array(SeedPersonSchema),
  relationships: z.array(SeedRelationshipSchema),
});

export type SeedFile = z.infer<typeof SeedFileSchema>;
export type SeedPerson = z.infer<typeof SeedPersonSchema>;

export type SeedProfile = 'test' | 'demo';

export interface LoadSeedOptions {
  path: string;
  profile?: SeedProfile;
  env?: NodeJS.ProcessEnv;
}

const DEMO_ENV_MAP: Readonly<Record<string, string>> = {
  yuri: 'YURI_APPLE_ID',
  alex: 'ALEX_APPLE_ID',
  mika: 'MIKA_APPLE_ID',
  taro: 'TARO_APPLE_ID',
  ken: 'KEN_APPLE_ID',
};

export function parseSeed(raw: string): SeedFile {
  const parsed: unknown = JSON.parse(raw);
  return SeedFileSchema.parse(parsed);
}

function applyDemoProfile(persons: SeedPerson[], env: NodeJS.ProcessEnv): SeedPerson[] {
  return persons.map((p) => {
    const envVar = DEMO_ENV_MAP[p.id];
    if (!envVar) return p;
    const override = env[envVar];
    if (!override || override.trim().length === 0) {
      throw new Error(
        `loadSeed(demo): missing required env var ${envVar} for person '${p.id}'. Populate .env.local before running with profile='demo'.`
      );
    }
    return {
      ...p,
      handles: p.handles.map((h) =>
        h.platform === 'imessage' ? { ...h, handle: override.trim() } : h
      ),
    };
  });
}

export function loadSeed(engram: EngramLite, options: LoadSeedOptions): SeedFile {
  const profile: SeedProfile = options.profile ?? 'test';
  const env = options.env ?? process.env;
  const raw = readFileSync(options.path, 'utf8');
  const seed = parseSeed(raw);

  const persons = profile === 'demo' ? applyDemoProfile(seed.persons, env) : seed.persons;

  for (const p of persons) {
    const person = PersonSchema.parse({
      id: p.id,
      displayName: p.displayName,
      handles: p.handles,
      preferredPlatforms: p.preferredPlatforms,
      preferences: p.preferences,
      availability: p.availability,
      real: p.real,
    });
    engram.upsertPerson(person);
  }
  for (const r of seed.relationships) {
    engram.upsertRelationship({
      fromId: r.fromId,
      toId: r.toId,
      type: r.type,
      lastContactAt: r.lastContactAt ? new Date(r.lastContactAt) : null,
      tags: r.tags,
    });
  }
  return { persons, relationships: seed.relationships };
}
