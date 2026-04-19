import { nanoid } from 'nanoid';
import type { IdentityGraph, Person } from '../engram/types.js';
import type { Channel } from '../spectrum/types.js';
import type { EventLog } from './events.js';
import type { Humanizer } from './humanize.js';
import type { BroadcastStore, IntentStore } from './store.js';
import {
  BroadcastInputSchema,
  type BroadcastProbe,
  type EntangleEvent,
  IntentInputSchema,
  type IntentKind,
  type SealedIntent,
  type Urgency,
} from './types.js';

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export interface SealedIntentDeps {
  graph: IdentityGraph;
  channel: Channel;
  store: IntentStore;
  events: EventLog;
}

export interface DetectMutualDeps {
  graph: IdentityGraph;
  channel: Channel;
  store: IntentStore;
  events: EventLog;
  humanize: Humanizer;
}

export interface QuietBroadcastDeps {
  graph: IdentityGraph;
  channel: Channel;
  store: BroadcastStore;
  events: EventLog;
  humanize: Humanizer;
}

export interface FilterDeps {
  graph: IdentityGraph;
}

export interface SealedIntentInput {
  from: Person;
  to: Person;
  payload: string;
  kind: IntentKind;
  urgency?: Urgency;
  ttlMs?: number;
}

export async function sealedIntent(
  deps: SealedIntentDeps,
  input: SealedIntentInput
): Promise<SealedIntent> {
  IntentInputSchema.parse(input);

  const createdAt = new Date();
  const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS;
  const expiresAt = new Date(createdAt.getTime() + ttlMs);

  const intent: SealedIntent = {
    id: nanoid(),
    ownerPersonId: input.from.id,
    targetPersonId: input.to.id,
    kind: input.kind,
    payload: input.payload,
    urgency: input.urgency ?? 'med',
    createdAt,
    expiresAt,
    state: 'sealed',
  };

  deps.store.save(intent);
  const event: EntangleEvent = { type: 'sealed', at: new Date(), intent };
  deps.events.emit(event);

  // Critical: no channel send. Intent stays invisible until mutual detection.
  return intent;
}

// Module-level per-pair mutex so concurrent detectMutual calls for the same
// pair serialize — needed so "two intents submitted simultaneously must match
// exactly once" (spec §6 Phase 2 acceptance).
const pairLocks = new Map<string, Promise<unknown>>();

function pairKey(a: string, b: string): string {
  return [a, b].sort().join('::');
}

async function withPairLock<T>(a: string, b: string, fn: () => Promise<T>): Promise<T> {
  const key = pairKey(a, b);
  const prev = pairLocks.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  pairLocks.set(
    key,
    next.catch(() => undefined)
  );
  try {
    return await next;
  } finally {
    if (pairLocks.get(key) === next) {
      pairLocks.delete(key);
    }
  }
}

export interface DetectMutualResult {
  matched: boolean;
  counterpart?: SealedIntent;
}

export async function detectMutual(
  deps: DetectMutualDeps,
  intent: SealedIntent
): Promise<DetectMutualResult> {
  return withPairLock(intent.ownerPersonId, intent.targetPersonId, async () => {
    // Re-read both to ensure current state before committing match.
    const self = deps.store.get(intent.id);
    if (!self || self.state !== 'sealed') {
      return { matched: false };
    }

    const reverse = deps.store.findReverse({
      ownerId: self.ownerPersonId,
      targetId: self.targetPersonId,
      kind: self.kind,
    });
    if (!reverse) {
      return { matched: false };
    }

    // Atomically flip both from sealed -> matched.
    const selfNow = deps.store.get(self.id);
    const revNow = deps.store.get(reverse.id);
    if (!selfNow || !revNow || selfNow.state !== 'sealed' || revNow.state !== 'sealed') {
      return { matched: false };
    }
    const matchedSelf = deps.store.update(selfNow.id, { state: 'matched' });
    const matchedRev = deps.store.update(revNow.id, { state: 'matched' });

    deps.events.emit({
      type: 'mutual-detected',
      at: new Date(),
      a: matchedSelf,
      b: matchedRev,
    });

    const [platformForSelfOwner, platformForRevOwner] = await Promise.all([
      deps.graph.preferredPlatformBetween(matchedSelf.ownerPersonId, matchedSelf.targetPersonId),
      deps.graph.preferredPlatformBetween(matchedRev.ownerPersonId, matchedRev.targetPersonId),
    ]);

    const [selfOwnerPerson, revOwnerPerson] = await Promise.all([
      deps.graph.getPerson(matchedSelf.ownerPersonId),
      deps.graph.getPerson(matchedRev.ownerPersonId),
    ]);
    if (!selfOwnerPerson) throw new Error(`unknown person: ${matchedSelf.ownerPersonId}`);
    if (!revOwnerPerson) throw new Error(`unknown person: ${matchedRev.ownerPersonId}`);

    const selfOwnerHandle = selfOwnerPerson.handles.find((h) => h.platform === platformForRevOwner);
    const revOwnerHandle = revOwnerPerson.handles.find((h) => h.platform === platformForSelfOwner);
    if (!selfOwnerHandle) throw new Error(`no handle for ${selfOwnerPerson.id}`);
    if (!revOwnerHandle) throw new Error(`no handle for ${revOwnerPerson.id}`);

    const selfMessage = await deps.humanize(
      buildRevealPrompt(selfOwnerPerson, revOwnerPerson, matchedSelf)
    );
    await deps.channel.send(revOwnerHandle, { text: selfMessage, kind: 'notice' });
    deps.events.emit({
      type: 'reveal',
      at: new Date(),
      intentId: matchedSelf.id,
      to: revOwnerPerson.id,
      message: selfMessage,
    });

    const revMessage = await deps.humanize(
      buildRevealPrompt(revOwnerPerson, selfOwnerPerson, matchedRev)
    );
    await deps.channel.send(selfOwnerHandle, { text: revMessage, kind: 'notice' });
    deps.events.emit({
      type: 'reveal',
      at: new Date(),
      intentId: matchedRev.id,
      to: selfOwnerPerson.id,
      message: revMessage,
    });

    deps.store.update(matchedSelf.id, { state: 'revealed' });
    deps.store.update(matchedRev.id, { state: 'revealed' });

    return { matched: true, counterpart: matchedRev };
  });
}

function buildRevealPrompt(owner: Person, target: Person, intent: SealedIntent): string {
  return [
    `Agent decision: mutual intent detected between ${owner.displayName} and ${target.displayName}.`,
    `Owner (${owner.displayName}) original phrasing: "${intent.payload}".`,
    `Kind: ${intent.kind}. Urgency: ${intent.urgency}.`,
    `Write a short warm message addressed to ${target.displayName} revealing that ${owner.displayName} also wanted this.`,
  ].join('\n');
}

export type FilterVerdict = 'suppress' | 'deliver';

export interface FilterVerdictWithReason {
  verdict: FilterVerdict;
  reason?: string;
}

export async function filterCandidate(
  deps: FilterDeps,
  _ownerId: string,
  candidateId: string,
  _context: BroadcastProbe
): Promise<FilterVerdictWithReason> {
  const candidate = await deps.graph.getPerson(candidateId);
  if (!candidate) return { verdict: 'suppress', reason: 'unknown' };

  const availability = candidate.preferences.availability;
  if (availability === 'busy') return { verdict: 'suppress', reason: 'busy' };
  if (availability === 'traveling') return { verdict: 'suppress', reason: 'traveling' };
  if (availability === 'declined-recently') {
    return { verdict: 'suppress', reason: 'declined-recently' };
  }
  return { verdict: 'deliver' };
}

export interface QuietBroadcastInput {
  owner: Person;
  candidates: Person[];
  payload: string;
  constraints: BroadcastProbe['constraints'];
}

export async function quietBroadcast(
  deps: QuietBroadcastDeps,
  input: QuietBroadcastInput
): Promise<BroadcastProbe> {
  BroadcastInputSchema.parse(input);

  const createdAt = new Date();
  const initialResponses: Record<string, 'yes' | 'no' | 'silent'> = {};
  for (const c of input.candidates) {
    initialResponses[c.id] = 'silent';
  }

  const probe: BroadcastProbe = {
    id: nanoid(),
    ownerPersonId: input.owner.id,
    candidatePersonIds: input.candidates.map((c) => c.id),
    payload: input.payload,
    constraints: { ...input.constraints },
    createdAt,
    responses: initialResponses,
  };

  deps.store.save(probe);
  deps.events.emit({
    type: 'broadcast-started',
    at: new Date(),
    probeId: probe.id,
    candidateCount: input.candidates.length,
  });

  for (const candidate of input.candidates) {
    const { verdict, reason } = await filterCandidate(
      { graph: deps.graph },
      input.owner.id,
      candidate.id,
      probe
    );

    if (verdict === 'suppress') {
      deps.events.emit({
        type: 'suppressed',
        at: new Date(),
        probeId: probe.id,
        candidateId: candidate.id,
        reason: reason ?? 'unknown',
      });
      continue;
    }

    const platform = await deps.graph.preferredPlatformBetween(input.owner.id, candidate.id);
    const handle = candidate.handles.find((h) => h.platform === platform);
    if (!handle) {
      deps.events.emit({
        type: 'suppressed',
        at: new Date(),
        probeId: probe.id,
        candidateId: candidate.id,
        reason: 'no-handle',
      });
      continue;
    }

    const message = await deps.humanize(buildProbePrompt(input.owner, candidate, probe));
    await deps.channel.send(handle, { text: message, kind: 'prompt' });
    deps.events.emit({
      type: 'probed',
      at: new Date(),
      probeId: probe.id,
      candidateId: candidate.id,
      message,
    });
  }

  return probe;
}

function buildProbePrompt(owner: Person, candidate: Person, probe: BroadcastProbe): string {
  const where = probe.constraints.where ? ` in ${probe.constraints.where}` : '';
  return [
    `Agent decision: quiet broadcast from ${owner.displayName} to ${candidate.displayName}.`,
    `Context: ${owner.displayName}'s wondering if you're around for ${probe.payload}${where} ${probe.constraints.when}. No pressure.`,
    `Write a gentle, low-pressure probe addressed to ${candidate.displayName}.`,
  ].join('\n');
}

export interface RecordBroadcastResponseDeps {
  store: BroadcastStore;
  events: EventLog;
}

export function recordBroadcastResponse(
  deps: RecordBroadcastResponseDeps,
  probeId: string,
  candidateId: string,
  response: 'yes' | 'no'
): BroadcastProbe {
  const updated = deps.store.recordResponse(probeId, candidateId, response);
  deps.events.emit({
    type: 'response',
    at: new Date(),
    probeId,
    from: candidateId,
    response,
  });
  return updated;
}

export interface FinalizeBroadcastDeps {
  store: BroadcastStore;
  events: EventLog;
}

export interface FinalizeResult {
  yesResponders: string[];
  threadOpened: boolean;
}

export function finalizeBroadcast(
  deps: FinalizeBroadcastDeps,
  probeId: string,
  threadContext?: string
): FinalizeResult {
  const probe = deps.store.get(probeId);
  if (!probe) throw new Error(`probe not found: ${probeId}`);
  const yesResponders = Object.entries(probe.responses)
    .filter(([, r]) => r === 'yes')
    .map(([id]) => id);

  deps.events.emit({
    type: 'bubble-up',
    at: new Date(),
    probeId,
    yesResponders,
  });

  if (yesResponders.length > 0) {
    deps.events.emit({
      type: 'thread-opened',
      at: new Date(),
      participants: [probe.ownerPersonId, ...yesResponders],
      context: threadContext ?? probe.payload,
    });
    return { yesResponders, threadOpened: true };
  }

  return { yesResponders, threadOpened: false };
}
