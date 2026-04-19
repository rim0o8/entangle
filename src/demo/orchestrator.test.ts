import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createStubHumanizer } from '../core/humanize.js';
import { EngramLite } from '../engram/lite.js';
import { loadSeed } from '../engram/seed.js';
import { createTestMessenger } from '../messaging/test.js';
import { type OrchestratorEvent, createOrchestrator } from './orchestrator.js';

const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const SEED_PATH = join(REPO_ROOT, 'src', 'engram', 'seed.json');

function entangleTypes(events: OrchestratorEvent[]): string[] {
  return events.filter((e) => e.type === 'entangle').map((e) => e.payload.type);
}

describe('orchestrator', () => {
  let tempDir: string;
  let engram: EngramLite;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'entangle-orchestrator-test-'));
    engram = new EngramLite(join(tempDir, 'db.sqlite'));
    loadSeed(engram, { path: SEED_PATH, profile: 'test' });
  });

  afterEach(() => {
    engram.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('double-yes emits sealed, sealed, mutual, reveal, reveal, thread-opened in order', async () => {
    const messenger = createTestMessenger();
    const humanize = createStubHumanizer();
    const orchestrator = createOrchestrator({
      scenario: 'double-yes',
      graph: engram,
      messenger,
      humanize,
      pauseMs: 0,
    });

    const collected: OrchestratorEvent[] = [];
    orchestrator.onEvent((e) => collected.push(e));
    await orchestrator.play();

    const types = entangleTypes(collected);
    expect(types).toEqual([
      'sealed',
      'sealed',
      'mutual-detected',
      'reveal',
      'reveal',
      'thread-opened',
    ]);
    expect(orchestrator.state).toBe('done');
  });

  it('quiet-broadcast emits broadcast-started, 17 suppressed, 3 probed, 3 response, bubble-up, thread-opened', async () => {
    const messenger = createTestMessenger();
    const humanize = createStubHumanizer();
    const orchestrator = createOrchestrator({
      scenario: 'quiet-broadcast',
      graph: engram,
      messenger,
      humanize,
      pauseMs: 0,
    });

    const collected: OrchestratorEvent[] = [];
    orchestrator.onEvent((e) => collected.push(e));
    await orchestrator.play();

    const types = entangleTypes(collected);
    expect(types.filter((t) => t === 'broadcast-started')).toHaveLength(1);
    expect(types.filter((t) => t === 'suppressed')).toHaveLength(17);
    expect(types.filter((t) => t === 'probed')).toHaveLength(3);
    expect(types.filter((t) => t === 'response')).toHaveLength(3);
    expect(types.filter((t) => t === 'bubble-up')).toHaveLength(1);
    expect(types.filter((t) => t === 'thread-opened')).toHaveLength(1);

    expect(types[0]).toBe('broadcast-started');
    expect(types[types.length - 1]).toBe('thread-opened');
  });

  it('restart() resets event log and replays from beat 1', async () => {
    const messenger = createTestMessenger();
    const humanize = createStubHumanizer();
    const orchestrator = createOrchestrator({
      scenario: 'double-yes',
      graph: engram,
      messenger,
      humanize,
      pauseMs: 0,
    });

    await orchestrator.play();
    const firstSnapshotLen = orchestrator.snapshot().length;
    expect(firstSnapshotLen).toBeGreaterThan(0);

    await orchestrator.restart();
    const secondSnapshot = orchestrator.snapshot();
    expect(secondSnapshot.length).toBe(firstSnapshotLen);
  });

  it('pause() halts play until resume()', async () => {
    const messenger = createTestMessenger();
    const humanize = createStubHumanizer();
    const orchestrator = createOrchestrator({
      scenario: 'double-yes',
      graph: engram,
      messenger,
      humanize,
      pauseMs: 20,
    });

    const playing = orchestrator.play();
    orchestrator.pause();
    expect(orchestrator.state).toBe('paused');
    orchestrator.resume();
    await playing;
    expect(orchestrator.state).toBe('done');
  });
});
