# Entangle — Specification v2

> The channel between agents. Where humans can't speak.

This document is the build specification for **Entangle**. It is the submission weapon for Photon Residency Chapter II (May 18–25, 2026). The residency admits roughly 6 agentic developers. The primary admissions signal is a short demo video. Every choice in this spec is reverse-engineered from that fact.

---

## 1. Context

Entangle is the private, agent-to-agent communication layer between two humans' AI agents. It enables conversations humans cannot have directly because of social cost: sealed mutual intent, rejection-free broadcast, asymmetric-risk reconnection, conditional group commits.

Entangle is built on **Spectrum** (Photon's unified messaging SDK, `spectrum-ts`). The Entangle protocol is platform-agnostic; this demo ships on **iMessage** because iMessage is Photon's deepest moat (Ditto, 40k+ users; `imessage-kit` is Photon's flagship OSS). Demoing on iMessage maximizes Photon-stack authenticity for residency submission.

An embedded simplified identity/memory layer called **engram-lite** provides person resolution. In production, `engram-lite` will be swapped for Hexis's full `engram` (ontology-based person graph); this spec targets `engram-lite` only.

---

## 2. Goals (priority-ordered)

Photon reviewers will watch a video before reading anything else. Success = admission, which depends on the video. All goals below support that.

1. **A 60-second `Double Yes` demo video** — the primary admissions artifact.
2. **A 60-second `Quiet Broadcast` demo video** — the second act.
3. **A 2-minute combined cut** submitted to the application form.
4. **A README** that a Photon reviewer can parse in 90 seconds and understand what Entangle is.
5. **A public GitHub repo** that runs end-to-end on any Mac with a Photon account, proving the demo is not smoke and mirrors.

Code artifacts exist to serve these five goals. When a technical decision conflicts with a submission goal, the submission goal wins.

### Non-goals

- Additional platforms (WhatsApp, Telegram, Slack, Discord).
- Mock messaging UIs.
- Multi-tenant SaaS, auth, billing.
- Rich engram features (ontology inference, bottom-up domain extraction, scoring routing).
- Production observability, rate limits, cost controls.

---

## 3. Tech stack

| Concern | Choice | Notes |
|---|---|---|
| Language | TypeScript strict | |
| Runtime | Node.js 20+ | |
| Package manager | pnpm | |
| Messaging SDK | `spectrum-ts` | Verify exact npm package name at Phase -1. Fallback: `@photon-ai/advanced-imessage-kit`. |
| Platform | iMessage (macOS-hosted via Spectrum) | |
| Storage | SQLite via `better-sqlite3` | engram-lite only |
| LLM | Anthropic Claude Sonnet via `@anthropic-ai/sdk` | `humanize.ts` only; deterministic stub in test mode |
| Web UI | Vite + React + Tailwind | Transparent-background overlay only |
| Testing | `vitest` | |
| Schema | `zod` | at protocol boundaries |
| Lint / format | `biome` | |
| Video capture (iPhone) | QuickTime Player + USB | native macOS |
| Video capture (overlay) | OBS Studio browser source | transparent background preserved |
| Video compositing | DaVinci Resolve (free) | alpha-channel support |

---

## 4. Architecture

### 4.1 Module boundaries

```
src/
├── engram/
│   ├── types.ts          # IdentityGraph interface + domain types
│   ├── lite.ts           # SQLite reference implementation
│   └── seed.ts           # Seed data loader (test + demo profiles)
├── core/
│   ├── types.ts          # Intent, BroadcastProbe, Messenger, stores, humanizer
│   ├── protocol.ts       # sealedIntent, quietBroadcast primitives
│   ├── agent.ts          # Per-user Agent runtime
│   ├── humanize.ts       # LLM-backed message rendering (with stub mode)
│   └── stores.ts         # IntentStore, BroadcastStore SQLite impls
├── messaging/
│   ├── client.ts         # spectrum-ts client bootstrap from env
│   ├── spectrum.ts       # Messenger implementation on spectrum-ts
│   └── test.ts           # In-memory Messenger for Phase 2 tests
├── runtime/
│   ├── host.ts           # Process-per-agent orchestration
│   └── ipc.ts            # Event bus between agent processes (mutual detection)
├── demo/
│   ├── server.ts         # WebSocket server streaming event log
│   └── orchestrator.ts   # Scripted timeline driver w/ wall-clock simulation
└── index.ts
web/                       # Overlay UI (transparent background)
examples/
├── double-yes.ts
└── quiet-broadcast.ts
```

`runtime/` is new in v2 and addresses the multi-agent gap (see 4.5).

### 4.2 Dependency direction

```
examples → runtime → core → engram (interface only)
runtime → messaging → spectrum-ts
core → engram (interface only)
engram-lite implements engram interface
messaging/spectrum.ts implements core.Messenger port
```

`core` never imports spectrum-ts. Tests use `messaging/test.ts`.

### 4.3 Core domain types

```typescript
// engram/types.ts

export type PlatformId = 'imessage'; // enum, extensible

export interface PlatformHandle {
  platform: PlatformId;
  handle: string;
}

export interface Person {
  id: string;
  displayName: string;
  handles: PlatformHandle[];
  preferredPlatforms: PlatformId[];
  preferences: Record<string, unknown>;
  availability?: 'free' | 'busy' | 'traveling' | 'declined-recently'; // used by filterCandidate
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
  payload: string;
  urgency: 'low' | 'med' | 'high';
  createdAt: Date;
  expiresAt: Date;
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

export interface IntentStore {
  put(intent: SealedIntent): Promise<void>;
  findReverse(intent: SealedIntent): Promise<SealedIntent | null>;
  get(id: string): Promise<SealedIntent | null>;
  setState(id: string, state: SealedIntent['state']): Promise<void>;
}

export interface BroadcastStore {
  put(probe: BroadcastProbe): Promise<void>;
  recordResponse(probeId: string, personId: string, response: 'yes' | 'no' | 'silent'): Promise<void>;
  get(id: string): Promise<BroadcastProbe | null>;
}

export interface Humanizer {
  renderReveal(intent: SealedIntent, counterpart: SealedIntent): Promise<string>;
  renderProbe(probe: BroadcastProbe, candidate: Person): Promise<string>;
  renderBubbleUp(probe: BroadcastProbe, yesResponders: Person[]): Promise<string>;
}

export interface Messenger {
  send(to: PlatformHandle, message: { text: string; kind?: 'prompt' | 'notice' | 'confirm' }): Promise<void>;
  onReceive(handler: (from: PlatformHandle, text: string) => Promise<void>): void;
}
```

### 4.4 Protocol primitives

```typescript
// core/protocol.ts (signatures)

export async function sealedIntent(
  deps: { graph: IdentityGraph; messenger: Messenger; store: IntentStore },
  input: { from: Person; to: Person; payload: string; kind: IntentKind }
): Promise<SealedIntent>;

export async function detectMutual(
  deps: { store: IntentStore; graph: IdentityGraph; messenger: Messenger; humanize: Humanizer },
  intent: SealedIntent
): Promise<{ matched: boolean; counterpart?: SealedIntent }>;

export async function quietBroadcast(
  deps: { graph: IdentityGraph; messenger: Messenger; store: BroadcastStore; humanize: Humanizer },
  input: { owner: Person; candidates: Person[]; payload: string; constraints: BroadcastProbe['constraints'] }
): Promise<BroadcastProbe>;

export async function filterCandidate(
  deps: { graph: IdentityGraph },
  ownerId: string,
  candidateId: string,
  context: BroadcastProbe
): Promise<'suppress' | 'deliver'>;
```

### 4.5 Multi-agent runtime

Entangle's core protocol works by two independent agents (each acting on behalf of one human) exchanging state. This is a concurrency and identity story, not a single-process simulation.

**Decision:** for the demo, we run two Node processes on one Mac, each owning a different Apple ID via `spectrum-ts`. Communication between them happens through a shared SQLite database (both processes point to the same `ENTANGLE_DB_PATH`, and `IntentStore.findReverse` queries surface counterpart intents regardless of which process wrote them). This is sufficient for Double Yes and authentic to the architecture.

Phase -1 verifies that `spectrum-ts` supports targeting multiple Apple IDs on the same host, either via multiple client instances or via an account parameter per call. If neither is supported, fallback is two Macs.

`runtime/host.ts` exposes a CLI: `pnpm agent start --person-id=yuri` / `--person-id=alex`. This spawns one process per agent.

---

## 5. Demo scenarios (storyboard-locked)

These storyboards are the acceptance contract. Code exists to make these exact shots possible.

### 5.1 Double Yes — 60-second storyboard

**Pitch:** "Neither spoke first. Both won."

**Setting:** Yuri (iPhone 1, iMessage, Apple ID A) and Alex (iPhone 2, iMessage, Apple ID B). Both held by Yuri during shoot. Running on two terminal processes on the same Mac.

| Sec | Left frame (Yuri) | Center overlay | Right frame (Alex) | Notes |
|---|---|---|---|---|
| 0–3 | Static iMessage home | Title: *"Entangle"* | Static iMessage home | Cold open |
| 3–5 | — | Subtitle: *"A conversation humans can't have."* | — | |
| 5–12 | Yuri types to her agent: *"I'd want to work with Alex."* → sends | sealed-envelope icon materializes on Yuri's side | Alex's screen static | Envelope has lock icon |
| 12–16 | Yuri's agent replies: *"Stored. Sealed."* | envelope drifts toward center, stops, stays | — | "Time passes" subtle fade |
| 16–18 | — | Clock overlay: *"2 hours later"* | — | Temporal cue, brief |
| 18–25 | — | sealed-envelope icon materializes on Alex's side | Alex types to his agent: *"Would love to build with Yuri."* | Envelope mirrors Yuri's |
| 25–28 | — | Alex's envelope drifts toward center | Alex's agent: *"Stored. Sealed."* | |
| 28–33 | — | Two envelopes collide, flash of light, replaced by *"mutual intent detected."* | — | Aha moment |
| 33–40 | Incoming iMessage bubble (blue): *"Alex independently said the same. Open a thread?"* | — | Incoming iMessage bubble (blue): *"Yuri independently said the same. Open a thread?"* | Simultaneous reveal, arrivals within 500ms |
| 40–45 | Yuri taps Yes | — | Alex taps Yes | |
| 45–55 | New thread opens with both on it, agents post opening line | — | Same thread from Alex's side | |
| 55–60 | Black frame, tagline: *"Neither spoke first. Both won."* + small "Built on Spectrum" | — | Black frame | |

Real delivery assertions (Phase 3 acceptance):

```typescript
// examples/double-yes.ts
const yuri = await graph.resolveByHandle({ platform: 'imessage', handle: '+81-xxx' });
const alex = await graph.resolveByHandle({ platform: 'imessage', handle: '+1-xxx' });

const i1 = await sealedIntent(deps, { from: yuri, to: alex, payload: "...", kind: 'collaborate' });
assert(i1.state === 'sealed');
await assertIMessageSilentFor(alex, 1000); // no blue bubble on Alex's phone

// simulated wall-clock advance
await orchestrator.advanceTime({ hours: 2 });

const i2 = await sealedIntent(deps, { from: alex, to: yuri, payload: "...", kind: 'collaborate' });
const r = await detectMutual(deps, i2);
assert(r.matched === true);

await assertBothPhonesReceivedWithinMs(500);
```

### 5.2 Quiet Broadcast — 60-second storyboard

**Pitch:** "20 asked. 17 never knew. 2 showed up. 0 rejections."

**Physical reality:** 20 persons seeded in engram-lite. 17 have fake Apple IDs that will never be contacted (their `availability` flags guarantee suppression). 3 have real Apple IDs (Yuri's second device, plus two cooperating friends with scheduled appearances). Only 3 real phones are needed.

| Sec | Left frame (Yuri) | Center overlay | Right (multi-avatar grid) | Notes |
|---|---|---|---|---|
| 0–4 | Yuri to agent: *"Jazz tonight, anyone? Don't want to push."* | — | Empty grid | |
| 4–8 | Agent: *"Low-urgency probe to 20 friends. OK?"* Yuri: *OK* | — | 20 avatars materialize, gray, each with small platform icon (all iMessage here) | |
| 8–14 | — | *"17 agents decline on their human's behalf."* | 17 avatars stay gray, small *"not asked"* captions flicker in/out | silent suppression shown |
| 14–22 | — | *"3 humans get a quiet question."* | 3 avatars light up blue (delivered) | real phones show incoming iMessage |
| 22–30 | — | — | 3 lit avatars, one showing real iMessage interface: Mika receiving *"Yuri's thinking jazz tonight. No pressure. You in?"* | cut to real phone Mika |
| 30–38 | Incoming from Mika: *"Yes"* then shortly Taro: *"Yes"* | — | Mika and Taro avatars turn green, Ken stays blue then briefly red (no) then fades | |
| 38–46 | Yuri sees *"Mika and Taro are in. Blue Note, 21:30?"* from agent | — | green-highlighted Mika and Taro, Ken faded | Only yes responses bubbled up |
| 46–54 | 3-person thread opens, all confirm | — | — | |
| 54–60 | Black frame: *"20 asked. 17 never knew. 2 showed up. 0 rejections."* + "Built on Spectrum" | | | |

Real delivery assertions (Phase 3 acceptance):

```typescript
// examples/quiet-broadcast.ts
const probe = await quietBroadcast(deps, {
  owner: yuri, candidates: twentyFriends, payload: "Jazz tonight, anyone?",
  constraints: { when: 'tonight', where: 'tokyo' }
});

// 17 have availability in {busy, traveling, declined-recently} → suppressed
await assertIMessageSilentFor(seventeenSuppressed, 2000);
// 3 have availability='free' → real iMessage delivered
await assertIMessageReceivedBy(threeFree, 2000);
```

### 5.3 Wall-clock simulation requirement

`demo/orchestrator.ts` exposes:

```typescript
interface Orchestrator {
  advanceTime(delta: { ms?: number; hours?: number; days?: number }): Promise<void>;
  play(scenario: 'double-yes' | 'quiet-broadcast'): Promise<void>;
  pause(): void;
  scrub(to: number): void; // seconds into the timeline
  reset(): Promise<void>;
}
```

Time advancement is simulated (no actual waiting) when driving scripted tests. For video recording, the orchestrator uses real time between beats, configurable per scenario.

---

## 6. Phases

Phase -1 starts **Day 0** and runs in parallel with Phases 0–2. Phases 0–2 do not depend on Phase -1.

### Phase -1 — Photon onboarding + multi-agent runtime verification (Day 0, ~3 hours)

Tasks:
- Register at `app.photon.codes`, create project, toggle iMessage
- Install `spectrum-ts`, verify exact package name, update this SPEC if different
- Read spectrum-ts docs (Photon Discord if `docs.photon.codes` is gated)
- **Verify multi-agent runtime:** can two Node processes on one Mac each drive a different Apple ID via spectrum-ts? Document the answer.
- Set up Yuri's Apple ID A and Apple ID B (primary + secondary on same Mac, or second physical device)
- Draft `seed.json` with real Apple ID handles redacted, real handles injected from `.env.local`

Acceptance:
- `pnpm smoke:imessage` runs. A test iMessage is sent from Apple ID A to Apple ID B via spectrum-ts, and the reply is received on A.
- Written decision (in `docs/runtime-decision.md`) on multi-agent strategy: 1 Mac + 2 processes + 2 Apple IDs, or 2 Macs, or fallback.

### Phase 0 — Scaffolding (0.5 day)

- `pnpm init`, tsconfig strict, biome, vitest
- Install: `spectrum-ts`, `better-sqlite3`, `zod`, `@anthropic-ai/sdk`, `nanoid`, `ws`
- Web scaffold: Vite, React, Tailwind, transparent background
- Scripts: `test`, `dev:web`, `example:doubleyes`, `example:quietbroadcast`, `smoke:imessage`, `agent`, `demo:play`

Acceptance:
- `pnpm test` passes empty suite
- `pnpm dev:web` renders blank transparent page
- All example and smoke scripts exit cleanly with a placeholder log

### Phase 1 — engram-lite (1 day) — does not need messaging

- `IdentityGraph` interface + SQLite-backed `EngramLite`
- `resolveByDescription`: keyword match (no LLM)
- `preferredPlatformBetween`: returns `'imessage'` always for now
- `seed.ts` loads two profiles:
  - `test`: 20 synthetic persons with fake `+1-555-xxxx` handles, availability distributed as 5.2 requires
  - `demo`: same 20 persons but 3 marked `real: true`, their handles read from `.env.local` (real Apple IDs), not committed

Acceptance:
- Unit tests: handle resolution, relationship lookup, friend list, preferred platform
- `seed load --profile=test` and `seed load --profile=demo` both succeed
- `.env.local` and any file containing real Apple IDs are in `.gitignore` and caught by a pre-commit check

### Phase 2 — Entangle core (1.5 days) — does not need messaging

- `stores.ts`: `IntentStore`, `BroadcastStore` SQLite implementations
- `sealedIntent`: stores only, never sends
- `detectMutual`: on new intent, query reverse; if found, emit `mutual-detected`, call `humanize.renderReveal`, call `messenger.send` for both sides simultaneously
- `quietBroadcast`: iterate candidates, `filterCandidate` → silent-drop or `messenger.send` of humanized probe
- `filterCandidate`: deterministic rules based on `Person.availability`
- `humanize`: Claude Sonnet, temp 0.3, max 50 tokens. **Test mode** (`NODE_ENV=test` or `HUMANIZE_STUB=1`) returns deterministic canned strings. Tests NEVER hit the Claude API.
- Event log (append-only, EventEmitter) streaming to `demo/server.ts`

Acceptance:
- `examples/double-yes.ts` against in-memory `Messenger` and stub humanizer emits the exact event log from 5.1
- `examples/quiet-broadcast.ts` same for 5.2
- Race-condition test: two intents submitted in parallel match exactly once (no duplicate reveals, no missed reveals)
- CI run shows zero calls to Claude API during `pnpm test`

### Phase 3 — Spectrum integration (1 day) — blocked on Phase -1

- `messaging/client.ts`: bootstrap spectrum-ts from `.env`
- `messaging/spectrum.ts`: implement `Messenger` port
- `runtime/host.ts`: CLI to start an agent process keyed by `--person-id`
- `runtime/ipc.ts`: shared-SQLite-based event bus between agents (both processes watch the same DB for new intents)

Acceptance:
- Start `pnpm agent start --person-id=yuri` in one terminal, `pnpm agent start --person-id=alex` in another
- Driving `examples/double-yes.ts` triggers a real mutual-detection, both Apple IDs receive real iMessage within 500ms
- Driving `examples/quiet-broadcast.ts` delivers real iMessage to the 3 real Apple IDs only; 17 synthetic candidates get zero messages (verified by absence of spectrum-ts send calls for those handles)

### Phase 4 — Overlay UI (1.5 days)

- WebSocket server in `src/demo/server.ts` streams event log
- `demo/orchestrator.ts` with wall-clock simulation (see 5.3)
- Overlay renders per the 5.1 and 5.2 storyboards: sealed envelopes, collision flash, 20-avatar grid with state transitions, clock overlay
- Transparent background, OBS browser-source compatible
- Keyboard shortcuts: space=play/pause, arrow=scrub, R=reset

Acceptance:
- `/double-yes` and `/quiet-broadcast` each play a ~60s sequence matching the storyboards
- OBS captures overlay with alpha channel preserved
- Video editor composites overlay over two iPhone recordings cleanly (tested in DaVinci Resolve)

### Phase 5 — Video production and README (1 day)

Shoot day:
- QuickTime Player screen-mirrors iPhone 1 (Yuri) and iPhone 2 (Alex, or Apple ID B's device)
- OBS captures overlay
- Orchestrator drives scripted timeline synchronized with live manual taps on both phones (rehearse 3×)
- Audio: optional voiceover recorded separately, room-mic quality is fine
- Talking head: 3-second intro (Yuri's face saying one sentence about Entangle) and 3-second outro ("Would love to build with you at Photon.")

Editing:
- Two 60-sec cuts: Double Yes, Quiet Broadcast
- One 2-min combined cut with a brief transition
- Export: 1080p 30fps H.264, under 100 MB each
- Captions burned in (reviewers may watch muted)
- Uploaded to YouTube (unlisted) and included as direct-download MP4 in repo

README:
- See Section 12

Acceptance:
- Three videos produced, reviewed by Yuri, under 100 MB, readable with sound off
- README satisfies the 90-second parse test (see 12.2)
- Repo tagged `v0.1-photon-submission` and ready to flip public on submission day

---

## 7. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `spectrum-ts` does not support multiple Apple IDs in one host | Medium | High | Phase -1 verifies. Fallback: two physical Macs. Rent / borrow a second if needed. |
| `spectrum-ts` package name or API differs from marketing | Medium | Medium | Phase -1 verifies. `Messenger` port isolates changes. Secondary fallback: `@photon-ai/advanced-imessage-kit` directly. |
| `docs.photon.codes` gated | Confirmed (403 at authoring) | Low | Join Photon Discord. |
| iMessage macOS permissions | Medium | Medium | Phase -1 smoke test flushes this out. |
| spectrum-ts lacks `onReceive` semantics we need | Low | Medium | Poll message history inside `messaging/spectrum.ts`; core unaffected. |
| 3 cooperating friends unavailable for shoot | Low | Medium | Use 3 of Yuri's own Apple IDs or schedule shoot with redundancy. Friends only appear in 5.2 yes/no responses, ~10 seconds of screen time. |
| Video shoot goes over budget day | Medium | Medium | Rehearse 3× before record. Orchestrator allows multiple takes without code changes. |
| Real Apple IDs accidentally committed to repo | Medium | High | `.env.local` in `.gitignore`, pre-commit hook that greps staged files for `+1-`, `+81-` against an allow-list. |

---

## 8. Conventions for Claude Code

- Read SPEC and `CLAUDE.md` at the start of every session
- Work phase by phase; do not start Phase N+1 until Phase N's acceptance tests pass
- Phase -1 runs in parallel; blocks Phase 3 and Phase 5 shoot
- Commit at the end of every phase: `phase: <N> - <short description>`
- Never add a dependency not in Section 3 without flagging in the commit message
- Prefer functions + plain objects over classes unless the object owns lifecycle state
- All protocol boundaries use `zod`; parse at entry, trust inside
- LLM calls only through `core/humanize.ts`. **Never call Claude API in tests.** `HUMANIZE_STUB=1` forces deterministic output.
- All messaging calls only through `src/messaging/`
- Tests next to the code they test
- No global state; pass `deps` explicitly
- **Hard secrets rule:** never commit `.env`, `.env.local`, Apple ID credentials, Anthropic keys, Photon keys. Pre-commit hook enforces.

---

## 9. Environment

`.env.example` (committed):

```
ANTHROPIC_API_KEY=sk-...
PHOTON_PROJECT_ID=
PHOTON_API_KEY=
ENTANGLE_DB_PATH=.entangle/db.sqlite
LOG_LEVEL=info
HUMANIZE_STUB=0
```

`.env.local` (never committed, read by `seed.ts` for `demo` profile):

```
YURI_APPLE_ID=+81-xxx...
ALEX_APPLE_ID=+1-xxx...
MIKA_APPLE_ID=+81-xxx...
TARO_APPLE_ID=+81-xxx...
KEN_APPLE_ID=+81-xxx...
```

Exact spectrum-ts env variable names confirmed in Phase -1.

---

## 10. Stretch goals (only after Phase 5 completes)

- Add Telegram, WhatsApp, Slack via `spectrum-ts` (toggle in Photon dashboard + seed update, no protocol change)
- Third primitive: `threshold` (conditional group commit)
- Agent-to-agent cryptographic handshake across Entangle installations
- Swap `engram-lite` for Hexis's full `engram`
- Ship a teaser tweet thread day-of-submission

---

## 11. References

- Photon Spectrum: https://photon.codes/spectrum
- Photon dashboard: https://app.photon.codes
- Photon Residency: https://photon.codes/residency
- advanced-imessage-kit: https://github.com/photon-hq/advanced-imessage-kit
- Ditto (iMessage showcase, 40k+ users): photon.codes
- Anthropic API: https://docs.claude.com

---

## 12. Submission package

The submission is not just code. It is the set of artifacts Photon reviewers encounter, in the order they encounter them.

### 12.1 Artifacts and order

1. **Application form text** — already locked (see chat history for current answers to "What have you built", "What interests you about Photon"). Final review pass before submission.
2. **2-minute video** — combined Double Yes + Quiet Broadcast. Uploaded to the form + linked from README.
3. **GitHub repo URL** — public-ready at submission time, private until then.
4. **README** — what reviewer sees on arriving at the repo.
5. **SPEC.md** — what a future builder or curious reviewer sees when digging in.

### 12.2 README acceptance test (90-second parse)

A cold reader (Photon resident, never heard of Entangle) must, within 90 seconds of landing on the repo, be able to answer:

- What does Entangle do? (one sentence)
- What does it look like? (see video, top of README)
- How does it use Photon? (one paragraph)
- Can I run it myself? (yes, quickstart visible without scrolling past fold)

If any of these fail during Yuri's own test (read the README cold, time it), rewrite.

### 12.3 README structure (template)

```markdown
# Entangle

> The channel between agents. Where humans can't speak.

[embedded 2-min video]

## What is this?
[130-word manifesto from application text]

## Demo
- Double Yes — [60s video]
- Quiet Broadcast — [60s video]

## How it works
[single architecture diagram: two agents, shared engram-lite, Spectrum messaging, Entangle protocol between]
[2 paragraphs]

## Quickstart
```bash
# clone, install
pnpm install

# configure
cp .env.example .env   # fill in Anthropic + Photon keys
cp .env.local.example .env.local  # fill in Apple IDs

# run
pnpm agent start --person-id=yuri   # terminal 1
pnpm agent start --person-id=alex   # terminal 2
pnpm example:doubleyes
```

## Built on Photon Spectrum
Entangle is a protocol. Spectrum is where it lives. Entangle is demoed on iMessage because iMessage is Photon's deepest moat. Adding Telegram, WhatsApp, or Slack is a Photon-dashboard toggle away; the protocol does not change.

## Roadmap
[stretch goals from Section 10]

## Credits
Built by [Yuri] at Hexis. engram is Hexis's production identity graph; engram-lite here is a simplified reference implementation.
```

### 12.4 Submission day checklist

- [ ] All phases green
- [ ] Video uploaded to YouTube (unlisted) and included as MP4 in repo
- [ ] Repo flipped to public, tagged `v0.1-photon-submission`
- [ ] Application form text pasted, video URL pasted, repo URL pasted
- [ ] Cold-read the README one last time
- [ ] Submit
- [ ] Teaser tweet (stretch)

---

## 13. Open questions to resolve before Day 0

These are decisions Yuri should settle before code begins. Listed here because they are not Claude Code's to make.

1. **Shoot logistics.** One Mac + two Apple IDs on two phones (1 Yuri primary, 1 Yuri secondary) vs. two Macs. Phase -1 gives data to decide.
2. **Three real recipients for Quiet Broadcast.** Lined up or not? If friends cooperating, schedule a 30-minute window.
3. **Yuri's face on camera.** Talking-head intro/outro is recommended for admissions. Confirm comfort level.
4. **Deadline.** The `Final decisions will be announced April 18th` language on the residency page is ambiguous (possibly stale). Confirm actual submission deadline via Photon Discord or direct contact (`daniel@photon.codes`) before assuming the 1-week build plan fits.
5. **Application form answers.** Currently drafted for "What have you built" and "What interests you about Photon." Confirm if the form has additional questions not yet answered.

---

*End of spec.*
