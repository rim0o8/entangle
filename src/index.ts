// Engram — identity graph
export type {
  Availability,
  IdentityGraph,
  Person,
  PlatformHandle,
  PlatformId,
  Relationship,
  RelationshipType,
} from './engram/types.js';
export { EngramLite } from './engram/lite.js';
export {
  loadSeed,
  parseSeed,
  type LoadSeedOptions,
  type SeedFile,
  type SeedProfile,
} from './engram/seed.js';

// Core — protocol primitives
export {
  detectMutual,
  filterCandidate,
  finalizeBroadcast,
  quietBroadcast,
  recordBroadcastResponse,
  sealedIntent,
  type DetectMutualDeps,
  type DetectMutualResult,
  type FilterDeps,
  type FilterVerdict,
  type FilterVerdictWithReason,
  type FinalizeBroadcastDeps,
  type FinalizeResult,
  type QuietBroadcastDeps,
  type QuietBroadcastInput,
  type RecordBroadcastResponseDeps,
  type SealedIntentDeps,
  type SealedIntentInput,
} from './core/protocol.js';

export type {
  BroadcastConstraints,
  BroadcastProbe,
  BroadcastResponse,
  BroadcastStore,
  EntangleEvent,
  EntangleEventType,
  Humanizer,
  IntentKind,
  IntentState,
  IntentStore,
  MessageKind,
  Messenger,
  SealedIntent,
  Urgency,
} from './core/types.js';

export {
  createBroadcastStore,
  createIntentStore,
  type StoreOptions,
} from './core/stores.js';

// Event log — subscribe + emit
export {
  createEventLog,
  type EventHandler,
  type EventLog,
} from './core/events.js';

// Humanizer
export {
  createAnthropicHumanizer,
  createHumanizerFromEnv,
  createStubHumanizer,
  type AnthropicHumanizerOptions,
} from './core/humanize.js';

// Messaging — Messenger port and in-memory test impl
export {
  createTestMessenger,
  type MessengerEvent,
  type MessengerEventListener,
  type SentRecord,
  type TestMessenger,
  type TestMessengerOptions,
} from './messaging/test.js';

// Demo — orchestrator + WS server
export {
  createDemoServer,
  createOrchestrator,
  type DemoServer,
  type DemoServerOptions,
  type Orchestrator,
  type OrchestratorDeps,
  type OrchestratorEvent,
  type OrchestratorEventHandler,
  type OrchestratorState,
  type ScenarioId,
} from './demo/index.js';
