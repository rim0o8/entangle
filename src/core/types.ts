// Core protocol types. Entangle-layer data shapes and ports.
// Behavior lives in protocol.ts; this file is pure data + interfaces.

import type { Person, PlatformHandle, IdentityGraph } from '../engram/types.ts';

export type IntentKind = 'collaborate' | 'reconnect' | 'custom';
export type IntentState = 'sealed' | 'matched' | 'expired' | 'revealed';
export type Urgency = 'low' | 'med' | 'high';

export interface SealedIntent {
  id: string;
  ownerPersonId: string;
  targetPersonId: string;
  kind: IntentKind;
  payload: string;
  urgency: Urgency;
  createdAt: Date;
  expiresAt: Date;
  state: IntentState;
}

export interface BroadcastConstraints {
  when: string;
  where?: string;
}

export interface BroadcastProbe {
  id: string;
  ownerPersonId: string;
  candidatePersonIds: string[];
  payload: string;
  constraints: BroadcastConstraints;
  createdAt: Date;
}

export type BroadcastResponse = 'yes' | 'no' | 'silent';

export interface IntentStore {
  put(intent: SealedIntent): Promise<void>;
  get(id: string): Promise<SealedIntent | null>;
  findReverse(intent: SealedIntent): Promise<SealedIntent | null>;
  /** Atomic CAS: mark both intents 'matched' iff both are still 'sealed'. */
  tryMatch(idA: string, idB: string): Promise<boolean>;
}

export interface BroadcastStore {
  put(probe: BroadcastProbe): Promise<void>;
  get(id: string): Promise<BroadcastProbe | null>;
  recordResponse(probeId: string, personId: string, response: BroadcastResponse): Promise<void>;
  listYes(probeId: string): Promise<string[]>;
}

export interface OutboundMessage {
  text: string;
  kind?: 'prompt' | 'notice' | 'confirm';
}

export interface Messenger {
  send(to: PlatformHandle, message: OutboundMessage): Promise<void>;
  onReceive(handler: (from: PlatformHandle, text: string) => Promise<void>): void;
}

export interface Humanizer {
  renderReveal(self: SealedIntent, counterpart: SealedIntent): Promise<string>;
  renderProbe(probe: BroadcastProbe, candidate: Person): Promise<string>;
  renderBubbleUp(probe: BroadcastProbe, yesResponders: Person[]): Promise<string>;
}

export interface ProtocolDeps {
  graph: IdentityGraph;
  messenger: Messenger;
  intents: IntentStore;
  probes: BroadcastStore;
  humanize: Humanizer;
  now: () => Date;
}
