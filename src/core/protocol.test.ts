import { test, expect, describe, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nanoid } from 'nanoid';

import { EngramLite } from '../engram/lite.ts';
import type { Person, Relationship } from '../engram/types.ts';
import { MemoryMessenger } from '../messaging/memory.ts';
import { stubHumanizer } from './humanize.ts';
import {
  detectMutual,
  filterCandidate,
  quietBroadcast,
  sealedIntent,
} from './protocol.ts';
import { BroadcastStoreSqlite, IntentStoreSqlite } from './stores.ts';
import type { ProtocolDeps } from './types.ts';

function buildDeps(opts?: { dbPath?: string; clock?: Date }) {
  const db = opts?.dbPath ? new Database(opts.dbPath) : new Database(':memory:');
  const graph = new EngramLite(db);
  const intents = new IntentStoreSqlite(db);
  const probes = new BroadcastStoreSqlite(db);
  const messenger = new MemoryMessenger();
  const clock = opts?.clock ?? new Date('2026-04-19T14:00:00Z');
  const deps: ProtocolDeps = {
    graph,
    intents,
    probes,
    messenger,
    humanize: stubHumanizer(),
    now: () => clock,
  };
  return { db, deps, graph, intents, probes, messenger, clock };
}

const person = (id: string, opts: Partial<Person> = {}): Person => ({
  id,
  displayName: id,
  handles: [{ platform: 'imessage', handle: `+1-555-00-${id}` }],
  preferredPlatforms: ['imessage'],
  preferences: {},
  availability: 'free',
  ...opts,
});

function seedTwoPeople(graph: EngramLite, a: Person, b: Person) {
  graph.upsertPerson(a);
  graph.upsertPerson(b);
  const rel: Relationship = {
    fromId: a.id,
    toId: b.id,
    type: 'collaborator',
    lastContactAt: null,
    tags: [],
  };
  graph.upsertRelationship(rel);
  graph.upsertRelationship({ ...rel, fromId: b.id, toId: a.id });
}

describe('sealedIntent', () => {
  test('persists; does not send', async () => {
    const { deps, graph, messenger, intents } = buildDeps();
    const yuri = person('yuri');
    const alex = person('alex');
    seedTwoPeople(graph, yuri, alex);

    const intent = await sealedIntent(deps, {
      from: yuri,
      to: alex,
      kind: 'collaborate',
      payload: 'want to work with alex',
    });

    expect(intent.state).toBe('sealed');
    expect(intent.ownerPersonId).toBe('yuri');
    expect(intent.targetPersonId).toBe('alex');
    expect(messenger.sent.length).toBe(0);

    const reloaded = await intents.get(intent.id);
    expect(reloaded?.state).toBe('sealed');
  });
});

describe('detectMutual', () => {
  test('no counterpart: matched=false, zero sends', async () => {
    const { deps, graph, messenger } = buildDeps();
    const yuri = person('yuri');
    const alex = person('alex');
    seedTwoPeople(graph, yuri, alex);
    const intent = await sealedIntent(deps, {
      from: yuri,
      to: alex,
      kind: 'collaborate',
      payload: 'solo',
    });
    const out = await detectMutual(deps, intent);
    expect(out.matched).toBe(false);
    expect(messenger.sent.length).toBe(0);
  });

  test('counterpart present: matched=true, exactly two sends, one per party', async () => {
    const { deps, graph, messenger } = buildDeps();
    const yuri = person('yuri');
    const alex = person('alex');
    seedTwoPeople(graph, yuri, alex);

    const yuriIntent = await sealedIntent(deps, {
      from: yuri,
      to: alex,
      kind: 'collaborate',
      payload: 'want to work with alex',
    });
    const alexIntent = await sealedIntent(deps, {
      from: alex,
      to: yuri,
      kind: 'collaborate',
      payload: 'want to work with yuri',
    });

    const out = await detectMutual(deps, alexIntent);
    expect(out.matched).toBe(true);
    expect(out.counterpart?.id).toBe(yuriIntent.id);
    expect(messenger.sent.length).toBe(2);
    const handles = messenger.sent.map((s) => s.to.handle).sort();
    expect(handles).toEqual([yuri.handles[0]!.handle, alex.handles[0]!.handle].sort());
    // stub humanizer leaks the pair so we can verify wiring
    expect(messenger.sent.every((s) => s.message.text.startsWith('[reveal:'))).toBe(true);
  });

  test('race: two concurrent detectMutual calls on the same pair → exactly one winner', async () => {
    // File-backed SQLite so multiple connections can coexist.
    const dir = mkdtempSync(join(tmpdir(), 'entangle-race-'));
    const dbPath = join(dir, 'race.sqlite');

    // Both deps share the same file-backed DB but hold their own connections.
    const a = buildDeps({ dbPath });
    const b = buildDeps({ dbPath });

    // Seed persons into one connection; the schema was created in both
    // constructors, but the data is in the shared file so both see it.
    const yuri = person('yuri');
    const alex = person('alex');
    seedTwoPeople(a.graph, yuri, alex);

    // Seed two reciprocal intents via connection A.
    const yuriIntent = await sealedIntent(a.deps, {
      from: yuri,
      to: alex,
      kind: 'collaborate',
      payload: 'w',
    });
    const alexIntent = await sealedIntent(a.deps, {
      from: alex,
      to: yuri,
      kind: 'collaborate',
      payload: 'w',
    });

    // Both processes race to detect mutuality on the same pair, from
    // opposite perspectives.
    const [resA, resB] = await Promise.all([
      detectMutual(a.deps, alexIntent),
      detectMutual(b.deps, yuriIntent),
    ]);

    const winners = [resA, resB].filter((r) => r.matched).length;
    const losers = [resA, resB].filter((r) => !r.matched).length;
    expect(winners).toBe(1);
    expect(losers).toBe(1);

    // Exactly two sends total across both processes; zero from the loser.
    expect(a.messenger.sent.length + b.messenger.sent.length).toBe(2);

    a.db.close();
    b.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('filterCandidate', () => {
  const cases: {
    label: string;
    availability?: Person['availability'];
    hasRel: boolean;
    personExists: boolean;
    expected: 'suppress' | 'deliver';
  }[] = [
    { label: 'free + related', availability: 'free', hasRel: true, personExists: true, expected: 'deliver' },
    { label: 'busy + related', availability: 'busy', hasRel: true, personExists: true, expected: 'suppress' },
    { label: 'traveling + related', availability: 'traveling', hasRel: true, personExists: true, expected: 'suppress' },
    { label: 'declined-recently + related', availability: 'declined-recently', hasRel: true, personExists: true, expected: 'suppress' },
    { label: 'free + no relationship', availability: 'free', hasRel: false, personExists: true, expected: 'suppress' },
    { label: 'availability undefined', availability: undefined, hasRel: true, personExists: true, expected: 'suppress' },
    { label: 'unknown person', availability: 'free', hasRel: true, personExists: false, expected: 'suppress' },
  ];
  for (const c of cases) {
    test(`filterCandidate: ${c.label} → ${c.expected}`, async () => {
      const { deps, graph } = buildDeps();
      const owner = person('owner');
      graph.upsertPerson(owner);
      const candidateId = 'cand';
      if (c.personExists) {
        const cand = person(candidateId);
        if (c.availability === undefined) {
          delete (cand as Partial<Person>).availability;
        } else {
          cand.availability = c.availability;
        }
        graph.upsertPerson(cand);
      }
      if (c.hasRel && c.personExists) {
        graph.upsertRelationship({
          fromId: owner.id,
          toId: candidateId,
          type: 'colleague',
          lastContactAt: null,
          tags: [],
        });
      }
      const verdict = await filterCandidate(deps, owner.id, candidateId);
      expect(verdict).toBe(c.expected);
    });
  }
});

describe('quietBroadcast', () => {
  test('20 candidates (3 free, 17 suppressed): 3 sends, 17 silent responses', async () => {
    const { deps, graph, messenger, probes } = buildDeps();
    const owner = person('yuri');
    graph.upsertPerson(owner);

    const candidates: Person[] = [];
    // 3 free, related: delivered
    for (let i = 0; i < 3; i++) {
      const p = person(`free-${i}`, { availability: 'free' });
      candidates.push(p);
      graph.upsertPerson(p);
      graph.upsertRelationship({
        fromId: owner.id,
        toId: p.id,
        type: 'friend',
        lastContactAt: null,
        tags: [],
      });
    }
    // 17 suppressed: mix of reasons
    const suppressReasons: { availability?: Person['availability']; hasRel: boolean }[] = [
      ...Array.from({ length: 6 }, () => ({ availability: 'busy' as const, hasRel: true })),
      ...Array.from({ length: 5 }, () => ({ availability: 'traveling' as const, hasRel: true })),
      ...Array.from({ length: 4 }, () => ({ availability: 'declined-recently' as const, hasRel: true })),
      ...Array.from({ length: 2 }, () => ({ availability: 'free' as const, hasRel: false })),
    ];
    expect(suppressReasons.length).toBe(17);
    suppressReasons.forEach((r, i) => {
      const p = person(`sup-${i}`, { availability: r.availability });
      candidates.push(p);
      graph.upsertPerson(p);
      if (r.hasRel) {
        graph.upsertRelationship({
          fromId: owner.id,
          toId: p.id,
          type: 'colleague',
          lastContactAt: null,
          tags: [],
        });
      }
    });
    expect(candidates.length).toBe(20);

    const probe = await quietBroadcast(deps, {
      owner,
      candidates,
      payload: 'sunday run 10am',
      constraints: { when: 'Sunday 10am', where: 'Yoyogi' },
    });

    expect(messenger.sent.length).toBe(3);
    // Every send went to a free-N recipient
    for (const s of messenger.sent) {
      expect(s.to.handle.startsWith('+1-555-00-free-')).toBe(true);
    }
    // 17 silent responses recorded
    // (we read via a direct query since BroadcastStore's public API exposes listYes only)
    const row = (deps.probes as BroadcastStoreSqlite);
    const all = await Promise.all(
      candidates.map(async (c) => {
        const db = (row as unknown as { db: import('bun:sqlite').Database }).db;
        const r = db
          .prepare('SELECT response FROM probe_responses WHERE probe_id = ? AND person_id = ?')
          .get(probe.id, c.id) as { response: string } | null;
        return r?.response ?? null;
      }),
    );
    const silentCount = all.filter((r) => r === 'silent').length;
    expect(silentCount).toBe(17);
    expect(all.filter((r) => r === null).length).toBe(3); // free ones have no recorded response here
  });
});

describe('CI contract: humanize never hits the network under bun test', () => {
  test('HUMANIZE_STUB=1 and ANTHROPIC_API_KEY empty', () => {
    expect(process.env.HUMANIZE_STUB).toBe('1');
    expect(process.env.ANTHROPIC_API_KEY ?? '').toBe('');
  });
});
