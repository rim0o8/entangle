# Entangle — Specification

> The channel between agents. Where humans can't speak.

This document is the build specification for **Entangle**. It is intended to be read and executed by Claude Code. It describes the architecture, phases, interfaces, and acceptance criteria needed to ship two demo scenarios (`Double Yes`, `Quiet Broadcast`) and a 60-second screen-recordable demo UI.

---

## 1. Context

Entangle is the private, agent-to-agent communication layer that lives between two humans' AI agents. It enables conversations that humans cannot have directly because of social cost: sealed mutual intent, rejection-free broadcast, conditional group commits, asymmetric-risk reconnection.

Entangle is built to run on top of **Spectrum** (Photon's open-source framework for connecting agents to messaging platforms like iMessage, WhatsApp, Telegram, Slack, Discord). Spectrum provides the *where*. Entangle provides the *between*. An embedded simplified identity/memory layer called **engram-lite** provides the *who*.

In production, `engram-lite` is replaced by Hexis's full `engram` (ontology-based person graph). This spec targets `engram-lite` only.

---

## 2. Goals

Ship in a single repo, runnable on a laptop:

1. A working **Entangle protocol** library (TypeScript) with two primitives: `sealedIntent` and `quietBroadcast`.
2. An **engram-lite** identity/memory backend with cross-platform person resolution.
3. A **Spectrum mock adapter** that simulates iMessage, WhatsApp, Telegram UIs on screen for video recording. One real adapter (Telegram) as a bonus to prove cross-platform delivery works.
4. A **split-screen web demo UI** showing two "phones" side by side with a central agent-only layer, animated for 60-second video capture.
5. Two **example scripts** that reproduce the demos end-to-end.

### Non-goals (explicitly out of scope)

- Real iMessage / WhatsApp integration (requires Apple IDs, Meta approval; mock is sufficient for video).
- Multi-tenant SaaS deployment.
- Auth, billing, user onboarding flows.
- Richer engram features (ontology inference, bottom-up domain extraction, scoring routing). Stub out with simple rules.
- Mobile-native UI. Web UI styled as phones is enough for the video.
- Production-grade observability, rate limiting, or cost controls.

---

## 3. Tech stack

| Concern | Choice | Rationale |
|---|---|---|
| Language | TypeScript (strict) | Spectrum is `spectrum-ts`, ecosystem fit |
| Runtime | Node.js 20+ | LTS, fetch built in |
| Package manager | pnpm | Fast, workspace-ready if needed later |
| Storage | SQLite via `better-sqlite3` | Embedded, no services to run, fine for demo |
| LLM | Anthropic Claude (Sonnet) via `@anthropic-ai/sdk` | Minimal LLM use; humanizing final messages only |
| Web UI | Vite + React + Tailwind | Fast dev loop, styleable phone frames |
| Testing | `vitest` | Fast, TS-native |
| Schema validation | `zod` | Runtime type safety at protocol boundaries |
| Lint / format | `biome` | Single tool, fast |

---

## 4. Architecture

### 4.1 Module boundaries

```
src/
├── engram/
│   ├── types.ts          # IdentityGraph interface + domain types
│   ├── lite.ts           # In-SQLite reference implementation
│   └── seed.ts           # Seed data for demos (people, relationships, prefs)
├── core/
│   ├── types.ts          # Intent, Handshake, BroadcastProbe types
│   ├── protocol.ts       # sealedIntent, quietBroadcast primitives
│   ├── agent.ts          # Per-user Agent runtime
│   └── humanize.ts       # LLM call that renders agent decisions as messages
├── spectrum/
│   ├── types.ts          # Channel interface (subset of real Spectrum)
│   ├── mock.ts           # In-memory mock with event emitters
│   └── telegram.ts       # Real Telegram bot adapter (bonus)
├── demo/
│   ├── server.ts         # WebSocket server feeding the web UI
│   └── orchestrator.ts   # Drives scripted demo timelines
└── index.ts              # Public exports
web/
├── index.html
├── src/
│   ├── App.tsx           # Split-screen root
│   ├── PhoneFrame.tsx    # One "phone" with messaging UI
│   ├── EntangleLayer.tsx # Central agent-only animation layer
│   └── demos/
│       ├── DoubleYes.tsx
│       └── QuietBroadcast.tsx
examples/
├── double-yes.ts         # Scripted CLI runner
└── quiet-broadcast.ts    # Scripted CLI runner
```

### 4.2 Dependency direction

```
demo → core → engram (interface)
demo → spectrum
core → engram (interface only)
engram-lite implements engram interface
```

`core` never imports `engram-lite` directly. It takes an `IdentityGraph` instance by dependency injection. This is the contract that lets Hexis's real `engram` plug in later.

### 4.3 Core domain types

```typescript
// engram/types.ts

export type PlatformId = 'imessage' | 'whatsapp' | 'telegram' | 'slack' | 'discord';

export interface PlatformHandle {
  platform: PlatformId;
  handle: string;       // phone number, username, etc.
}

export interface Person {
  id: string;                     // canonical uuid
  displayName: string;
  handles: PlatformHandle[];
  preferredPlatforms: PlatformId[];  // ranked
  preferences: Record<string, unknown>; // free-form; used for demo context
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
  resolveByDescription(description: string, contextPersonId: string): Promise<Person[]>;
  getRelationship(fromId: string, toId: string): Promise<Relationship | null>;
  listFriends(personId: string): Promise<Person[]>;
  preferredPlatformBetween(fromId: string, toId: string): Promise<PlatformId>;
}
```

```typescript
// core/types.ts

export type IntentKind = 'collaborate' | 'reconnect' | 'custom';

export interface SealedIntent {
  id: string;
  ownerPersonId: string;
  targetPersonId: string;
  kind: IntentKind;
  payload: string;           // human's original phrasing
  urgency: 'low' | 'med' | 'high';
  createdAt: Date;
  expiresAt: Date;           // decay
  state: 'sealed' | 'matched' | 'expired' | 'revealed';
}

export interface BroadcastProbe {
  id: string;
  ownerPersonId: string;
  candidatePersonIds: string[];
  payload: string;
  constraints: { when: string; where?: string };
  createdAt: Date;
  responses: Record<string, 'yes' | 'no' | 'silent'>;
}
```

### 4.4 Protocol primitives

```typescript
// core/protocol.ts (signatures)

export async function sealedIntent(
  deps: { graph: IdentityGraph; channel: Channel; store: IntentStore },
  input: { from: Person; to: Person; payload: string; kind: IntentKind }
): Promise<SealedIntent>;

export async function detectMutual(
  deps: { store: IntentStore; graph: IdentityGraph; channel: Channel },
  intent: SealedIntent
): Promise<{ matched: boolean; counterpart?: SealedIntent }>;

export async function quietBroadcast(
  deps: { graph: IdentityGraph; channel: Channel; store: BroadcastStore; humanize: Humanizer },
  input: { owner: Person; candidates: Person[]; payload: string; constraints: BroadcastProbe['constraints'] }
): Promise<BroadcastProbe>;

export async function filterCandidate(
  deps: { graph: IdentityGraph },
  ownerId: string,
  candidateId: string,
  context: BroadcastProbe
): Promise<'suppress' | 'deliver'>; // silent suppression happens HERE
```

### 4.5 Channel abstraction (Spectrum subset)

```typescript
// spectrum/types.ts

export interface Channel {
  send(to: PlatformHandle, message: { text: string; kind?: 'prompt' | 'notice' | 'confirm' }): Promise<void>;
  onReceive(handler: (from: PlatformHandle, text: string) => Promise<void>): void;
}
```

Mock and Telegram implementations both satisfy `Channel`. The real `spectrum-ts` later replaces these.

---

## 5. Demo scenarios (acceptance specs)

These are the executable contracts. When both scripts produce the specified event timelines, the project is demo-ready.

### 5.1 Double Yes

Seed data:
- Person A: "Yuri" with `imessage` handle.
- Person B: "Alex" with `whatsapp` handle.
- Relationship: `met-once`, lastContactAt = 2 days ago, tag `[conf]`.

Script:

```typescript
// examples/double-yes.ts (pseudocode)
const yuri = await graph.resolveByHandle({ platform: 'imessage', handle: '+81-xxx' });
const alex = await graph.resolveByHandle({ platform: 'whatsapp', handle: '+1-xxx' });

// t=0: Yuri submits sealed intent
const i1 = await sealedIntent(deps, { from: yuri, to: alex, payload: "I'd want to work with Alex.", kind: 'collaborate' });
assert(i1.state === 'sealed');
assert(noMessagesSentToAlex);

// t=2h: Alex submits reciprocal
const i2 = await sealedIntent(deps, { from: alex, to: yuri, payload: "Would love to build something with Yuri.", kind: 'collaborate' });

// detectMutual triggers
const r = await detectMutual(deps, i2);
assert(r.matched === true);

// Both humans receive simultaneous reveal
assertBothChannelsReceivedWithinMs(500);
```

Expected event log (what the demo UI animates):

1. `sealed` event for Yuri -> Alex
2. `sealed` event for Alex -> Yuri
3. `mutual-detected` event (center stage animation)
4. Two `reveal` events, timestamp delta < 500ms
5. Both humans respond `yes`
6. `thread-opened` event

### 5.2 Quiet Broadcast

Seed data:
- Person A: "Yuri", owner.
- 20 candidate Persons across mixed platforms, with diverse preference/state data:
  - 10 with `availability: 'busy'` (should be suppressed silently)
  - 5 with `availability: 'traveling'` (suppressed)
  - 2 with `availability: 'declined-recently'` (suppressed)
  - 3 with `availability: 'free'`, preferences include `loves: jazz`

Script:

```typescript
// examples/quiet-broadcast.ts (pseudocode)
const probe = await quietBroadcast(deps, {
  owner: yuri,
  candidates: twentyFriends,
  payload: "Jazz tonight, anyone?",
  constraints: { when: 'tonight', where: 'tokyo' }
});

// 17 candidates should have NO message sent to their humans
assertNoMessagesSentTo(seventeenSuppressed);

// 3 candidates should have received a gentle probe
assertMessagesSentTo(threeFree);

// Assume 2 of 3 respond yes
const yes = [mika, taro];
const no = [ken];

// Only yes responses bubble to Yuri
assertYuriReceivedOnlyFromYesResponders();
```

Expected event log:

1. `broadcast-started` event with 20 candidates
2. 17 `suppressed` events (silent, tagged with suppression reason)
3. 3 `probed` events
4. 2 `yes` responses
5. 1 `no` response (not surfaced to Yuri)
6. `bubble-up` event to Yuri with 2 yes'es
7. `thread-opened` with 3 humans

---

## 6. Phases and acceptance criteria

Each phase must pass its acceptance criteria before moving on. Claude Code should checkpoint (commit) at each phase boundary.

### Phase 0 — Scaffolding (0.5 day)

Tasks:
- `pnpm init`, tsconfig strict, biome config, vitest setup
- Install dependencies: `better-sqlite3`, `zod`, `@anthropic-ai/sdk`, `nanoid`, `ws`
- Web: Vite + React + Tailwind skeleton
- CI-less: just `pnpm test`, `pnpm dev:web`, `pnpm example:doubleyes`, `pnpm example:quietbroadcast` scripts

Acceptance:
- `pnpm test` runs and passes an empty test suite
- `pnpm dev:web` serves a blank Tailwind page
- Example scripts exit cleanly with a `console.log("not yet")`

### Phase 1 — engram-lite (1 day)

Tasks:
- Implement `IdentityGraph` interface and SQLite-backed `EngramLite` class
- Implement `resolveByDescription`: simple keyword match across names, tags, preferences. No LLM.
- Implement `preferredPlatformBetween`: ranked by `preferredPlatforms` intersection with other person's `handles`
- Seed data loader from a `seed.json` (checked into repo)

Acceptance:
- Unit tests pass: resolve person by handle across 3 platforms, get relationship, list friends, preferred platform resolution
- Seed data loads 20+ people with at least 5 platforms represented

### Phase 2 — Entangle core (1.5 days)

Tasks:
- `SealedIntent` storage (SQLite)
- `sealedIntent` primitive: stores intent, does NOT send anything
- `detectMutual`: on every new intent, query for reverse intent; if found, emit `mutual-detected`
- `BroadcastProbe` storage
- `quietBroadcast` primitive: calls `filterCandidate` for each candidate, silently drops suppressed ones, sends probes to remaining
- `filterCandidate`: deterministic rules using engram person state (bandwidth, availability, relationship, last contact recency)
- `humanize`: LLM call that turns a machine-level decision into a natural human message. Keep it < 50 tokens. Temperature 0.3. Use Claude Sonnet.
- Full event log (append-only, in-memory ring + emitted on an `EventEmitter`) for demo UI to subscribe to

Acceptance:
- `examples/double-yes.ts` runs end to end, produces the exact event log specified in 5.1
- `examples/quiet-broadcast.ts` runs end to end, produces the exact event log specified in 5.2
- Unit tests cover suppression logic, mutual detection race conditions (two intents submitted simultaneously must match exactly once)

### Phase 3 — Spectrum adapter (1 day)

Tasks:
- `Channel` interface
- `MockChannel`: fully in-memory, emits events the web UI subscribes to; supports multiple simultaneous "platforms" (iMessage, WhatsApp, Telegram, Slack, Discord) distinguishable by `PlatformId`
- `TelegramChannel` (bonus, optional for MVP): uses `node-telegram-bot-api`, single bot that dispatches to users keyed by telegram user id. Gated by `TELEGRAM_BOT_TOKEN` env var; gracefully skip if absent.

Acceptance:
- Examples from Phase 2 now send through `MockChannel` and emit platform-tagged events
- If `TELEGRAM_BOT_TOKEN` is set, running an example actually delivers messages to real Telegram users

### Phase 4 — Demo UI (2 days)

Tasks:
- WebSocket server in `src/demo/server.ts` that streams event log to the web UI
- `demo/orchestrator.ts` runs a scripted timeline (configurable pause between events) so the video has cinematic beats
- `web/App.tsx` split-screen layout: left phone, center `EntangleLayer`, right phone
- `PhoneFrame` component: renders messages in platform-appropriate style (iMessage blue/gray, WhatsApp green, Telegram light blue). Use CSS only, no real iMessage SDK.
- `EntangleLayer` component: dark, subtle; renders sealed envelope icons for each intent, animates envelope collision when `mutual-detected` fires, renders gray "suppressed" avatars and green "delivered" avatars for broadcast
- Keyboard shortcuts to play/pause/scrub demo timeline (useful for video recording)
- Two mounted scenes: `DoubleYes` and `QuietBroadcast`, switchable by URL path

Acceptance:
- Running `pnpm dev:web` and navigating to `/double-yes` plays the Double Yes demo with smooth animation, total duration ~60s
- Same for `/quiet-broadcast`
- Screen-recording the browser window produces video suitable for the Photon application (clean typography, no browser chrome visible if using presentation mode)

### Phase 5 — Polish and README (0.5 day)

Tasks:
- README with project summary, architecture diagram, demo video embeds, quickstart
- `CLAUDE.md` for future sessions: conventions, common pitfalls
- Record both demo videos, 60s each, 1080p
- Create 2-minute combined video for the Photon application

Acceptance:
- README is complete and passes a "cold reader" sanity check (open repo, understand in 2 minutes)
- Two videos produced and reviewed by Yuri
- Public GitHub repo ready (private until Photon submission)

---

## 7. Conventions for Claude Code

- Read this spec and `CLAUDE.md` at the start of every session
- Work phase by phase; do not start Phase N+1 until Phase N's acceptance tests pass
- Commit at the end of every phase with message `phase: <N> - <short description>`
- Never introduce a dependency not listed in section 3 without flagging in the commit message
- Prefer functions + plain objects over classes unless the object owns significant lifecycle state (the one exception is `EngramLite` holding a DB connection)
- All protocol boundaries (between `core`, `engram`, `spectrum`) use `zod` schemas; parse at entry, trust inside
- LLM calls: always go through `core/humanize.ts`, never scattered; log prompts and responses to `.entangle/llm.log` in dev mode
- Tests live next to the code they test (`foo.ts` + `foo.test.ts`)
- No global state. Pass dependencies explicitly (`deps` pattern shown in 4.4)

---

## 8. Environment

`.env.example`:

```
ANTHROPIC_API_KEY=sk-...
TELEGRAM_BOT_TOKEN=                    # optional
ENTANGLE_DB_PATH=.entangle/db.sqlite
LOG_LEVEL=info
```

No `.env` is committed.

---

## 9. Stretch goals (after demo ships)

Do NOT build these unless all Phase 0-5 is green:

- Third primitive: `threshold` (from the Threshold scenario)
- Real iMessage adapter via BlueBubbles or similar
- Agent-to-agent cryptographic handshake (so agents from different Entangle installations can trust each other)
- Plug Hexis's full `engram` in place of `engram-lite`

---

## 10. Reference

- Photon / Spectrum: https://photon.codes
- Photon Residency: https://photon.codes/residency
- Anthropic API docs: https://docs.claude.com
- `spectrum-ts` (check `photon-hq` org on GitHub for current package surface; adapt `Channel` interface to match when wiring the real thing)

---

*End of spec.*
