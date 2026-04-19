import { nanoid } from 'nanoid';
import type { IdentityGraph, Person } from '../engram/types.js';
import type { EventLog } from './events.js';
import {
  BroadcastInputSchema,
  type BroadcastProbe,
  type BroadcastStore,
  type Humanizer,
  IntentInputSchema,
  type IntentKind,
  type IntentStore,
  type Messenger,
  type SealedIntent,
  type Urgency,
} from './types.js';

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export interface SealedIntentDeps {
  graph: IdentityGraph;
  messenger: Messenger;
  store: IntentStore;
  events: EventLog;
}

export interface DetectMutualDeps {
  graph: IdentityGraph;
  messenger: Messenger;
  store: IntentStore;
  events: EventLog;
  humanize: Humanizer;
}

export interface QuietBroadcastDeps {
  graph: IdentityGraph;
  messenger: Messenger;
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

  await deps.store.put(intent);
  deps.events.emit({ type: 'sealed', at: new Date(), intent });

  // Critical: no messenger send. Intent stays invisible until mutual detection.
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
    const self = await deps.store.get(intent.id);
    if (!self || self.state !== 'sealed') {
      return { matched: false };
    }

    const reverse = await deps.store.findReverse(self);
    if (!reverse) {
      return { matched: false };
    }

    // Re-read both to verify state before committing match.
    const [selfNow, revNow] = await Promise.all([
      deps.store.get(self.id),
      deps.store.get(reverse.id),
    ]);
    if (!selfNow || !revNow || selfNow.state !== 'sealed' || revNow.state !== 'sealed') {
      return { matched: false };
    }

    await deps.store.setState(selfNow.id, 'matched');
    await deps.store.setState(revNow.id, 'matched');
    const matchedSelf: SealedIntent = { ...selfNow, state: 'matched' };
    const matchedRev: SealedIntent = { ...revNow, state: 'matched' };

    deps.events.emit({
      type: 'mutual-detected',
      at: new Date(),
      a: matchedSelf,
      b: matchedRev,
    });

    const [selfOwnerPerson, revOwnerPerson] = await Promise.all([
      deps.graph.getPerson(matchedSelf.ownerPersonId),
      deps.graph.getPerson(matchedRev.ownerPersonId),
    ]);
    if (!selfOwnerPerson) throw new Error(`unknown person: ${matchedSelf.ownerPersonId}`);
    if (!revOwnerPerson) throw new Error(`unknown person: ${matchedRev.ownerPersonId}`);

    const [platformForRevOwner, platformForSelfOwner] = await Promise.all([
      deps.graph.preferredPlatformBetween(matchedSelf.ownerPersonId, matchedSelf.targetPersonId),
      deps.graph.preferredPlatformBetween(matchedRev.ownerPersonId, matchedRev.targetPersonId),
    ]);

    const revOwnerHandle = revOwnerPerson.handles.find((h) => h.platform === platformForRevOwner);
    const selfOwnerHandle = selfOwnerPerson.handles.find(
      (h) => h.platform === platformForSelfOwner
    );
    if (!revOwnerHandle) throw new Error(`no handle for ${revOwnerPerson.id}`);
    if (!selfOwnerHandle) throw new Error(`no handle for ${selfOwnerPerson.id}`);

    // Render + send reveal to the counterpart owner (target of matchedSelf).
    const selfMessage = await deps.humanize.renderReveal(matchedSelf, matchedRev);
    await deps.messenger.send(revOwnerHandle, { text: selfMessage, kind: 'notice' });
    deps.events.emit({
      type: 'reveal',
      at: new Date(),
      intentId: matchedSelf.id,
      to: revOwnerPerson.id,
      message: selfMessage,
    });

    const revMessage = await deps.humanize.renderReveal(matchedRev, matchedSelf);
    await deps.messenger.send(selfOwnerHandle, { text: revMessage, kind: 'notice' });
    deps.events.emit({
      type: 'reveal',
      at: new Date(),
      intentId: matchedRev.id,
      to: selfOwnerPerson.id,
      message: revMessage,
    });

    await deps.store.setState(matchedSelf.id, 'revealed');
    await deps.store.setState(matchedRev.id, 'revealed');

    return { matched: true, counterpart: { ...matchedRev, state: 'revealed' } };
  });
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

  const availability = candidate.availability;
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

  await deps.store.put(probe);
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

    const message = await deps.humanize.renderProbe(probe, candidate);
    await deps.messenger.send(handle, { text: message, kind: 'prompt' });
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

export interface RecordBroadcastResponseDeps {
  store: BroadcastStore;
  events: EventLog;
}

export async function recordBroadcastResponse(
  deps: RecordBroadcastResponseDeps,
  probeId: string,
  candidateId: string,
  response: 'yes' | 'no'
): Promise<BroadcastProbe> {
  await deps.store.recordResponse(probeId, candidateId, response);
  deps.events.emit({
    type: 'response',
    at: new Date(),
    probeId,
    from: candidateId,
    response,
  });
  const updated = await deps.store.get(probeId);
  if (!updated) throw new Error(`probe not found: ${probeId}`);
  return updated;
}

export interface FinalizeBroadcastDeps {
  graph: IdentityGraph;
  store: BroadcastStore;
  events: EventLog;
  humanize: Humanizer;
}

export interface FinalizeResult {
  yesResponders: string[];
  threadOpened: boolean;
  message: string;
}

export async function finalizeBroadcast(
  deps: FinalizeBroadcastDeps,
  probeId: string,
  threadContext?: string
): Promise<FinalizeResult> {
  const probe = await deps.store.get(probeId);
  if (!probe) throw new Error(`probe not found: ${probeId}`);
  const yesResponderIds = Object.entries(probe.responses)
    .filter(([, r]) => r === 'yes')
    .map(([id]) => id);

  const yesResponders: Person[] = [];
  for (const id of yesResponderIds) {
    const p = await deps.graph.getPerson(id);
    if (p) yesResponders.push(p);
  }

  const message = await deps.humanize.renderBubbleUp(probe, yesResponders);

  deps.events.emit({
    type: 'bubble-up',
    at: new Date(),
    probeId,
    yesResponders: yesResponderIds,
    message,
  });

  if (yesResponderIds.length > 0) {
    deps.events.emit({
      type: 'thread-opened',
      at: new Date(),
      participants: [probe.ownerPersonId, ...yesResponderIds],
      context: threadContext ?? probe.payload,
    });
    return { yesResponders: yesResponderIds, threadOpened: true, message };
  }

  return { yesResponders: yesResponderIds, threadOpened: false, message };
}
