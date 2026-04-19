import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBroadcastStore, createIntentStore } from './stores.js';
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

describe('createIntentStore (SQLite)', () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'entangle-intentstore-'));
    dbPath = join(tempDir, 'intents.sqlite');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('put and get round-trip', async () => {
    const store = createIntentStore({ dbPath });
    const intent = mkIntent();
    await store.put(intent);
    const got = await store.get('i1');
    expect(got).not.toBeNull();
    expect(got?.id).toBe('i1');
    expect(got?.ownerPersonId).toBe('yuri');
    expect(got?.state).toBe('sealed');
    expect(got?.createdAt).toBeInstanceOf(Date);
  });

  it('findReverse finds reverse sealed intent', async () => {
    const store = createIntentStore({ dbPath });
    const a = mkIntent({ id: 'a', ownerPersonId: 'yuri', targetPersonId: 'alex' });
    const b = mkIntent({ id: 'b', ownerPersonId: 'alex', targetPersonId: 'yuri' });
    await store.put(a);
    await store.put(b);
    const reverse = await store.findReverse(a);
    expect(reverse?.id).toBe('b');
  });

  it('findReverse ignores non-sealed (matched, revealed, expired) states', async () => {
    const store = createIntentStore({ dbPath });
    const a = mkIntent({ id: 'a', ownerPersonId: 'yuri', targetPersonId: 'alex' });
    await store.put(a);
    await store.put(
      mkIntent({
        id: 'b-matched',
        ownerPersonId: 'alex',
        targetPersonId: 'yuri',
        state: 'matched',
      })
    );
    await store.put(
      mkIntent({
        id: 'b-revealed',
        ownerPersonId: 'alex',
        targetPersonId: 'yuri',
        state: 'revealed',
      })
    );
    await store.put(
      mkIntent({
        id: 'b-expired',
        ownerPersonId: 'alex',
        targetPersonId: 'yuri',
        state: 'expired',
      })
    );
    expect(await store.findReverse(a)).toBeNull();
  });

  it('setState updates atomically', async () => {
    const store = createIntentStore({ dbPath });
    await store.put(mkIntent());
    await store.setState('i1', 'revealed');
    const got = await store.get('i1');
    expect(got?.state).toBe('revealed');
  });

  it('setState throws for unknown id', async () => {
    const store = createIntentStore({ dbPath });
    await expect(store.setState('nope', 'matched')).rejects.toThrow('intent not found');
  });

  it('multi-handle: two handles on same dbPath see each other (IPC foundation)', async () => {
    const writer = createIntentStore({ dbPath });
    const reader = createIntentStore({ dbPath });
    const intent = mkIntent({ id: 'shared' });
    await writer.put(intent);
    const seen = await reader.get('shared');
    expect(seen?.id).toBe('shared');
    // setState from one visible to the other
    await writer.setState('shared', 'matched');
    const afterSet = await reader.get('shared');
    expect(afterSet?.state).toBe('matched');
  });
});

describe('createBroadcastStore (SQLite)', () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'entangle-broadcaststore-'));
    dbPath = join(tempDir, 'broadcasts.sqlite');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('put and get round-trip', async () => {
    const store = createBroadcastStore({ dbPath });
    await store.put(mkProbe());
    const got = await store.get('p1');
    expect(got?.id).toBe('p1');
    expect(got?.candidatePersonIds).toEqual(['a', 'b']);
    expect(got?.responses).toEqual({ a: 'silent', b: 'silent' });
  });

  it('recordResponse persists and keeps other candidates silent', async () => {
    const store = createBroadcastStore({ dbPath });
    await store.put(mkProbe());
    await store.recordResponse('p1', 'a', 'yes');
    const got = await store.get('p1');
    expect(got?.responses).toEqual({ a: 'yes', b: 'silent' });
  });

  it('recordResponse throws for unknown probe', async () => {
    const store = createBroadcastStore({ dbPath });
    await expect(store.recordResponse('nope', 'a', 'yes')).rejects.toThrow('probe not found');
  });

  it('multi-handle visibility across two opened stores', async () => {
    const writer = createBroadcastStore({ dbPath });
    const reader = createBroadcastStore({ dbPath });
    await writer.put(mkProbe({ id: 'pShared' }));
    await writer.recordResponse('pShared', 'a', 'yes');
    const got = await reader.get('pShared');
    expect(got?.responses.a).toBe('yes');
  });
});
