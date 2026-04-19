import * as z from 'zod/v3';

export const PlatformIdSchema = z.enum(['imessage', 'whatsapp', 'telegram', 'slack', 'discord']);

export type PlatformId = z.infer<typeof PlatformIdSchema>;

export const PlatformHandleSchema = z.object({
  platform: PlatformIdSchema,
  handle: z.string().min(1),
});

export type PlatformHandle = z.infer<typeof PlatformHandleSchema>;

export const PersonSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  handles: z.array(PlatformHandleSchema),
  preferredPlatforms: z.array(PlatformIdSchema),
  preferences: z.record(z.string(), z.unknown()),
});

export type Person = z.infer<typeof PersonSchema>;

export const RelationshipTypeSchema = z.enum([
  'colleague',
  'friend',
  'met-once',
  'collaborator',
  'runs-with',
]);

export type RelationshipType = z.infer<typeof RelationshipTypeSchema>;

export const RelationshipSchema = z.object({
  fromId: z.string().min(1),
  toId: z.string().min(1),
  type: RelationshipTypeSchema,
  lastContactAt: z.date().nullable(),
  tags: z.array(z.string()),
});

export type Relationship = z.infer<typeof RelationshipSchema>;

export interface IdentityGraph {
  getPerson(id: string): Promise<Person | null>;
  resolveByHandle(handle: PlatformHandle): Promise<Person | null>;
  resolveByDescription(description: string, contextPersonId: string): Promise<Person[]>;
  getRelationship(fromId: string, toId: string): Promise<Relationship | null>;
  listFriends(personId: string): Promise<Person[]>;
  preferredPlatformBetween(fromId: string, toId: string): Promise<PlatformId>;
}
