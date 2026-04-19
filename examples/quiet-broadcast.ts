import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEventLog } from '../src/core/events.js';
import { createAnthropicHumanizer, createStubHumanizer } from '../src/core/humanize.js';
import {
  finalizeBroadcast,
  quietBroadcast,
  recordBroadcastResponse,
} from '../src/core/protocol.js';
import { createBroadcastStore } from '../src/core/store.js';
import type { EntangleEvent } from '../src/core/types.js';
import { EngramLite } from '../src/engram/lite.js';
import { loadSeed } from '../src/engram/seed.js';
import { createMockChannel } from '../src/spectrum/mock.js';

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
      return `[bubble-up] yes: [${e.yesResponders.join(', ')}]`;
    case 'thread-opened':
      return `[thread-opened] participants=[${e.participants.join(', ')}] ctx="${e.context}"`;
  }
}

async function main(): Promise<void> {
  const tempDir = mkdtempSync(join(tmpdir(), 'entangle-qb-'));
  const dbPath = join(tempDir, 'demo.sqlite');
  const engram = new EngramLite(dbPath);

  try {
    loadSeed(engram, SEED_PATH);

    const yuri = await engram.getPerson('yuri');
    if (!yuri) fail('could not resolve yuri');

    const allFriends = await engram.listFriends('yuri');
    const candidates = allFriends.filter((f) => f.id !== 'alex');
    if (candidates.length !== 20) fail(`expected 20 candidates, got ${candidates.length}`);

    const channel = createMockChannel();
    const store = createBroadcastStore();
    const events = createEventLog();
    events.subscribe((e) => console.log(formatEvent(e)));
    const humanize = process.env.ANTHROPIC_API_KEY
      ? createAnthropicHumanizer({ apiKey: process.env.ANTHROPIC_API_KEY })
      : createStubHumanizer(
          () => "Yuri's wondering if you're around for jazz tonight in Tokyo. No pressure."
        );

    const deps = { graph: engram, channel, store, events, humanize };

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
    if (channel.sent.length !== 3) fail(`expected 3 sends, got ${channel.sent.length}`);

    const suppressedIds = new Set(
      suppressed.map((e) => (e.type === 'suppressed' ? e.candidateId : ''))
    );
    const platformSummary: string[] = [];
    for (const s of channel.sent) {
      const candidate = candidates.find((c) =>
        c.handles.some((h) => h.platform === s.platform && h.handle === s.handle)
      );
      if (!candidate) fail(`unknown candidate for send to ${s.platform}:${s.handle}`);
      if (suppressedIds.has(candidate.id)) {
        fail(`suppressed candidate ${candidate.id} received a send`);
      }
      platformSummary.push(`${candidate.id}<-${s.platform}`);
    }
    console.log(`[platforms] ${platformSummary.join(' ')}`);

    // 3 free candidates = mika, taro, ken. 2 yes (mika, taro), 1 no (ken).
    recordBroadcastResponse(deps, probe.id, 'mika', 'yes');
    recordBroadcastResponse(deps, probe.id, 'taro', 'yes');
    recordBroadcastResponse(deps, probe.id, 'ken', 'no');

    const channelSendsAfterResponses = channel.sent.length;
    if (channelSendsAfterResponses !== 3) {
      fail(
        `owner channel must not receive additional sends on no; got ${channelSendsAfterResponses}`
      );
    }

    const finalize = finalizeBroadcast(deps, probe.id, 'Jazz tonight');
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
