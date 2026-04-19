import type { BroadcastProbe, IntentKind, SealedIntent } from './types.js';

export interface IntentStore {
  save(intent: SealedIntent): void;
  get(id: string): SealedIntent | null;
  findReverse(q: {
    ownerId: string;
    targetId: string;
    kind: IntentKind;
  }): SealedIntent | null;
  update(id: string, patch: Partial<SealedIntent>): SealedIntent;
  listAll(): SealedIntent[];
}

export function createIntentStore(): IntentStore {
  const byId = new Map<string, SealedIntent>();

  const save = (intent: SealedIntent): void => {
    byId.set(intent.id, { ...intent });
  };

  const get = (id: string): SealedIntent | null => {
    const v = byId.get(id);
    return v ? { ...v } : null;
  };

  const findReverse = (q: {
    ownerId: string;
    targetId: string;
    kind: IntentKind;
  }): SealedIntent | null => {
    for (const v of byId.values()) {
      if (
        v.ownerPersonId === q.targetId &&
        v.targetPersonId === q.ownerId &&
        v.kind === q.kind &&
        v.state === 'sealed'
      ) {
        return { ...v };
      }
    }
    return null;
  };

  const update = (id: string, patch: Partial<SealedIntent>): SealedIntent => {
    const prev = byId.get(id);
    if (!prev) throw new Error(`intent not found: ${id}`);
    const next: SealedIntent = { ...prev, ...patch };
    byId.set(id, next);
    return { ...next };
  };

  const listAll = (): SealedIntent[] => Array.from(byId.values()).map((v) => ({ ...v }));

  return { save, get, findReverse, update, listAll };
}

export interface BroadcastStore {
  save(probe: BroadcastProbe): void;
  get(id: string): BroadcastProbe | null;
  recordResponse(probeId: string, personId: string, response: 'yes' | 'no'): BroadcastProbe;
  listAll(): BroadcastProbe[];
}

export function createBroadcastStore(): BroadcastStore {
  const byId = new Map<string, BroadcastProbe>();

  const save = (probe: BroadcastProbe): void => {
    byId.set(probe.id, { ...probe, responses: { ...probe.responses } });
  };

  const get = (id: string): BroadcastProbe | null => {
    const v = byId.get(id);
    return v ? { ...v, responses: { ...v.responses } } : null;
  };

  const recordResponse = (
    probeId: string,
    personId: string,
    response: 'yes' | 'no'
  ): BroadcastProbe => {
    const prev = byId.get(probeId);
    if (!prev) throw new Error(`probe not found: ${probeId}`);
    const next: BroadcastProbe = {
      ...prev,
      responses: { ...prev.responses, [personId]: response },
    };
    byId.set(probeId, next);
    return { ...next, responses: { ...next.responses } };
  };

  const listAll = (): BroadcastProbe[] =>
    Array.from(byId.values()).map((v) => ({ ...v, responses: { ...v.responses } }));

  return { save, get, recordResponse, listAll };
}
