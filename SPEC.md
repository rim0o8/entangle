# Entangle — Specification

> The channel between agents. Where humans can't speak.

Build spec for **Entangle**: a TypeScript library that enables agent-to-agent communication between two humans' AI agents, built on Photon's Spectrum SDK. This spec is the implementation contract for Claude Code.

---

## 1. Goal

Produce an open-source TypeScript codebase that a Photon reviewer can clone, configure, and run in under 5 minutes. Success is measured by:

- **`bun run dev` runs the Double Yes scenario end-to-end against real Photon Spectrum, delivering two real iMessages to the reviewer's configured handle.** The first interaction with the repo is setting up Photon credentials. That is deliberate: Spectrum is the point. Running on the reviewer's own Spectrum project is the demo.
- `core/protocol.ts` reads as an elegant, self-contained protocol spec under 300 lines.
- `bun test` runs in under 10 seconds, zero LLM API calls, zero network calls, exhaustive protocol coverage.
- The codebase is under 2000 lines of hand-written TypeScript.

Polish, videos, marketing: out of scope for this spec.

---

## 2. Tech stack

| Concern | Choice | Reason |
|---|---|---|
| Language | TypeScript strict | |
| Runtime | Bun | Photon's own repos use Bun (`whatsapp-business-ts`); stack-alignment signal. Node works as a fallback. |
| Package manager | Bun (or pnpm) | |
| Messaging SDK | `spectrum-ts` | Primary. Fallback: `@photon-ai/advanced-imessage-kit`. |
| Storage | SQLite via `bun:sqlite` (or `better-sqlite3` on Node) | Embedded, synchronous, transaction-safe |
| LLM | Anthropic Claude Sonnet via `@anthropic-ai/sdk` | Used only by `humanize.ts`, stubbed in tests |
| Schema | `zod` | Runtime type safety at protocol boundaries |
| Testing | `bun:test` (or `vitest`) | |
| Lint / format | `biome` | |
| Terminal output | `picocolors` | Zero-deps, 3KB. Used by dev-mode formatter only. |

---

## 3. Architecture

### 3.1 Layout

```
src/
├── engram/
│   ├── types.ts          # IdentityGraph interface
│   ├── lite.ts           # SQLite-backed EngramLite
│   └── seed.ts           # Seed loader
├── core/
│   ├── types.ts          # All Entangle-layer types (intents, probes, stores, messenger, humanizer)
│   ├── protocol.ts       # sealedIntent, detectMutual, quietBroadcast, filterCandidate
│   ├── stores.ts         # IntentStore, BroadcastStore (SQLite)
│   └── humanize.ts       # LLM wrapper + stub
├── messaging/
│   ├── spectrum.ts       # Messenger port on spectrum-ts
│   └── memory.ts         # In-memory Messenger for tests
├── runtime/
│   ├── agent.ts          # Per-person agent process entry point (spectrum-ts)
│   └── format.ts         # picocolors-based dev logger
└── index.ts              # Public exports
examples/
├── double-yes.ts
└── quiet-broadcast.ts
tests/
└── (co-located with sources as *.test.ts)
```

### 3.2 Dependency direction

```
runtime → core → engram (interface)
runtime → messaging → spectrum-ts
examples → runtime
core → engram (interface only, never spectrum-ts)
```

`core` is pure: no I/O beyond its injected ports. This keeps it testable and readable.

### 3.3 Consolidated types

```typescript
// src/engram/types.ts
export type PlatformId = 'imessage';

export interface PlatformHandle {
  platform: PlatformId;
  handle: string; // e.g. "+81-90-xxxx-xxxx"
}

export interface Person {
  id: string;
  displayName: string;
  handles: PlatformHandle[];
  preferredPlatforms: PlatformId[];
  preferences: Record<string, unknown>;
  availability?: 'free' | 'busy' | 'traveling' | 'declined-recently';
}

export interface Relationship {
  fromId: string;
  toId: string;
  type: 'colleague' | 'friend' | 'met-once' | 'collaborator' | 'runs-with';
  lastContactAt: Date | null;
  tags: string[];
}

export interface IdentityGraph {
  getPerson(id: string): Promise<Person | null>;
  resolveByHandle(handle: PlatformHandle): Promise<Person | null>;
  getRelationship(fromId: string, toId: string): Promise<Relationship | null>;
  listFriends(personId: string): Promise<Person[]>;
}

// src/core/types.ts
export type IntentKind = 'collaborate' | 'reconnect' | 'custom';
export type IntentState = 'sealed' | 'matched' | 'expired' | 'revealed';

export interface SealedIntent {
  id: string;
  ownerPersonId: string;
  targetPersonId: string;
  kind: IntentKind;
  payload: string;
  urgency: 'low' | 'med' | 'high';
  createdAt: Date;
  expiresAt: Date;
  state: IntentState;
}

export interface BroadcastProbe {
  id: string;
  ownerPersonId: string;
  candidatePersonIds: string[];
  payload: string;
  constraints: { when: string; where?: string };
  createdAt: Date;
}

export interface IntentStore {
  put(intent: SealedIntent): Promise<void>;
  get(id: string): Promise<SealedIntent | null>;
  findReverse(intent: SealedIntent): Promise<SealedIntent | null>;
  /** Atomic: mark both intents 'matched' iff both are still 'sealed'. Returns true if the caller won the race. */
  tryMatch(idA: string, idB: string): Promise<boolean>;
}

export interface BroadcastStore {
  put(probe: BroadcastProbe): Promise<void>;
  get(id: string): Promise<BroadcastProbe | null>;
  recordResponse(probeId: string, personId: string, response: 'yes' | 'no' | 'silent'): Promise<void>;
  listYes(probeId: string): Promise<string[]>;
}

export interface Messenger {
  send(to: PlatformHandle, message: { text: string; kind?: 'prompt' | 'notice' | 'confirm' }): Promise<void>;
  onReceive(handler: (from: PlatformHandle, text: string) => Promise<void>): void;
}

export interface Humanizer {
  renderReveal(self: SealedIntent, counterpart: SealedIntent): Promise<string>;
  renderProbe(probe: BroadcastProbe, candidate: Person): Promise<string>;
  renderBubbleUp(probe: BroadcastProbe, yesResponders: Person[]): Promise<string>;
}

export interface ProtocolDeps {
  graph: IdentityGraph;
  messenger: Messenger;
  intents: IntentStore;
  probes: BroadcastStore;
  humanize: Humanizer;
  now: () => Date; // injected for deterministic tests
}
```

### 3.4 Protocol primitives (implementation sketches)

These are the only four functions in `core/protocol.ts`. They are the product.

```typescript
// sealedIntent — stores an intent, does not send anything.
export async function sealedIntent(
  d: ProtocolDeps,
  input: { from: Person; to: Person; kind: IntentKind; payload: string; urgency?: 'low' | 'med' | 'high' }
): Promise<SealedIntent> {
  const intent: SealedIntent = {
    id: nanoid(),
    ownerPersonId: input.from.id,
    targetPersonId: input.to.id,
    kind: input.kind,
    payload: input.payload,
    urgency: input.urgency ?? 'low',
    createdAt: d.now(),
    expiresAt: addDays(d.now(), 30),
    state: 'sealed',
  };
  await d.intents.put(intent);
  return intent;
}

// detectMutual — call after every new intent. Concurrency-safe via atomic CAS.
export async function detectMutual(
  d: ProtocolDeps,
  intent: SealedIntent
): Promise<{ matched: boolean; counterpart?: SealedIntent }> {
  const counterpart = await d.intents.findReverse(intent);
  if (!counterpart) return { matched: false };

  const claimed = await d.intents.tryMatch(intent.id, counterpart.id);
  if (!claimed) return { matched: false }; // lost the race; peer process handled it

  const [owner, target] = await Promise.all([
    d.graph.getPerson(intent.ownerPersonId),
    d.graph.getPerson(intent.targetPersonId),
  ]);
  if (!owner || !target) throw new Error('person missing after match');

  const [textForOwner, textForTarget] = await Promise.all([
    d.humanize.renderReveal(intent, counterpart),
    d.humanize.renderReveal(counterpart, intent),
  ]);

  await Promise.all([
    d.messenger.send(owner.handles[0], { text: textForOwner, kind: 'notice' }),
    d.messenger.send(target.handles[0], { text: textForTarget, kind: 'notice' }),
  ]);

  return { matched: true, counterpart };
}

// filterCandidate — pure function, deterministic, tests-first.
export async function filterCandidate(
  d: ProtocolDeps,
  ownerId: string,
  candidateId: string
): Promise<'suppress' | 'deliver'> {
  const candidate = await d.graph.getPerson(candidateId);
  if (!candidate) return 'suppress';
  if (candidate.availability !== 'free') return 'suppress';
  const rel = await d.graph.getRelationship(ownerId, candidateId);
  if (!rel) return 'suppress';
  return 'deliver';
}

// quietBroadcast — probe only candidates that survive filterCandidate.
export async function quietBroadcast(
  d: ProtocolDeps,
  input: { owner: Person; candidates: Person[]; payload: string; constraints: BroadcastProbe['constraints'] }
): Promise<BroadcastProbe> {
  const probe: BroadcastProbe = {
    id: nanoid(),
    ownerPersonId: input.owner.id,
    candidatePersonIds: input.candidates.map(c => c.id),
    payload: input.payload,
    constraints: input.constraints,
    createdAt: d.now(),
  };
  await d.probes.put(probe);

  await Promise.all(
    input.candidates.map(async (c) => {
      const verdict = await filterCandidate(d, input.owner.id, c.id);
      if (verdict === 'suppress') {
        await d.probes.recordResponse(probe.id, c.id, 'silent');
        return;
      }
      const text = await d.humanize.renderProbe(probe, c);
      await d.messenger.send(c.handles[0], { text, kind: 'prompt' });
    })
  );

  return probe;
}
```

### 3.5 Concurrency model

Two agent processes on one Mac, one per Apple ID, share the same SQLite database file. `IntentStore.tryMatch` is the single source of atomicity:

```sql
BEGIN IMMEDIATE;
UPDATE intents SET state='matched' WHERE id IN (?, ?) AND state='sealed';
-- commit iff changes()=2, else rollback and return false
```

If both processes call `detectMutual` simultaneously for the same intent pair, exactly one transaction sees two `state='sealed'` rows and succeeds. The other sees one or zero and rolls back. The winner performs the send.

For `quietBroadcast`, each candidate is processed independently and only by the owner's process. No cross-process concurrency concerns.

For `onReceive`, each agent process subscribes only to messages addressed to its own Apple ID, via `spectrum-ts`. No shared event bus needed.

### 3.6 Dev mode (`bun run dev`)

`bun run dev` is the primary runnable. It runs the Double Yes scenario end-to-end against **real Photon Spectrum**, delivering two real iMessages to the configured recipient handles.

**Required environment:** `PHOTON_PROJECT_ID`, `PHOTON_API_KEY`, `ANTHROPIC_API_KEY`, `YURI_HANDLE`, `ALEX_HANDLE`. Handles are phone numbers in E.164 format (`+81-90-1234-5678`). `YURI_HANDLE` and `ALEX_HANDLE` must be different Apple IDs; otherwise the two reveal messages collapse into a single iMessage thread and the demo loses its split nature. Typical reviewer setup: their own phone as `YURI_HANDLE`, a secondary Apple ID signed into their Mac's Messages.app as `ALEX_HANDLE`.

**Humanize mode.** `bun run dev` uses real Claude Sonnet for reveal/probe text generation so the iMessages arriving on the reviewer's phone read as natural language. Cost per run is a few cents. `HUMANIZE_STUB=1` is honored if set but is intended for `bun test` only.

**What happens:** `bun run dev` spawns two agent processes on one Mac (Yuri and Alex), each bound to its Apple ID via `spectrum-ts`. The scripted scenario submits Yuri's sealed intent, waits two simulated hours, submits Alex's reciprocal, triggers `detectMutual`, and delivers two real iMessages. `runtime/format.ts` renders a colored, timestamped narration of every protocol step to the terminal while this is happening.

**Locked output contract** (structure fixed; nanoids, timestamps, and humanized phrasing vary):

```
▸ entangle dev — Double Yes scenario (live via Spectrum)

[00:00] ● yuri    submits sealed intent → alex
         kind=collaborate payload="I'd want to work with Alex."
         store.put(abc123) state=sealed
         detectMutual(abc123) → no counterpart yet

       … 2 hours later (simulated) …

[00:02] ● alex    submits sealed intent → yuri
         kind=collaborate payload="Would love to build with Yuri."
         store.put(def456) state=sealed
         detectMutual(def456) → counterpart abc123 found
         store.tryMatch(abc123, def456) → claimed=true
         humanize → "Alex independently said the same. Open a thread?"
         humanize → "Yuri independently said the same. Open a thread?"
         spectrum → yuri's iMessage  ✓
         spectrum → alex's iMessage  ✓

         ✨ MATCHED

done in 2.1s — check your phone
```

`bun run dev -- --scenario=quiet-broadcast` runs the quiet broadcast variant: 20 candidates (3 with real handles, 17 suppressed by availability), real iMessage delivered only to the 3 free candidates.

---

## 4. Phases

### Phase -1 — Photon onboarding (Day 0, ~3 hours, independent)

- Register at `app.photon.codes`, create project, toggle iMessage
- Install `spectrum-ts`, record exact package name
- Smoke test: send a real iMessage from Apple ID A to Apple ID B via `spectrum-ts` and receive reply
- Verify `spectrum-ts` can be instantiated for two different Apple IDs in separate processes on the same Mac; document the API surface used

Acceptance:
- Working smoke script `scripts/smoke-imessage.ts` (not part of library)
- Brief notes in `docs/spectrum-notes.md` describing the relevant `spectrum-ts` API

### Phase 0 — Scaffold (0.25 day)

- Bun init, tsconfig strict, biome, bun:test (or vitest)
- Install deps from Section 2
- Directory structure from Section 3.1
- Scripts: `dev`, `test`, `example:doubleyes`, `example:quietbroadcast`, `agent`, `smoke:imessage`

Acceptance:
- `bun test` runs, passes empty suite
- All scripts exist, all exit cleanly with a placeholder log

### Phase 1 — engram-lite (0.5 day, no I/O beyond SQLite)

- `IdentityGraph` interface from 3.3
- `EngramLite` class with a `bun:sqlite` connection
- Tables: `persons`, `relationships`. Schema is trivial, use plain text JSON for `handles`, `preferredPlatforms`, `preferences` arrays
- `seed.ts` loads from `seed.json` (20 synthetic persons). In the demo profile, handles for the 3 real recipients are read from `.env` (`YURI_HANDLE`, `ALEX_HANDLE`, `MIKA_HANDLE`, `TARO_HANDLE`, `KEN_HANDLE`) and substituted in. In the test profile, all handles are synthetic fakes with the `+1-555-` prefix, never contacted.

Acceptance tests (`engram/lite.test.ts`):
- `resolveByHandle` finds by exact match
- `getRelationship` returns null for unknown pairs, correct for known
- `listFriends` returns all second-degree persons from a given person id
- Loading the test seed gives exactly 20 persons
- Loading the demo profile with all five handle env vars set substitutes them in; missing any of them fails fast with a clear error
- `.env` is in `.gitignore` and caught by a pre-commit check

### Phase 2 — Core protocol (1 day, the headline phase)

- `stores.ts`: `IntentStore` and `BroadcastStore` SQLite implementations. `tryMatch` is the critical path (see 3.5).
- `humanize.ts`: two modes.
  - Real: Claude Sonnet, temp 0.3, max 50 tokens, prompt templates inlined.
  - Stub: switched on by `process.env.HUMANIZE_STUB === '1'`. Returns deterministic strings like `"[reveal: ${selfIntent.id} <-> ${counterpart.id}]"` so tests can assert exact wiring.
- `protocol.ts`: implements the four functions from 3.4 as shown. Nothing else.

Acceptance tests (`core/protocol.test.ts`):
- `sealedIntent` persists, does not send
- `detectMutual` with no counterpart: `matched=false`, no send calls
- `detectMutual` with counterpart present: `matched=true`, exactly two messenger.send calls, one to each party
- **Race test:** two `detectMutual` calls for the same pair in `Promise.all`. Exactly one returns `matched=true`, exactly one returns `matched=false`, exactly two `messenger.send` calls total
- `filterCandidate`: table-driven test covering all availability states and null relationship
- `quietBroadcast`: given 20 seeded persons (17 suppressable, 3 free), exactly 3 send calls and exactly 17 `recordResponse('silent')` calls
- **No LLM calls:** tests run with `HUMANIZE_STUB=1`. CI fails if `ANTHROPIC_API_KEY` is not blank during `bun test`.

### Phase 3 — Spectrum integration (1 day, blocked on Phase -1)

- `messaging/spectrum.ts`: wraps `spectrum-ts` client. Must satisfy the `Messenger` port.
- `runtime/agent.ts`: CLI entry point. `bun run src/runtime/agent.ts --person-id=<id>` loads that person's identity from engram, boots spectrum-ts against their Apple ID, subscribes to `onReceive`, and calls `detectMutual` whenever a new intent is written to the shared DB. Polling loop on the intents table or SQLite NOTIFY emulation (polling is fine for demo).

Acceptance:
- `bun run dev` produces the exact output contract in 3.6, with two real iMessages delivered via `spectrum-ts` within 1 second of `MATCHED`
- `bun run dev -- --scenario=quiet-broadcast` delivers to exactly 3 handles out of 20 candidates; zero `spectrum-ts` send calls for the 17 suppressed
- End-to-end test (`examples/double-yes.e2e.test.ts`) spawns two agent processes programmatically, produces exactly two real iMessage deliveries. Skipped unless `E2E=1` and real credentials present.

### Phase 4 — Minimal observability (0.25 day, optional)

- Append-only JSONL event log at `.entangle/events.jsonl` with every protocol event (`sealed`, `matched`, `suppressed`, `probed`, `response`, `bubble-up`)
- Small read-only CLI: `bun run tail-events` — prints human-readable event stream
- Single diagram in README showing the flow

Acceptance:
- Running `examples/double-yes.ts` produces a log with the expected ordered events
- `tail-events` output is legible

That is the full build. No Phase 5.

---

## 5. Testing strategy

- Every function in `core/` has a co-located `*.test.ts`
- Tests inject `now`, store, messenger, humanizer via `ProtocolDeps` — never use globals or real clocks
- `messaging/memory.ts` provides `MemoryMessenger` with `sent: Array<{to, message}>` for assertions
- `humanize.ts` stub returns deterministic strings; tests assert on them
- `stores.ts` tests use an in-memory SQLite (`new Database(':memory:')`)
- Race conditions use real SQLite connections (file-backed, `:memory:` does not support concurrent access across connections) with two concurrent transactions
- CI: `bun test` must be green with `ANTHROPIC_API_KEY=""` and `HUMANIZE_STUB=1`

---

## 6. Conventions for Claude Code

- Read SPEC and `CLAUDE.md` at session start
- Work phase by phase; Phase N+1 is not started until Phase N's acceptance tests pass
- Commit at each phase boundary: `phase: <N> - <description>`
- Do not add dependencies outside Section 2 without stating why in the commit message
- Prefer functions + plain objects over classes, with these exceptions: `EngramLite` (owns DB handle), Store implementations (own statements), spectrum-ts client wrapper
- Parse inputs at protocol boundaries with `zod`. Inside `core/`, trust types.
- LLM calls only through `core/humanize.ts`
- Messaging calls only through `src/messaging/`
- Tests live next to the code they test
- Inject `now` everywhere time matters; never call `new Date()` in protocol code
- Never call `new Date()` or `Math.random()` inside `core/` functions — come in through `ProtocolDeps`
- No console.log in library code; use a minimal logger in `core/log.ts`
- Hard secrets rule: never commit `.env`, Apple ID handles, Photon keys, Anthropic keys. Pre-commit hook greps staged files for `+1-`, `+81-`, `sk-ant-`, and `PHOTON_API_KEY=`.

---

## 7. Environment

Single `.env.example` (committed), actual `.env` never committed:

```
# Anthropic — for humanize.ts (real mode, used by bun run dev)
ANTHROPIC_API_KEY=

# Photon Spectrum — get these from app.photon.codes after toggling iMessage on your project
PHOTON_PROJECT_ID=
PHOTON_API_KEY=

# Recipient handles for bun run dev. Phone numbers in E.164 format.
# YURI_HANDLE and ALEX_HANDLE MUST be different Apple IDs — otherwise both
# reveal messages collapse into the same iMessage thread and the split-nature
# of Double Yes is lost. Typical setup: your phone's Apple ID for YURI_HANDLE,
# a secondary Apple ID signed into your Mac's Messages.app for ALEX_HANDLE.
YURI_HANDLE=
ALEX_HANDLE=

# Quiet Broadcast real recipients (3 of 20). Others are synthetic and never contacted.
MIKA_HANDLE=
TARO_HANDLE=
KEN_HANDLE=

# Local
ENTANGLE_DB_PATH=.entangle/db.sqlite
LOG_LEVEL=info

# Test-only. Forces deterministic humanize output. Leave 0 for bun run dev.
HUMANIZE_STUB=0

# End-to-end tests require real credentials + real Apple IDs. Off by default.
E2E=0
```

Exact `spectrum-ts` env variable names confirmed and this section updated at the end of Phase -1.

Exact `spectrum-ts` env names confirmed in Phase -1 and added here.

---

## 8. Stretch (only after Phase 4)

- Third primitive: `threshold` (conditional group commit)
- Additional platforms via `spectrum-ts` (toggle in dashboard, one seed line)
- Swap `engram-lite` for Hexis `engram`

---

## 9. References

- Photon Spectrum: https://photon.codes/spectrum
- Photon dashboard: https://app.photon.codes
- advanced-imessage-kit: https://github.com/photon-hq/advanced-imessage-kit
- Anthropic API: https://docs.claude.com

---

*End of spec.*
