import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEventLog } from '../src/core/events.js';
import { createHumanizerFromEnv } from '../src/core/humanize.js';
import {
  finalizeBroadcast,
  quietBroadcast,
  recordBroadcastResponse,
} from '../src/core/protocol.js';
import { createBroadcastStore } from '../src/core/stores.js';
import type { EntangleEvent } from '../src/core/types.js';
import { EngramLite } from '../src/engram/lite.js';
import { loadSeed } from '../src/engram/seed.js';
import { createTestMessenger } from '../src/messaging/test.js';

const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SEED_PATH = join(REPO_ROOT, 'src', 'engram', 'seed.json');

function fail(message: string): never {
  console.error(`[assertion-failed] ${message}`);
  process.exit(1);
}

function formatEvent(e: EntangleEvent): string {
  switch (e.type) {
    case 'sealed':
      return `[sealed] ${e.intent.ownerPersonId} -> ${e.intent.targetPersonId}`;
    case 'mutual-detected':
      return '[mutual-detected]';
    case 'reveal':
      return `[reveal] -> ${e.to}`;
    case 'broadcast-started':
      return `[broadcast-started] probe=${e.probeId} candidates=${e.candidateCount}`;
    case 'suppressed':
      return `[suppressed] ${e.candidateId} (${e.reason})`;
    case 'probed':
      return `[probed] -> ${e.candidateId}: "${e.message}"`;
    case 'response':
      return `[response] ${e.from}: ${e.response}`;
    case 'bubble-up':
      return `[bubble-up] yes: [${e.yesResponders.join(', ')}] msg="${e.message}"`;
    case 'thread-opened':
      return `[thread-opened] participants=[${e.participants.join(', ')}] ctx="${e.context}"`;
  }
}

async function main(): Promise<void> {
  const tempDir = mkdtempSync(join(tmpdir(), 'entangle-qb-'));
  const engramDb = join(tempDir, 'engram.sqlite');
  const broadcastDb = join(tempDir, 'broadcasts.sqlite');
  const engram = new EngramLite(engramDb);

  try {
    loadSeed(engram, { path: SEED_PATH, profile: 'test' });

    const yuri = await engram.getPerson('yuri');
    if (!yuri) fail('could not resolve yuri');

    const allFriends = await engram.listFriends('yuri');
    const candidates = allFriends.filter((f) => f.id !== 'alex');
    if (candidates.length !== 20) fail(`expected 20 candidates, got ${candidates.length}`);

    const messenger = createTestMessenger();
    const store = createBroadcastStore({ dbPath: broadcastDb });
    const events = createEventLog();
    events.subscribe((e) => console.log(formatEvent(e)));
    const humanize = createHumanizerFromEnv();

    const deps = { graph: engram, messenger, store, events, humanize };

    console.log('--- Quiet Broadcast ---');

    const probe = await quietBroadcast(deps, {
      owner: yuri,
      candidates,
      payload: 'Jazz tonight, anyone?',
      constraints: { when: 'tonight', where: 'tokyo' },
    });

    const snapshot = events.snapshot();
    const suppressed = snapshot.filter((e) => e.type === 'suppressed');
    const probed = snapshot.filter((e) => e.type === 'probed');

    if (suppressed.length !== 17) fail(`expected 17 suppressed, got ${suppressed.length}`);
    if (probed.length !== 3) fail(`expected 3 probed, got ${probed.length}`);
    if (messenger.sent.length !== 3) fail(`expected 3 sends, got ${messenger.sent.length}`);

    await recordBroadcastResponse(deps, probe.id, 'mika', 'yes');
    await recordBroadcastResponse(deps, probe.id, 'taro', 'yes');
    await recordBroadcastResponse(deps, probe.id, 'ken', 'no');

    const messengerSendsAfterResponses = messenger.sent.length;
    if (messengerSendsAfterResponses !== 3) {
      fail(
        `owner messenger must not receive additional sends on no; got ${messengerSendsAfterResponses}`
      );
    }

    const finalize = await finalizeBroadcast(deps, probe.id, 'Jazz tonight');
    const yesSet = new Set(finalize.yesResponders);
    if (!yesSet.has('mika') || !yesSet.has('taro') || yesSet.has('ken') || yesSet.size !== 2) {
      fail(`bubble-up yes responders wrong: ${JSON.stringify(finalize.yesResponders)}`);
    }

    const bubbleUps = events.snapshot().filter((e) => e.type === 'bubble-up');
    if (bubbleUps.length !== 1) fail(`expected 1 bubble-up, got ${bubbleUps.length}`);

    const threadOpened = events.snapshot().filter((e) => e.type === 'thread-opened');
    if (threadOpened.length !== 1) fail(`expected 1 thread-opened, got ${threadOpened.length}`);

    console.log('--- OK ---');
  } finally {
    engram.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
