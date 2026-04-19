import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EngramLite } from '../engram/lite.js';
import { loadSeed } from '../engram/seed.js';
import type { Person } from '../engram/types.js';
import { createInProcessChannel } from '../spectrum/inprocess.js';
import { createEventLog } from './events.js';
import { createStubHumanizer } from './humanize.js';
import { detectMutual, filterCandidate, quietBroadcast, sealedIntent } from './protocol.js';
import { createBroadcastStore, createIntentStore } from './store.js';
import type { BroadcastProbe, EntangleEvent } from './types.js';

const SEED_PATH = join(__dirname, '..', 'engram', 'seed.json');

interface TestEnv {
  engram: EngramLite;
  tempDir: string;
  dbPath: string;
  yuri: Person;
  alex: Person;
  channel: ReturnType<typeof createInProcessChannel>;
  intentStore: ReturnType<typeof createIntentStore>;
  broadcastStore: ReturnType<typeof createBroadcastStore>;
  events: ReturnType<typeof createEventLog>;
  humanize: ReturnType<typeof createStubHumanizer>;
  captured: EntangleEvent[];
}

async function makeEnv(): Promise<TestEnv> {
  const tempDir = mkdtempSync(join(tmpdir(), 'entangle-test-'));
  const dbPath = join(tempDir, 'test.sqlite');
  const engram = new EngramLite(dbPath);
  loadSeed(engram, SEED_PATH);
  const yuri = await engram.getPerson('yuri');
  const alex = await engram.getPerson('alex');
  if (!yuri || !alex) throw new Error('seed bad');
  const channel = createInProcessChannel();
  const intentStore = createIntentStore();
  const broadcastStore = createBroadcastStore();
  const events = createEventLog();
  const captured: EntangleEvent[] = [];
  events.subscribe((e) => captured.push(e));
  const humanize = createStubHumanizer((prompt) => {
    const lines = prompt.split('\n').filter((l) => l.trim().length > 0);
    return lines[lines.length - 1] ?? 'ok';
  });
  return {
    engram,
    tempDir,
    dbPath,
    yuri,
    alex,
    channel,
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
        channel: env.channel,
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
    expect(env.intentStore.get(intent.id)?.state).toBe('sealed');
    expect(env.captured.filter((e) => e.type === 'sealed').length).toBe(1);
    expect(env.channel.sent.length).toBe(0);
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
        channel: env.channel,
        store: env.intentStore,
        events: env.events,
      },
      { from: env.yuri, to: env.alex, payload: 'p', kind: 'collaborate' }
    );
    const result = await detectMutual(
      {
        graph: env.engram,
        channel: env.channel,
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
      channel: env.channel,
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
    expect(env.channel.sent.length).toBe(2);
    const all = env.intentStore.listAll();
    for (const i of all) {
      expect(i.state).toBe('revealed');
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

  it('suppresses busy', async () => {
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
    // Exclude alex (not part of the 20-candidate broadcast set; but seed has 21 rels).
    const candidates = friends.filter((f) => f.id !== 'alex');
    expect(candidates.length).toBe(20);

    await quietBroadcast(
      {
        graph: env.engram,
        channel: env.channel,
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
    expect(env.channel.sent.length).toBe(3);
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
      channel: env.channel,
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

    const all = env.intentStore.listAll();
    for (const i of all) {
      expect(i.state).toBe('revealed');
    }
    // Only one reveal pair (2 reveal events, 1 mutual-detected).
    expect(env.captured.filter((e) => e.type === 'mutual-detected').length).toBe(1);
    expect(env.captured.filter((e) => e.type === 'reveal').length).toBe(2);
  });
});
