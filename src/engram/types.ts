// Identity layer types. Engram is the identity graph.
// All types here are data — no behavior.

export type PlatformId = 'imessage';

export interface PlatformHandle {
  platform: PlatformId;
  handle: string;
}

export type Availability = 'free' | 'busy' | 'traveling' | 'declined-recently';

export interface Person {
  id: string;
  displayName: string;
  handles: PlatformHandle[];
  preferredPlatforms: PlatformId[];
  preferences: Record<string, unknown>;
  availability?: Availability;
}

export type RelationshipType =
  | 'colleague'
  | 'friend'
  | 'met-once'
  | 'collaborator'
  | 'runs-with';

export interface Relationship {
  fromId: string;
  toId: string;
  type: RelationshipType;
  lastContactAt: Date | null;
  tags: string[];
}

export interface IdentityGraph {
  getPerson(id: string): Promise<Person | null>;
  resolveByHandle(handle: PlatformHandle): Promise<Person | null>;
  getRelationship(fromId: string, toId: string): Promise<Relationship | null>;
  listFriends(personId: string): Promise<Person[]>;
}
