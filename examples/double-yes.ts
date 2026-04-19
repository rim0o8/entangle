import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEventLog } from '../src/core/events.js';
import { createAnthropicHumanizer, createStubHumanizer } from '../src/core/humanize.js';
import { detectMutual, sealedIntent } from '../src/core/protocol.js';
import { createIntentStore } from '../src/core/store.js';
import type { EntangleEvent } from '../src/core/types.js';
import { EngramLite } from '../src/engram/lite.js';
import { loadSeed } from '../src/engram/seed.js';
import { createMockChannel } from '../src/spectrum/mock.js';

const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SEED_PATH = join(REPO_ROOT, 'src', 'engram', 'seed.json');

interface AssertFailure {
  ok: false;
  message: string;
}
interface AssertOk {
  ok: true;
}
type AssertResult = AssertOk | AssertFailure;

function assert(cond: unknown, message: string): AssertResult {
  return cond ? { ok: true } : { ok: false, message };
}

function fail(message: string): never {
  console.error(`[assertion-failed] ${message}`);
  process.exit(1);
}

function formatEvent(e: EntangleEvent): string {
  switch (e.type) {
    case 'sealed':
      return `[sealed] ${e.intent.ownerPersonId} -> ${e.intent.targetPersonId} (${e.intent.kind})`;
    case 'mutual-detected':
      return `[mutual-detected] ${e.a.ownerPersonId} <> ${e.b.ownerPersonId}`;
    case 'reveal':
      return `[reveal] -> ${e.to}: "${e.message}"`;
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
  const tempDir = mkdtempSync(join(tmpdir(), 'entangle-double-yes-'));
  const dbPath = join(tempDir, 'demo.sqlite');
  const engram = new EngramLite(dbPath);

  try {
    loadSeed(engram, SEED_PATH);

    const yuri = await engram.resolveByHandle({
      platform: 'imessage',
      handle: '+81-9012345678',
    });
    const alex = await engram.resolveByHandle({
      platform: 'whatsapp',
      handle: '+1-5551234567',
    });
    if (!yuri || !alex) fail('could not resolve yuri or alex');

    const channel = createMockChannel();
    const store = createIntentStore();
    const events = createEventLog();
    events.subscribe((e) => console.log(formatEvent(e)));
    const humanize = process.env.ANTHROPIC_API_KEY
      ? createAnthropicHumanizer({ apiKey: process.env.ANTHROPIC_API_KEY })
      : createStubHumanizer();

    const deps = { graph: engram, channel, store, events, humanize };

    console.log('--- Double Yes ---');

    const i1 = await sealedIntent(deps, {
      from: yuri,
      to: alex,
      payload: "I'd want to work with Alex.",
      kind: 'collaborate',
    });

    const check1 = assert(i1.state === 'sealed', `i1.state should be 'sealed', got '${i1.state}'`);
    if (!check1.ok) fail(check1.message);

    const check2 = assert(
      channel.sent.length === 0,
      `channel.sent should be empty, got ${channel.sent.length}`
    );
    if (!check2.ok) fail(check2.message);

    const i2 = await sealedIntent(deps, {
      from: alex,
      to: yuri,
      payload: 'Would love to build something with Yuri.',
      kind: 'collaborate',
    });

    const r = await detectMutual(deps, i2);
    const check3 = assert(r.matched === true, `detectMutual should match, got ${r.matched}`);
    if (!check3.ok) fail(check3.message);

    const sendsToYuri = channel.sent.filter((s) =>
      yuri.handles.some((h) => h.platform === s.platform && h.handle === s.handle)
    );
    const sendsToAlex = channel.sent.filter((s) =>
      alex.handles.some((h) => h.platform === s.platform && h.handle === s.handle)
    );

    const check4 = assert(
      channel.sent.length === 2,
      `channel.sent should have 2 entries, got ${channel.sent.length}`
    );
    if (!check4.ok) fail(check4.message);

    const check5 = assert(
      sendsToYuri.length === 1 && sendsToAlex.length === 1,
      `expected 1 send each to yuri and alex, got yuri=${sendsToYuri.length} alex=${sendsToAlex.length}`
    );
    if (!check5.ok) fail(check5.message);

    const yuriSend = sendsToYuri[0];
    const alexSend = sendsToAlex[0];
    if (!yuriSend || !alexSend) fail('missing send records');
    // Spectrum adapter now records the platform of the actual handle used for
    // delivery. Verify each send is tagged with one of that person's handle
    // platforms (not hard-coded) so the demo UI can pick the right phone frame.
    const yuriPlatforms = new Set(yuri.handles.map((h) => h.platform));
    const alexPlatforms = new Set(alex.handles.map((h) => h.platform));
    const check5a = assert(
      yuriPlatforms.has(yuriSend.platform),
      `yuri send platform must be one of ${[...yuriPlatforms].join('|')}, got ${yuriSend.platform}`
    );
    if (!check5a.ok) fail(check5a.message);
    const check5b = assert(
      alexPlatforms.has(alexSend.platform),
      `alex send platform must be one of ${[...alexPlatforms].join('|')}, got ${alexSend.platform}`
    );
    if (!check5b.ok) fail(check5b.message);
    console.log(`[platforms] yuri<-${yuriSend.platform} alex<-${alexSend.platform}`);

    const reveals = events.snapshot().filter((e) => e.type === 'reveal');
    if (reveals.length !== 2) fail(`expected 2 reveal events, got ${reveals.length}`);
    const r0 = reveals[0];
    const r1 = reveals[1];
    if (!r0 || !r1) fail('reveals missing');
    const delta = Math.abs(r1.at.getTime() - r0.at.getTime());
    const check6 = assert(delta <= 500, `reveal delta should be <=500ms, got ${delta}ms`);
    if (!check6.ok) fail(check6.message);

    // Emit thread-opened so the demo timeline matches spec §5.1.
    events.emit({
      type: 'thread-opened',
      at: new Date(),
      participants: [yuri.id, alex.id],
      context: 'collaborate',
    });

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
