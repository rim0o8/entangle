import { nanoid } from 'nanoid';
import type { Person } from '../engram/types.ts';
import type {
  BroadcastConstraints,
  BroadcastProbe,
  IntentKind,
  ProtocolDeps,
  SealedIntent,
  Urgency,
} from './types.ts';

// core/protocol.ts — four functions. This file is the protocol spec.
// Every call goes through injected \`deps\`; nothing calls \`new Date()\`
// or the network directly.

const DEFAULT_URGENCY: Urgency = 'low';
const INTENT_TTL_DAYS = 30;

export interface SealInput {
  from: Person;
  to: Person;
  kind: IntentKind;
  payload: string;
  urgency?: Urgency;
}

export async function sealedIntent(
  d: ProtocolDeps,
  input: SealInput,
): Promise<SealedIntent> {
  const now = d.now();
  const intent: SealedIntent = {
    id: nanoid(),
    ownerPersonId: input.from.id,
    targetPersonId: input.to.id,
    kind: input.kind,
    payload: input.payload,
    urgency: input.urgency ?? DEFAULT_URGENCY,
    createdAt: now,
    expiresAt: addDays(now, INTENT_TTL_DAYS),
    state: 'sealed',
  };
  await d.intents.put(intent);
  return intent;
}

export interface DetectResult {
  matched: boolean;
  counterpart?: SealedIntent;
}

export async function detectMutual(
  d: ProtocolDeps,
  intent: SealedIntent,
): Promise<DetectResult> {
  const counterpart = await d.intents.findReverse(intent);
  if (!counterpart) return { matched: false };

  const claimed = await d.intents.tryMatch(intent.id, counterpart.id);
  if (!claimed) return { matched: false };

  const [owner, target] = await Promise.all([
    d.graph.getPerson(intent.ownerPersonId),
    d.graph.getPerson(intent.targetPersonId),
  ]);
  if (!owner || !target) throw new Error('detectMutual: person missing after match');

  const [textForOwner, textForTarget] = await Promise.all([
    d.humanize.renderReveal(intent, counterpart),
    d.humanize.renderReveal(counterpart, intent),
  ]);

  const ownerHandle = owner.handles[0];
  const targetHandle = target.handles[0];
  if (!ownerHandle || !targetHandle) {
    throw new Error('detectMutual: person missing handles');
  }

  await Promise.all([
    d.messenger.send(ownerHandle, { text: textForOwner, kind: 'notice' }),
    d.messenger.send(targetHandle, { text: textForTarget, kind: 'notice' }),
  ]);

  return { matched: true, counterpart };
}

export type FilterVerdict = 'suppress' | 'deliver';

export async function filterCandidate(
  d: ProtocolDeps,
  ownerId: string,
  candidateId: string,
): Promise<FilterVerdict> {
  const candidate = await d.graph.getPerson(candidateId);
  if (!candidate) return 'suppress';
  if (candidate.availability !== 'free') return 'suppress';
  const rel = await d.graph.getRelationship(ownerId, candidateId);
  if (!rel) return 'suppress';
  return 'deliver';
}

export interface QuietBroadcastInput {
  owner: Person;
  candidates: Person[];
  payload: string;
  constraints: BroadcastConstraints;
}

export async function quietBroadcast(
  d: ProtocolDeps,
  input: QuietBroadcastInput,
): Promise<BroadcastProbe> {
  const probe: BroadcastProbe = {
    id: nanoid(),
    ownerPersonId: input.owner.id,
    candidatePersonIds: input.candidates.map((c) => c.id),
    payload: input.payload,
    constraints: input.constraints,
    createdAt: d.now(),
  };
  await d.probes.put(probe);

  await Promise.all(
    input.candidates.map(async (c) => {
      const verdict = await filterCandidate(d, input.owner.id, c.id);
      if (verdict === 'suppress') {
        await d.probes.recordResponse(probe.id, c.id, 'silent');
        return;
      }
      const text = await d.humanize.renderProbe(probe, c);
      const handle = c.handles[0];
      if (!handle) {
        await d.probes.recordResponse(probe.id, c.id, 'silent');
        return;
      }
      await d.messenger.send(handle, { text, kind: 'prompt' });
    }),
  );

  return probe;
}

function addDays(from: Date, days: number): Date {
  const ms = from.getTime() + days * 24 * 60 * 60 * 1000;
  return new Date(ms);
}
