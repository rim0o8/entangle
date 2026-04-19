import { readFileSync } from 'node:fs';
import * as z from 'zod/v3';
import type { EngramLite } from './lite.js';
import {
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

export function parseSeed(raw: string): SeedFile {
  const parsed: unknown = JSON.parse(raw);
  return SeedFileSchema.parse(parsed);
}

export function loadSeed(engram: EngramLite, seedPath: string): SeedFile {
  const raw = readFileSync(seedPath, 'utf8');
  const seed = parseSeed(raw);
  for (const p of seed.persons) {
    const person = PersonSchema.parse({
      id: p.id,
      displayName: p.displayName,
      handles: p.handles,
      preferredPlatforms: p.preferredPlatforms,
      preferences: p.preferences,
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
  return seed;
}
