import { describe, expect, it } from 'vitest';
import { createBroadcastStore, createIntentStore } from './store.js';
import type { BroadcastProbe, SealedIntent } from './types.js';

function mkIntent(partial: Partial<SealedIntent> = {}): SealedIntent {
  return {
    id: 'i1',
    ownerPersonId: 'yuri',
    targetPersonId: 'alex',
    kind: 'collaborate',
    payload: 'x',
    urgency: 'med',
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 1000),
    state: 'sealed',
    ...partial,
  };
}

function mkProbe(partial: Partial<BroadcastProbe> = {}): BroadcastProbe {
  return {
    id: 'p1',
    ownerPersonId: 'yuri',
    candidatePersonIds: ['a', 'b'],
    payload: 'jazz',
    constraints: { when: 'tonight' },
    createdAt: new Date(),
    responses: { a: 'silent', b: 'silent' },
    ...partial,
  };
}

describe('IntentStore', () => {
  it('saves and retrieves by id', () => {
    const store = createIntentStore();
    const intent = mkIntent();
    store.save(intent);
    expect(store.get('i1')).toMatchObject({ id: 'i1', ownerPersonId: 'yuri' });
  });

  it('findReverse finds the reverse sealed intent with matching kind', () => {
    const store = createIntentStore();
    const a = mkIntent({ id: 'a', ownerPersonId: 'yuri', targetPersonId: 'alex' });
    const b = mkIntent({ id: 'b', ownerPersonId: 'alex', targetPersonId: 'yuri' });
    store.save(a);
    store.save(b);
    const reverse = store.findReverse({
      ownerId: 'yuri',
      targetId: 'alex',
      kind: 'collaborate',
    });
    expect(reverse?.id).toBe('b');
  });

  it('findReverse ignores non-sealed states', () => {
    const store = createIntentStore();
    store.save(mkIntent({ id: 'a', ownerPersonId: 'yuri', targetPersonId: 'alex' }));
    store.save(
      mkIntent({
        id: 'b',
        ownerPersonId: 'alex',
        targetPersonId: 'yuri',
        state: 'matched',
      })
    );
    expect(
      store.findReverse({ ownerId: 'yuri', targetId: 'alex', kind: 'collaborate' })
    ).toBeNull();
  });

  it('update merges patches and returns new copy', () => {
    const store = createIntentStore();
    store.save(mkIntent());
    const updated = store.update('i1', { state: 'revealed' });
    expect(updated.state).toBe('revealed');
    expect(store.get('i1')?.state).toBe('revealed');
  });

  it('listAll returns copies', () => {
    const store = createIntentStore();
    store.save(mkIntent());
    const list = store.listAll();
    const first = list[0];
    if (!first) throw new Error('empty list');
    first.state = 'expired';
    expect(store.get('i1')?.state).toBe('sealed');
  });
});

describe('BroadcastStore', () => {
  it('saves and retrieves', () => {
    const store = createBroadcastStore();
    store.save(mkProbe());
    expect(store.get('p1')?.id).toBe('p1');
  });

  it('recordResponse updates only the target person', () => {
    const store = createBroadcastStore();
    store.save(mkProbe());
    const updated = store.recordResponse('p1', 'a', 'yes');
    expect(updated.responses).toEqual({ a: 'yes', b: 'silent' });
    expect(store.get('p1')?.responses.a).toBe('yes');
  });

  it('throws for unknown probe', () => {
    const store = createBroadcastStore();
    expect(() => store.recordResponse('nope', 'a', 'yes')).toThrow('probe not found');
  });
});
