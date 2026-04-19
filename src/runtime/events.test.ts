import { test, expect, describe } from 'bun:test';
import { Database } from 'bun:sqlite';
import { EngramLite } from '../engram/lite.ts';
import { applySeed, resolveSeed } from '../engram/seed.ts';
import { detectMutual, quietBroadcast, sealedIntent } from '../core/protocol.ts';
import { BroadcastStoreSqlite, IntentStoreSqlite } from '../core/stores.ts';
import { stubHumanizer } from '../core/humanize.ts';
import { MemoryMessenger } from '../messaging/memory.ts';
import { inMemorySink, jsonlSink } from './events.ts';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function buildDeps(sink: ReturnType<typeof inMemorySink>) {
  const db = new Database(':memory:');
  const graph = new EngramLite(db);
  const intents = new IntentStoreSqlite(db);
  const probes = new BroadcastStoreSqlite(db);
  const seed = resolveSeed({ path: 'data/seed.json', profile: 'test' });
  applySeed(graph, seed);
  return {
    graph,
    intents,
    probes,
    messenger: new MemoryMessenger(),
    humanize: stubHumanizer(),
    now: () => new Date('2026-04-19T14:00:00Z'),
    events: sink,
  };
}

describe('observability', () => {
  test('Double Yes produces sealed, sealed, matched in that order', async () => {
    const sink = inMemorySink();
    const deps = buildDeps(sink);
    const yuri = (await deps.graph.getPerson('yuri'))!;
    const alex = (await deps.graph.getPerson('alex'))!;
    const yuriIntent = await sealedIntent(deps, {
      from: yuri, to: alex, kind: 'collaborate', payload: 'y',
    });
    await detectMutual(deps, yuriIntent);
    const alexIntent = await sealedIntent(deps, {
      from: alex, to: yuri, kind: 'collaborate', payload: 'a',
    });
    await detectMutual(deps, alexIntent);

    const kinds = sink.events.map((e) => e.kind);
    expect(kinds).toEqual(['sealed', 'sealed', 'matched']);
  });

  test('Quiet Broadcast produces one "probed" event with deliveredTo=3, suppressed=17', async () => {
    const sink = inMemorySink();
    const deps = buildDeps(sink);
    const yuri = (await deps.graph.getPerson('yuri'))!;
    const seed = resolveSeed({ path: 'data/seed.json', profile: 'test' });
    const probe = await quietBroadcast(deps, {
      owner: yuri,
      candidates: seed.persons,
      payload: 'run?',
      constraints: { when: 'Sun 10am' },
    });
    expect(probe.candidatePersonIds.length).toBe(20);

    const suppressed = sink.events.filter((e) => e.kind === 'suppressed');
    const probed = sink.events.filter((e) => e.kind === 'probed');
    expect(probed.length).toBe(1);
    expect(suppressed.length).toBe(17);
    if (probed[0] && probed[0].kind === 'probed') {
      expect(probed[0].deliveredTo.length).toBe(3);
      expect(probed[0].suppressed.length).toBe(17);
    }
  });

  test('jsonlSink appends one JSON object per line', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'entangle-events-'));
    const path = join(dir, 'events.jsonl');
    const sink = jsonlSink(path);
    sink.emit({
      kind: 'sealed',
      at: new Date('2026-04-19T14:00:00Z'),
      intentId: 'i1',
      ownerPersonId: 'a',
      targetPersonId: 'b',
    });
    sink.emit({
      kind: 'matched',
      at: new Date('2026-04-19T14:00:01Z'),
      intentId: 'i1',
      counterpartId: 'i2',
    });
    expect(existsSync(path)).toBe(true);
    const lines = readFileSync(path, 'utf8').trim().split('\n');
    expect(lines.length).toBe(2);
    const first = JSON.parse(lines[0]!);
    expect(first.kind).toBe('sealed');
    expect(first.at).toBe('2026-04-19T14:00:00.000Z');
    rmSync(dir, { recursive: true, force: true });
  });
});
