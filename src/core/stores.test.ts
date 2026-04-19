import { test, expect, describe } from 'bun:test';
import { Database } from 'bun:sqlite';
import { BroadcastStoreSqlite, IntentStoreSqlite } from './stores.ts';
import type { SealedIntent, BroadcastProbe } from './types.ts';

function mkIntent(overrides: Partial<SealedIntent> = {}): SealedIntent {
  const now = new Date('2026-04-19T14:00:00Z');
  return {
    id: 'i1',
    ownerPersonId: 'a',
    targetPersonId: 'b',
    kind: 'collaborate',
    payload: 'p',
    urgency: 'low',
    createdAt: now,
    expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    state: 'sealed',
    ...overrides,
  };
}

describe('IntentStoreSqlite', () => {
  test('put + get round-trip preserves fields', async () => {
    const store = new IntentStoreSqlite(new Database(':memory:'));
    const intent = mkIntent();
    await store.put(intent);
    const loaded = await store.get(intent.id);
    expect(loaded?.ownerPersonId).toBe('a');
    expect(loaded?.state).toBe('sealed');
    expect(loaded?.expiresAt.getTime()).toBe(intent.expiresAt.getTime());
  });

  test('findReverse returns the counterpart sealed intent', async () => {
    const store = new IntentStoreSqlite(new Database(':memory:'));
    const yuriIntent = mkIntent({ id: 'y', ownerPersonId: 'yuri', targetPersonId: 'alex' });
    const alexIntent = mkIntent({ id: 'x', ownerPersonId: 'alex', targetPersonId: 'yuri' });
    await store.put(yuriIntent);
    await store.put(alexIntent);
    const rev = await store.findReverse(yuriIntent);
    expect(rev?.id).toBe('x');
  });

  test('findReverse ignores already-matched intents', async () => {
    const store = new IntentStoreSqlite(new Database(':memory:'));
    const yuriIntent = mkIntent({ id: 'y', ownerPersonId: 'yuri', targetPersonId: 'alex' });
    const alexIntent = mkIntent({
      id: 'x',
      ownerPersonId: 'alex',
      targetPersonId: 'yuri',
      state: 'matched',
    });
    await store.put(yuriIntent);
    await store.put(alexIntent);
    const rev = await store.findReverse(yuriIntent);
    expect(rev).toBeNull();
  });

  test('tryMatch succeeds once for two sealed intents', async () => {
    const store = new IntentStoreSqlite(new Database(':memory:'));
    await store.put(mkIntent({ id: 'i1' }));
    await store.put(mkIntent({ id: 'i2', ownerPersonId: 'b', targetPersonId: 'a' }));
    const first = await store.tryMatch('i1', 'i2');
    const second = await store.tryMatch('i1', 'i2');
    expect(first).toBe(true);
    expect(second).toBe(false);
    const reloaded = await store.get('i1');
    expect(reloaded?.state).toBe('matched');
  });
});

describe('BroadcastStoreSqlite', () => {
  const mkProbe = (id = 'p1'): BroadcastProbe => ({
    id,
    ownerPersonId: 'yuri',
    candidatePersonIds: ['a', 'b', 'c'],
    payload: 'run?',
    constraints: { when: 'Sun 10am', where: 'Yoyogi' },
    createdAt: new Date(),
  });

  test('put + get round-trip', async () => {
    const store = new BroadcastStoreSqlite(new Database(':memory:'));
    const probe = mkProbe();
    await store.put(probe);
    const loaded = await store.get('p1');
    expect(loaded?.candidatePersonIds).toEqual(['a', 'b', 'c']);
    expect(loaded?.constraints.where).toBe('Yoyogi');
  });

  test('recordResponse + listYes', async () => {
    const store = new BroadcastStoreSqlite(new Database(':memory:'));
    await store.put(mkProbe());
    await store.recordResponse('p1', 'a', 'yes');
    await store.recordResponse('p1', 'b', 'no');
    await store.recordResponse('p1', 'c', 'silent');
    const yes = await store.listYes('p1');
    expect(yes).toEqual(['a']);
  });

  test('recordResponse is idempotent per (probe, person)', async () => {
    const store = new BroadcastStoreSqlite(new Database(':memory:'));
    await store.put(mkProbe());
    await store.recordResponse('p1', 'a', 'silent');
    await store.recordResponse('p1', 'a', 'yes');
    const yes = await store.listYes('p1');
    expect(yes).toEqual(['a']);
  });
});
