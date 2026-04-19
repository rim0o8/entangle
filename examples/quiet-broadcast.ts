import { Database } from 'bun:sqlite';
import { EngramLite } from '../src/engram/lite.ts';
import { applySeed, resolveSeed } from '../src/engram/seed.ts';
import { quietBroadcast } from '../src/core/protocol.ts';
import { BroadcastStoreSqlite, IntentStoreSqlite } from '../src/core/stores.ts';
import { stubHumanizer } from '../src/core/humanize.ts';
import { MemoryMessenger } from '../src/messaging/memory.ts';
import { consoleNarrator, elapsed, startNarrationClock } from '../src/runtime/format.ts';
import { jsonlSink } from '../src/runtime/events.ts';

const db = new Database(':memory:');
const graph = new EngramLite(db);
const intents = new IntentStoreSqlite(db);
const probes = new BroadcastStoreSqlite(db);
const seed = resolveSeed({ path: 'data/seed.json', profile: 'test' });
applySeed(graph, seed);

const yuri = (await graph.getPerson('yuri'))!;
const candidates = seed.persons  // all 20 — yuri self-filters via no self-relationship;

const messenger = new MemoryMessenger();
const narrator = consoleNarrator();
const clock = startNarrationClock();
const eventsPath = process.env.ENTANGLE_EVENTS_PATH ?? '.entangle/events.jsonl';
const events = jsonlSink(eventsPath);
const deps = {
  graph,
  intents,
  probes,
  messenger,
  humanize: stubHumanizer(),
  now: () => new Date(),
  events,
};

narrator.header('entangle example \u2014 Quiet Broadcast (in-memory)');
narrator.step(elapsed(clock), 'yuri', `broadcast to ${candidates.length} candidates`);

const probe = await quietBroadcast(deps, {
  owner: yuri,
  candidates,
  payload: 'Sunday 10am run in Yoyogi \u2014 anyone around?',
  constraints: { when: 'Sunday 10am', where: 'Yoyogi' },
});

narrator.detail(`probe=${probe.id}`);
narrator.detail(`sent to ${messenger.sent.length} candidates (the rest were suppressed)`);
for (const s of messenger.sent) {
  narrator.detail(`\u2192 ${s.to.handle}: ${s.message.text}`);
}
narrator.done((Date.now() - clock.startedAt) / 1000);
