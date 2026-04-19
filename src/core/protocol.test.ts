import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EngramLite } from '../engram/lite.js';
import { loadSeed } from '../engram/seed.js';
import type { Person } from '../engram/types.js';
import { createTestMessenger } from '../messaging/test.js';
import { createEventLog } from './events.js';
import { createStubHumanizer } from './humanize.js';
import {
  detectMutual,
  filterCandidate,
  finalizeBroadcast,
  quietBroadcast,
  recordBroadcastResponse,
  sealedIntent,
} from './protocol.js';
import { createBroadcastStore, createIntentStore } from './stores.js';
import type { BroadcastProbe, EntangleEvent } from './types.js';

const SEED_PATH = join(__dirname, '..', 'engram', 'seed.json');

interface TestEnv {
  engram: EngramLite;
  tempDir: string;
  yuri: Person;
  alex: Person;
  messenger: ReturnType<typeof createTestMessenger>;
  intentStore: ReturnType<typeof createIntentStore>;
  broadcastStore: ReturnType<typeof createBroadcastStore>;
  events: ReturnType<typeof createEventLog>;
  humanize: ReturnType<typeof createStubHumanizer>;
  captured: EntangleEvent[];
}

async function makeEnv(): Promise<TestEnv> {
  const tempDir = mkdtempSync(join(tmpdir(), 'entangle-test-'));
  const engram = new EngramLite(join(tempDir, 'engram.sqlite'));
  loadSeed(engram, { path: SEED_PATH, profile: 'test' });
  const yuri = await engram.getPerson('yuri');
  const alex = await engram.getPerson('alex');
  if (!yuri || !alex) throw new Error('seed bad');
  const messenger = createTestMessenger();
  const intentStore = createIntentStore({ dbPath: join(tempDir, 'intents.sqlite') });
  const broadcastStore = createBroadcastStore({ dbPath: join(tempDir, 'broadcasts.sqlite') });
  const events = createEventLog();
  const captured: EntangleEvent[] = [];
  events.subscribe((e) => captured.push(e));
  const humanize = createStubHumanizer();
  return {
    engram,
    tempDir,
    yuri,
    alex,
    messenger,
    intentStore,
    broadcastStore,
    events,
    humanize,
    captured,
  };
}

function cleanup(env: TestEnv): void {
  env.engram.close();
  rmSync(env.tempDir, { recursive: true, force: true });
}

describe('sealedIntent', () => {
  let env: TestEnv;
  beforeEach(async () => {
    env = await makeEnv();
  });
  afterEach(() => cleanup(env));

  it('stores intent and emits sealed event; does not send', async () => {
    const intent = await sealedIntent(
      {
        graph: env.engram,
        messenger: env.messenger,
        store: env.intentStore,
        events: env.events,
      },
      {
        from: env.yuri,
        to: env.alex,
        payload: "I'd want to work with Alex.",
        kind: 'collaborate',
      }
    );

    expect(intent.state).toBe('sealed');
    const stored = await env.intentStore.get(intent.id);
    expect(stored?.state).toBe('sealed');
    expect(env.captured.filter((e) => e.type === 'sealed').length).toBe(1);
    expect(env.messenger.sent.length).toBe(0);
  });
});

describe('detectMutual', () => {
  let env: TestEnv;
  beforeEach(async () => {
    env = await makeEnv();
  });
  afterEach(() => cleanup(env));

  it('returns matched:false when no reverse intent', async () => {
    const i1 = await sealedIntent(
      {
        graph: env.engram,
        messenger: env.messenger,
        store: env.intentStore,
        events: env.events,
      },
      { from: env.yuri, to: env.alex, payload: 'p', kind: 'collaborate' }
    );
    const result = await detectMutual(
      {
        graph: env.engram,
        messenger: env.messenger,
        store: env.intentStore,
        events: env.events,
        humanize: env.humanize,
      },
      i1
    );
    expect(result.matched).toBe(false);
  });

  it('returns matched:true; emits mutual-detected + two reveal events; sends to both parties', async () => {
    const deps = {
      graph: env.engram,
      messenger: env.messenger,
      store: env.intentStore,
      events: env.events,
      humanize: env.humanize,
    };
    await sealedIntent(deps, {
      from: env.yuri,
      to: env.alex,
      payload: 'p1',
      kind: 'collaborate',
    });
    const i2 = await sealedIntent(deps, {
      from: env.alex,
      to: env.yuri,
      payload: 'p2',
      kind: 'collaborate',
    });

    const result = await detectMutual(deps, i2);

    expect(result.matched).toBe(true);
    expect(env.captured.filter((e) => e.type === 'mutual-detected').length).toBe(1);
    const reveals = env.captured.filter((e) => e.type === 'reveal');
    expect(reveals.length).toBe(2);
    expect(env.messenger.sent.length).toBe(2);

    // After reveal, both intents should be in 'revealed' state.
    const yuriIntent = await env.intentStore.get(i2.id);
    expect(yuriIntent?.state).toBe('revealed');
  });

  it('reveals use stub humanizer canned format', async () => {
    const deps = {
      graph: env.engram,
      messenger: env.messenger,
      store: env.intentStore,
      events: env.events,
      humanize: env.humanize,
    };
    await sealedIntent(deps, {
      from: env.yuri,
      to: env.alex,
      payload: 'p1',
      kind: 'collaborate',
    });
    const i2 = await sealedIntent(deps, {
      from: env.alex,
      to: env.yuri,
      payload: 'p2',
      kind: 'collaborate',
    });
    await detectMutual(deps, i2);

    const reveals = env.captured.filter(
      (e): e is Extract<EntangleEvent, { type: 'reveal' }> => e.type === 'reveal'
    );
    expect(reveals.length).toBe(2);
    for (const r of reveals) {
      expect(r.message).toMatch(/^\[reveal: /);
    }
  });
});

describe('filterCandidate', () => {
  let env: TestEnv;
  beforeEach(async () => {
    env = await makeEnv();
  });
  afterEach(() => cleanup(env));

  const dummyProbe: BroadcastProbe = {
    id: 'p',
    ownerPersonId: 'yuri',
    candidatePersonIds: [],
    payload: 'jazz',
    constraints: { when: 'tonight' },
    createdAt: new Date(),
    responses: {},
  };

  it('suppresses busy (reads top-level availability)', async () => {
    const r = await filterCandidate({ graph: env.engram }, 'yuri', 'busy1', dummyProbe);
    expect(r).toEqual({ verdict: 'suppress', reason: 'busy' });
  });

  it('suppresses traveling', async () => {
    const r = await filterCandidate({ graph: env.engram }, 'yuri', 'travel1', dummyProbe);
    expect(r).toEqual({ verdict: 'suppress', reason: 'traveling' });
  });

  it('suppresses declined-recently', async () => {
    const r = await filterCandidate({ graph: env.engram }, 'yuri', 'decline1', dummyProbe);
    expect(r).toEqual({ verdict: 'suppress', reason: 'declined-recently' });
  });

  it('delivers free', async () => {
    const r = await filterCandidate({ graph: env.engram }, 'yuri', 'mika', dummyProbe);
    expect(r).toEqual({ verdict: 'deliver' });
  });
});

describe('quietBroadcast', () => {
  let env: TestEnv;
  beforeEach(async () => {
    env = await makeEnv();
  });
  afterEach(() => cleanup(env));

  it('emits 17 suppressed + 3 probed for 20 candidates; sends 3 times', async () => {
    const friends = await env.engram.listFriends('yuri');
    const candidates = friends.filter((f) => f.id !== 'alex');
    expect(candidates.length).toBe(20);

    await quietBroadcast(
      {
        graph: env.engram,
        messenger: env.messenger,
        store: env.broadcastStore,
        events: env.events,
        humanize: env.humanize,
      },
      {
        owner: env.yuri,
        candidates,
        payload: 'Jazz tonight, anyone?',
        constraints: { when: 'tonight', where: 'tokyo' },
      }
    );

    const suppressed = env.captured.filter((e) => e.type === 'suppressed');
    const probed = env.captured.filter((e) => e.type === 'probed');
    expect(suppressed.length).toBe(17);
    expect(probed.length).toBe(3);
    expect(env.messenger.sent.length).toBe(3);
  });
});

describe('finalizeBroadcast', () => {
  let env: TestEnv;
  beforeEach(async () => {
    env = await makeEnv();
  });
  afterEach(() => cleanup(env));

  it('renders bubble-up message via humanizer and emits it with yesResponders', async () => {
    const friends = await env.engram.listFriends('yuri');
    const candidates = friends.filter((f) => f.id !== 'alex');

    const probe = await quietBroadcast(
      {
        graph: env.engram,
        messenger: env.messenger,
        store: env.broadcastStore,
        events: env.events,
        humanize: env.humanize,
      },
      {
        owner: env.yuri,
        candidates,
        payload: 'Jazz tonight, anyone?',
        constraints: { when: 'tonight', where: 'tokyo' },
      }
    );

    await recordBroadcastResponse(
      { store: env.broadcastStore, events: env.events },
      probe.id,
      'mika',
      'yes'
    );
    await recordBroadcastResponse(
      { store: env.broadcastStore, events: env.events },
      probe.id,
      'taro',
      'yes'
    );
    await recordBroadcastResponse(
      { store: env.broadcastStore, events: env.events },
      probe.id,
      'ken',
      'no'
    );

    const result = await finalizeBroadcast(
      {
        graph: env.engram,
        store: env.broadcastStore,
        events: env.events,
        humanize: env.humanize,
      },
      probe.id,
      'Jazz tonight'
    );

    expect(result.threadOpened).toBe(true);
    expect(result.yesResponders.sort()).toEqual(['mika', 'taro']);
    expect(result.message).toMatch(/^\[bubble-up: /);

    const bubbleUps = env.captured.filter(
      (e): e is Extract<EntangleEvent, { type: 'bubble-up' }> => e.type === 'bubble-up'
    );
    expect(bubbleUps.length).toBe(1);
    expect(bubbleUps[0]?.yesResponders.sort()).toEqual(['mika', 'taro']);
    expect(bubbleUps[0]?.message).toMatch(/^\[bubble-up: /);
  });
});

describe('detectMutual race safety', () => {
  let env: TestEnv;
  beforeEach(async () => {
    env = await makeEnv();
  });
  afterEach(() => cleanup(env));

  it('exactly one of two concurrent detectMutual calls returns matched:true', async () => {
    const deps = {
      graph: env.engram,
      messenger: env.messenger,
      store: env.intentStore,
      events: env.events,
      humanize: env.humanize,
    };
    const iA = await sealedIntent(deps, {
      from: env.yuri,
      to: env.alex,
      payload: 'a',
      kind: 'collaborate',
    });
    const iB = await sealedIntent(deps, {
      from: env.alex,
      to: env.yuri,
      payload: 'b',
      kind: 'collaborate',
    });

    const [rA, rB] = await Promise.all([detectMutual(deps, iA), detectMutual(deps, iB)]);

    const matchedCount = [rA.matched, rB.matched].filter(Boolean).length;
    expect(matchedCount).toBe(1);

    // Only one reveal pair (2 reveal events, 1 mutual-detected).
    expect(env.captured.filter((e) => e.type === 'mutual-detected').length).toBe(1);
    expect(env.captured.filter((e) => e.type === 'reveal').length).toBe(2);
  });
});

describe('no real network calls during tests', () => {
  it('createStubHumanizer never invokes Anthropic', async () => {
    // Intercept any global fetch attempts; Anthropic SDK uses fetch internally.
    // If HUMANIZE_STUB=1 is set (setupFiles does this), createHumanizerFromEnv
    // returns the stub; the stub must never call fetch.
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      fetchCalls += 1;
      return originalFetch(...args);
    }) as typeof fetch;

    try {
      const stub = createStubHumanizer();
      await stub.renderReveal(
        {
          id: 'a',
          ownerPersonId: 'yuri',
          targetPersonId: 'alex',
          kind: 'collaborate',
          payload: 'x',
          urgency: 'med',
          createdAt: new Date(),
          expiresAt: new Date(),
          state: 'matched',
        },
        {
          id: 'b',
          ownerPersonId: 'alex',
          targetPersonId: 'yuri',
          kind: 'collaborate',
          payload: 'y',
          urgency: 'med',
          createdAt: new Date(),
          expiresAt: new Date(),
          state: 'matched',
        }
      );
      expect(fetchCalls).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
