import { Database } from 'bun:sqlite';
import { EngramLite } from '../src/engram/lite.ts';
import { applySeed, resolveSeed } from '../src/engram/seed.ts';
import { detectMutual, sealedIntent } from '../src/core/protocol.ts';
import { BroadcastStoreSqlite, IntentStoreSqlite } from '../src/core/stores.ts';
import { stubHumanizer } from '../src/core/humanize.ts';
import { MemoryMessenger } from '../src/messaging/memory.ts';
import { consoleNarrator, elapsed, startNarrationClock } from '../src/runtime/format.ts';
import { jsonlSink } from '../src/runtime/events.ts';

// examples/double-yes.ts — scripted Double Yes walk-through against an
// in-memory messenger. No credentials required. Useful for reviewing the
// protocol shape without running against real Spectrum.

const db = new Database(':memory:');
const graph = new EngramLite(db);
const intents = new IntentStoreSqlite(db);
const probes = new BroadcastStoreSqlite(db);
const seed = resolveSeed({ path: 'data/seed.json', profile: 'test' });
applySeed(graph, seed);

const yuri = (await graph.getPerson('yuri'))!;
const alex = (await graph.getPerson('alex'))!;

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

narrator.header('entangle example \u2014 Double Yes (in-memory)');
const yuriIntent = await sealedIntent(deps, {
  from: yuri,
  to: alex,
  kind: 'collaborate',
  payload: "I'd want to work with Alex.",
});
narrator.step(elapsed(clock), 'yuri', 'sealed intent \u2192 alex');
narrator.detail(`intent=${yuriIntent.id} state=sealed`);

const alexIntent = await sealedIntent(deps, {
  from: alex,
  to: yuri,
  kind: 'collaborate',
  payload: 'Would love to build with Yuri.',
});
narrator.step(elapsed(clock), 'alex', 'sealed intent \u2192 yuri');
narrator.detail(`intent=${alexIntent.id} state=sealed`);

const result = await detectMutual(deps, alexIntent);
if (!result.matched) throw new Error('expected match');
narrator.detail(`tryMatch(${yuriIntent.id}, ${alexIntent.id}) \u2192 claimed`);
for (const s of messenger.sent) {
  narrator.detail(`in-memory send \u2192 ${s.to.handle}: ${s.message.text}`);
}
narrator.matched();
narrator.done((Date.now() - clock.startedAt) / 1000);
