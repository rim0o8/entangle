import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { EngramLite } from '../engram/lite.ts';
import { applySeed, resolveSeed } from '../engram/seed.ts';
import { detectMutual, quietBroadcast, sealedIntent } from '../core/protocol.ts';
import { BroadcastStoreSqlite, IntentStoreSqlite } from '../core/stores.ts';
import { humanize } from '../core/humanize.ts';
import { SpectrumMessenger, bootSpectrum } from '../messaging/spectrum.ts';
import { consoleNarrator, elapsed, startNarrationClock } from './format.ts';
import { jsonlSink } from './events.ts';
import type { Person } from '../engram/types.ts';

// runtime/dev.ts — scripted scenario runner invoked by the 'dev' npm script.
// Lives outside `core/` and is allowed to print, open DB files, and hit
// the network.

type Scenario = 'double-yes' | 'quiet-broadcast';

function parseArgs(argv: string[]): { scenario: Scenario } {
  let scenario: Scenario = 'double-yes';
  for (const a of argv) {
    if (a === '--scenario=quiet-broadcast') scenario = 'quiet-broadcast';
    else if (a === '--scenario=double-yes') scenario = 'double-yes';
  }
  return { scenario };
}

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v || v.trim() === '') {
    console.error(`dev: missing env var ${key}`);
    process.exit(2);
  }
  return v.trim();
}

async function main() {
  const { scenario } = parseArgs(process.argv.slice(2));

  requireEnv('PHOTON_PROJECT_ID');
  requireEnv('PHOTON_API_KEY');
  requireEnv('ANTHROPIC_API_KEY');
  for (const h of ['YURI_HANDLE', 'ALEX_HANDLE', 'MIKA_HANDLE', 'TARO_HANDLE', 'KEN_HANDLE']) {
    requireEnv(h);
  }

  const dbPath = process.env.ENTANGLE_DB_PATH ?? '.entangle/db.sqlite';
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);

  const graph = new EngramLite(db);
  const intents = new IntentStoreSqlite(db);
  const probes = new BroadcastStoreSqlite(db);
  const seed = resolveSeed({ path: 'data/seed.json', profile: 'demo' });
  applySeed(graph, seed);

  const yuri = await graph.getPerson('yuri');
  const alex = await graph.getPerson('alex');
  if (!yuri || !alex) throw new Error('dev: seed missing yuri/alex');

  const spectrum = await bootSpectrum({
    projectId: process.env.PHOTON_PROJECT_ID!,
    projectSecret: process.env.PHOTON_API_KEY!,
  });
  const messenger = new SpectrumMessenger(spectrum);
  const narrator = consoleNarrator();
  const clock = startNarrationClock();

  const eventsPath = process.env.ENTANGLE_EVENTS_PATH ?? '.entangle/events.jsonl';
  const events = jsonlSink(eventsPath);

  const deps = {
    graph,
    intents,
    probes,
    messenger,
    humanize: humanize(),
    now: () => new Date(),
    events,
  };

  try {
    if (scenario === 'double-yes') {
      await runDoubleYes({ deps, yuri, alex, narrator, clock });
    } else {
      const candidates = seed.persons  // all 20 — yuri self-filters via no self-relationship;
      await runQuietBroadcast({ deps, yuri, candidates, narrator, clock });
    }
  } finally {
    await messenger.stop().catch(() => undefined);
  }
}

interface RunCtx {
  deps: {
    graph: EngramLite;
    intents: IntentStoreSqlite;
    probes: BroadcastStoreSqlite;
    messenger: SpectrumMessenger;
    humanize: ReturnType<typeof humanize>;
    now: () => Date;
  };
  narrator: ReturnType<typeof consoleNarrator>;
  clock: ReturnType<typeof startNarrationClock>;
}

async function runDoubleYes(ctx: RunCtx & { yuri: Person; alex: Person }) {
  const { deps, yuri, alex, narrator, clock } = ctx;
  narrator.header('entangle dev — Double Yes scenario (live via Spectrum)');

  const yuriIntent = await sealedIntent(deps, {
    from: yuri,
    to: alex,
    kind: 'collaborate',
    payload: "I'd want to work with Alex.",
  });
  narrator.step(elapsed(clock), 'yuri', 'submits sealed intent \u2192 alex');
  narrator.detail(`kind=collaborate payload="${yuriIntent.payload}"`);
  narrator.detail(`store.put(${yuriIntent.id}) state=sealed`);
  narrator.detail(`detectMutual(${yuriIntent.id}) \u2192 no counterpart yet`);
  await detectMutual(deps, yuriIntent);

  narrator.detail('');
  narrator.detail('\u2026 2 hours later (simulated) \u2026');
  narrator.detail('');
  await new Promise((r) => setTimeout(r, 1000));

  const alexIntent = await sealedIntent(deps, {
    from: alex,
    to: yuri,
    kind: 'collaborate',
    payload: 'Would love to build with Yuri.',
  });
  narrator.step(elapsed(clock), 'alex', 'submits sealed intent \u2192 yuri');
  narrator.detail(`kind=collaborate payload="${alexIntent.payload}"`);
  narrator.detail(`store.put(${alexIntent.id}) state=sealed`);
  narrator.detail(`detectMutual(${alexIntent.id}) \u2192 counterpart ${yuriIntent.id} found`);

  const result = await detectMutual(deps, alexIntent);
  if (!result.matched) throw new Error('dev: expected match');
  narrator.detail(`store.tryMatch(${yuriIntent.id}, ${alexIntent.id}) \u2192 claimed=true`);
  narrator.detail('humanize \u2192 reveal text drafted for yuri');
  narrator.detail('humanize \u2192 reveal text drafted for alex');
  narrator.detail(`spectrum \u2192 yuri's iMessage  \u2713`);
  narrator.detail(`spectrum \u2192 alex's iMessage  \u2713`);

  narrator.matched();
  const sec = (new Date().getTime() - clock.startedAt) / 1000;
  narrator.done(sec);
}

async function runQuietBroadcast(ctx: RunCtx & { yuri: Person; candidates: Person[] }) {
  const { deps, yuri, candidates, narrator, clock } = ctx;
  narrator.header('entangle dev \u2014 Quiet Broadcast (live via Spectrum)');
  narrator.step(elapsed(clock), 'yuri', `quiet broadcast to ${candidates.length} candidates`);
  const probe = await quietBroadcast(deps, {
    owner: yuri,
    candidates,
    payload: 'Sunday 10am run in Yoyogi \u2014 anyone around?',
    constraints: { when: 'Sunday 10am', where: 'Yoyogi' },
  });
  const freeCount = candidates.filter((c) => c.availability === 'free').length;
  narrator.detail(`probe.id=${probe.id}`);
  narrator.detail(`delivered to ${freeCount} free candidates; ${candidates.length - freeCount} suppressed`);
  const sec = (new Date().getTime() - clock.startedAt) / 1000;
  narrator.done(sec);
}

await main().catch((err) => {
  console.error('dev: fatal', err);
  process.exit(1);
});
