// Public entry for the Entangle library.
// Keep this file short — it's a table of contents, not a shim.

export type {
  IdentityGraph,
  Person,
  PlatformHandle,
  PlatformId,
  Availability,
  Relationship,
  RelationshipType,
} from './engram/types.ts';
export { EngramLite } from './engram/lite.ts';
export { resolveSeed, applySeed, loadSeedFile } from './engram/seed.ts';
export type { SeedProfile, SeedInput, LoadedSeed } from './engram/seed.ts';

export type {
  SealedIntent,
  BroadcastProbe,
  BroadcastConstraints,
  BroadcastResponse,
  IntentKind,
  IntentState,
  Urgency,
  IntentStore,
  BroadcastStore,
  Messenger,
  OutboundMessage,
  Humanizer,
  ProtocolDeps,
} from './core/types.ts';
export {
  sealedIntent,
  detectMutual,
  filterCandidate,
  quietBroadcast,
} from './core/protocol.ts';
export { IntentStoreSqlite, BroadcastStoreSqlite, ensureSchema } from './core/stores.ts';
export { humanize, stubHumanizer, realHumanizer } from './core/humanize.ts';

export { MemoryMessenger } from './messaging/memory.ts';
