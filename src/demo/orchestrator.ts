import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type EventLog, createEventLog } from '../core/events.js';
import {
  detectMutual,
  filterCandidate,
  finalizeBroadcast,
  recordBroadcastResponse,
  sealedIntent,
} from '../core/protocol.js';
import { createBroadcastStore, createIntentStore } from '../core/stores.js';
import type { BroadcastProbe, EntangleEvent, Humanizer } from '../core/types.js';
import type { IdentityGraph, Person } from '../engram/types.js';
import type { MessengerEvent, TestMessenger } from '../messaging/test.js';

export type ScenarioId = 'double-yes' | 'quiet-broadcast';

export type OrchestratorEvent =
  | { type: 'entangle'; payload: EntangleEvent; at: Date }
  | { type: 'messenger'; payload: MessengerEvent; at: Date };

export type OrchestratorEventHandler = (event: OrchestratorEvent) => void;

export type OrchestratorState = 'idle' | 'playing' | 'paused' | 'done';

export interface OrchestratorDeps {
  scenario: ScenarioId;
  graph: IdentityGraph;
  messenger: TestMessenger;
  humanize: Humanizer;
  pauseMs?: number;
}

export interface Orchestrator {
  play(): Promise<void>;
  pause(): void;
  resume(): void;
  restart(): Promise<void>;
  onEvent(handler: OrchestratorEventHandler): () => void;
  snapshot(): OrchestratorEvent[];
  readonly state: OrchestratorState;
}

interface InternalState {
  state: OrchestratorState;
  events: OrchestratorEvent[];
  handlers: Set<OrchestratorEventHandler>;
  pauseResolvers: Array<() => void>;
  tempDir: string;
  intentStore: ReturnType<typeof createIntentStore>;
  broadcastStore: ReturnType<typeof createBroadcastStore>;
  eventLog: EventLog;
  unsubMessenger: () => void;
  unsubEventLog: () => void;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createInternalState(messenger: TestMessenger): InternalState {
  const eventLog = createEventLog();
  const tempDir = mkdtempSync(join(tmpdir(), 'entangle-orchestrator-'));
  const internal: InternalState = {
    state: 'idle',
    events: [],
    handlers: new Set(),
    pauseResolvers: [],
    tempDir,
    intentStore: createIntentStore({ dbPath: join(tempDir, 'intents.sqlite') }),
    broadcastStore: createBroadcastStore({ dbPath: join(tempDir, 'broadcasts.sqlite') }),
    eventLog,
    unsubMessenger: () => {},
    unsubEventLog: () => {},
  };

  internal.unsubEventLog = eventLog.subscribe((e) => {
    const record: OrchestratorEvent = { type: 'entangle', payload: e, at: new Date() };
    internal.events.push(record);
    for (const h of internal.handlers) h(record);
  });

  internal.unsubMessenger = messenger.subscribe((e) => {
    const record: OrchestratorEvent = { type: 'messenger', payload: e, at: new Date() };
    internal.events.push(record);
    for (const h of internal.handlers) h(record);
  });

  return internal;
}

function teardown(internal: InternalState): void {
  internal.unsubMessenger();
  internal.unsubEventLog();
  rmSync(internal.tempDir, { recursive: true, force: true });
}

export function createOrchestrator(deps: OrchestratorDeps): Orchestrator {
  const pauseMs = deps.pauseMs ?? 1500;
  let internal = createInternalState(deps.messenger);

  const waitIfPaused = async (): Promise<void> => {
    if (internal.state !== 'paused') return;
    await new Promise<void>((resolve) => {
      internal.pauseResolvers.push(resolve);
    });
  };

  const pauseBetweenBeats = async (): Promise<void> => {
    await sleep(pauseMs);
    await waitIfPaused();
  };

  const play = async (): Promise<void> => {
    if (internal.state === 'playing') return;
    internal.state = 'playing';
    try {
      if (deps.scenario === 'double-yes') {
        await playDoubleYes(deps, internal, pauseBetweenBeats);
      } else {
        await playQuietBroadcast(deps, internal, pauseBetweenBeats, pauseMs);
      }
      internal.state = 'done';
    } catch (err) {
      internal.state = 'done';
      throw err;
    }
  };

  const pause = (): void => {
    if (internal.state === 'playing') internal.state = 'paused';
  };

  const resume = (): void => {
    if (internal.state !== 'paused') return;
    internal.state = 'playing';
    const pending = internal.pauseResolvers.splice(0);
    for (const r of pending) r();
  };

  const restart = async (): Promise<void> => {
    teardown(internal);
    deps.messenger.clear();
    const oldHandlers = internal.handlers;
    internal = createInternalState(deps.messenger);
    internal.handlers = oldHandlers;
    await play();
  };

  const onEvent = (handler: OrchestratorEventHandler): (() => void) => {
    internal.handlers.add(handler);
    return () => {
      internal.handlers.delete(handler);
    };
  };

  const snapshot = (): OrchestratorEvent[] => internal.events.map((e) => ({ ...e }));

  return {
    play,
    pause,
    resume,
    restart,
    onEvent,
    snapshot,
    get state() {
      return internal.state;
    },
  };
}

async function playDoubleYes(
  deps: OrchestratorDeps,
  internal: InternalState,
  pauseBetweenBeats: () => Promise<void>
): Promise<void> {
  const yuri = await deps.graph.getPerson('yuri');
  const alex = await deps.graph.getPerson('alex');
  if (!yuri || !alex) throw new Error('double-yes: cannot resolve yuri or alex');

  const entangleDeps = {
    graph: deps.graph,
    messenger: deps.messenger,
    store: internal.intentStore,
    events: internal.eventLog,
    humanize: deps.humanize,
  };

  await sealedIntent(entangleDeps, {
    from: yuri,
    to: alex,
    payload: "I'd want to work with Alex.",
    kind: 'collaborate',
  });
  await pauseBetweenBeats();

  const i2 = await sealedIntent(entangleDeps, {
    from: alex,
    to: yuri,
    payload: 'Would love to build something with Yuri.',
    kind: 'collaborate',
  });
  await pauseBetweenBeats();

  await detectMutual(entangleDeps, i2);
  await pauseBetweenBeats();

  await deps.messenger.simulateReceive(
    { platform: 'imessage', handle: alex.handles[0]?.handle ?? '+1-555-0002' },
    'yes'
  );
  await deps.messenger.simulateReceive(
    { platform: 'imessage', handle: yuri.handles[0]?.handle ?? '+1-555-0001' },
    'yes'
  );
  await pauseBetweenBeats();

  internal.eventLog.emit({
    type: 'thread-opened',
    at: new Date(),
    participants: [yuri.id, alex.id],
    context: 'collaborate',
  });
}

async function playQuietBroadcast(
  deps: OrchestratorDeps,
  internal: InternalState,
  pauseBetweenBeats: () => Promise<void>,
  pauseMs: number
): Promise<void> {
  const yuri = await deps.graph.getPerson('yuri');
  if (!yuri) throw new Error('quiet-broadcast: yuri missing');
  const friends = await deps.graph.listFriends('yuri');
  const candidates = friends.filter((f) => f.id !== 'alex');
  if (candidates.length !== 20) {
    throw new Error(`quiet-broadcast: expected 20 candidates, got ${candidates.length}`);
  }

  const probe = createProbe(yuri.id, candidates);
  await internal.broadcastStore.put(probe);
  internal.eventLog.emit({
    type: 'broadcast-started',
    at: new Date(),
    probeId: probe.id,
    candidateCount: candidates.length,
  });

  const perBeatPause = Math.max(50, Math.round(pauseMs / 5));
  for (const candidate of candidates) {
    await sleep(perBeatPause);
    const verdict = await filterCandidate({ graph: deps.graph }, yuri.id, candidate.id, probe);
    if (verdict.verdict === 'suppress') {
      internal.eventLog.emit({
        type: 'suppressed',
        at: new Date(),
        probeId: probe.id,
        candidateId: candidate.id,
        reason: verdict.reason ?? 'unknown',
      });
      continue;
    }
    const platform = await deps.graph.preferredPlatformBetween(yuri.id, candidate.id);
    const handle = candidate.handles.find((h) => h.platform === platform);
    if (!handle) {
      internal.eventLog.emit({
        type: 'suppressed',
        at: new Date(),
        probeId: probe.id,
        candidateId: candidate.id,
        reason: 'no-handle',
      });
      continue;
    }
    const message = await deps.humanize.renderProbe(probe, candidate);
    await deps.messenger.send(handle, { text: message, kind: 'prompt' });
    internal.eventLog.emit({
      type: 'probed',
      at: new Date(),
      probeId: probe.id,
      candidateId: candidate.id,
      message,
    });
  }

  await pauseBetweenBeats();

  const bigPause = pauseMs * 2;
  await sleep(bigPause);
  await recordBroadcastResponse(
    { store: internal.broadcastStore, events: internal.eventLog },
    probe.id,
    'mika',
    'yes'
  );
  await sleep(bigPause);
  await recordBroadcastResponse(
    { store: internal.broadcastStore, events: internal.eventLog },
    probe.id,
    'taro',
    'yes'
  );
  await sleep(bigPause);
  await recordBroadcastResponse(
    { store: internal.broadcastStore, events: internal.eventLog },
    probe.id,
    'ken',
    'no'
  );

  await pauseBetweenBeats();

  await finalizeBroadcast(
    {
      graph: deps.graph,
      store: internal.broadcastStore,
      events: internal.eventLog,
      humanize: deps.humanize,
    },
    probe.id,
    'Jazz tonight'
  );
}

function createProbe(ownerId: string, candidates: Person[]): BroadcastProbe {
  const responses: Record<string, 'yes' | 'no' | 'silent'> = {};
  for (const c of candidates) {
    responses[c.id] = 'silent';
  }
  return {
    id: `probe-${ownerId}-${Date.now()}`,
    ownerPersonId: ownerId,
    candidatePersonIds: candidates.map((c) => c.id),
    payload: 'Jazz tonight, anyone?',
    constraints: { when: 'tonight', where: 'tokyo' },
    createdAt: new Date(),
    responses,
  };
}
