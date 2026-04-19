// Spectrum — channels and events
export type {
  Channel,
  ChannelMessage,
  ChannelReceiver,
  MessageKind,
} from './spectrum/types.js';
export {
  type ChannelEvent,
  type ChannelEventListener,
  type MockChannel,
  type MockChannelOptions,
  type SentRecord,
  createMockChannel,
} from './spectrum/mock.js';
export {
  type TelegramBotLike,
  type TelegramChannel,
  type TelegramChannelOptions,
  createTelegramChannel,
} from './spectrum/telegram.js';
export {
  type ChildChannel,
  type CompositeChannel,
  type SelectChannelDeps,
  type SelectedChannel,
  createChannelFromEnv,
  createCompositeChannel,
} from './spectrum/select.js';

// Engram — identity graph
export type {
  IdentityGraph,
  Person,
  PlatformHandle,
  PlatformId,
  Relationship,
  RelationshipType,
} from './engram/types.js';
export { EngramLite } from './engram/lite.js';
export { loadSeed, parseSeed, type SeedFile } from './engram/seed.js';

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
  EntangleEvent,
  EntangleEventType,
  IntentKind,
  IntentState,
  SealedIntent,
  Urgency,
} from './core/types.js';

export {
  createBroadcastStore,
  createIntentStore,
  type BroadcastStore,
  type IntentStore,
} from './core/store.js';

// Event log — subscribe + emit
export {
  createEventLog,
  type EventHandler,
  type EventLog,
} from './core/events.js';

// Humanizer
export {
  createAnthropicHumanizer,
  createStubHumanizer,
  type Humanizer,
  type AnthropicHumanizerOptions,
} from './core/humanize.js';
