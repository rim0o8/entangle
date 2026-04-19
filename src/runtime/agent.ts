import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { EngramLite } from '../engram/lite.ts';
import { applySeed, resolveSeed } from '../engram/seed.ts';
import { BroadcastStoreSqlite, IntentStoreSqlite } from '../core/stores.ts';
import { humanize } from '../core/humanize.ts';
import { detectMutual } from '../core/protocol.ts';
import { SpectrumMessenger, bootSpectrum } from '../messaging/spectrum.ts';
import type { ProtocolDeps, SealedIntent } from '../core/types.ts';

// runtime/agent.ts — per-person agent process.
//
// bun run src/runtime/agent.ts --person-id=<id>
//   1. loads the named person from engram,
//   2. boots spectrum-ts against the project credentials,
//   3. polls the shared intents table for new sealed intents addressed
//      to this person, and
//   4. calls detectMutual for each new intent.
//
// This is the process layout the SPEC §3.5 concurrency model assumes: two
// agents, one per Apple ID, sharing the same SQLite file. The cross-process
// race is held at bay by IntentStoreSqlite.tryMatch.

interface AgentArgs {
  personId: string;
  dbPath: string;
  pollMs: number;
}

function parseArgs(argv: string[]): AgentArgs {
  let personId = '';
  let dbPath = process.env.ENTANGLE_DB_PATH ?? '.entangle/db.sqlite';
  let pollMs = 250;
  for (const a of argv) {
    if (a.startsWith('--person-id=')) personId = a.slice('--person-id='.length);
    else if (a.startsWith('--db=')) dbPath = a.slice('--db='.length);
    else if (a.startsWith('--poll-ms=')) pollMs = Number.parseInt(a.slice('--poll-ms='.length), 10);
  }
  if (!personId) {
    console.error('agent: --person-id=<id> required');
    process.exit(2);
  }
  return { personId, dbPath, pollMs };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  mkdirSync(dirname(args.dbPath), { recursive: true });

  const db = new Database(args.dbPath);
  const graph = new EngramLite(db);
  const intents = new IntentStoreSqlite(db);
  const probes = new BroadcastStoreSqlite(db);

  // Seed is idempotent (upsert), so agents can be started in any order.
  const seed = resolveSeed({
    path: 'data/seed.json',
    profile: process.env.E2E === '1' ? 'demo' : 'test',
  });
  applySeed(graph, seed);

  const person = await graph.getPerson(args.personId);
  if (!person) {
    console.error(`agent: unknown person ${args.personId}`);
    process.exit(2);
  }

  const spectrum = await bootSpectrum({
    projectId: process.env.PHOTON_PROJECT_ID ?? '',
    projectSecret: process.env.PHOTON_API_KEY ?? '',
  });
  const messenger = new SpectrumMessenger(spectrum);
  messenger.onReceive(async (from, text) => {
    console.log(`agent[${person.id}]: received from ${from.handle}: ${text}`);
  });

  const deps: ProtocolDeps = {
    graph,
    intents,
    probes,
    messenger,
    humanize: humanize(),
    now: () => new Date(),
  };

  console.log(`agent[${person.id}]: running, polling every ${args.pollMs}ms`);

  const seen = new Set<string>();
  const loop = async () => {
    while (true) {
      const rows = db
        .prepare(
          "SELECT id FROM intents WHERE target_person_id = ? AND state = 'sealed' ORDER BY created_at ASC",
        )
        .all(person.id) as { id: string }[];
      for (const row of rows) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        const intent = await intents.get(row.id);
        if (!intent) continue;
        const result = await detectMutual(deps, intent);
        if (result.matched) {
          console.log(`agent[${person.id}]: matched ${intent.id} <-> ${result.counterpart?.id}`);
        }
      }
      await new Promise((r) => setTimeout(r, args.pollMs));
    }
  };

  const stop = async () => {
    await messenger.stop().catch(() => undefined);
    db.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  await loop();
}

await main().catch((err) => {
  console.error('agent: fatal', err);
  process.exit(1);
});
