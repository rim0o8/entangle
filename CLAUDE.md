# CLAUDE.md — Entangle

## Project summary

Entangle is an agent-to-agent protocol library in TypeScript. It lives between two humans'
AI agents and provides two primitives — `sealedIntent` (agents broker mutual intent before
either human sees anything) and `quietBroadcast` (rejection-free probing: suppress silently,
bubble up only `yes`). The repo ships an embedded `engram-lite` identity graph, a Spectrum
channel abstraction with a mock + Telegram adapter, a WebSocket-fed React demo UI, and two
assertion scripts that reproduce the spec §5 event logs end to end.

## Read first

Always read `spec.md` at the repo root before making changes. It is the source of truth for
architecture, phases, and acceptance criteria. Cross-reference `README.md` for the current
status and repo tour.

## Conventions

- **Phase-by-phase commits.** Message format: `phase: <N> - <short>`. Work phase by phase;
  do not start N+1 until N's tests pass.
- **Functions + plain objects, not classes.** The one exception is `EngramLite`, which owns
  a SQLite connection lifecycle.
- **Zod at protocol boundaries** (between `core` / `engram` / `spectrum`). Parse at entry,
  trust inside.
- **LLM calls only through `core/humanize.ts`.** Never scatter Anthropic SDK calls. Log
  prompts and responses to `.entangle/llm.log` in dev mode.
- **Tests live next to code** — `foo.ts` paired with `foo.test.ts`.
- **No global state.** Pass dependencies explicitly using the `deps` pattern (see §4.4 of
  the spec).
- **Strict TS, NodeNext.** Relative imports use the `.js` suffix (ESM resolution).
- **Immutability.** Create new objects via spread/map; do not mutate inputs.
- No new dependency without flagging it in the commit message.

## Run / test

```bash
pnpm test
pnpm type-check
pnpm lint
pnpm example:doubleyes
pnpm example:quietbroadcast
pnpm build:web
```

## Common pitfalls

- **Node PATH on this machine.** Bun's `node` shim shadows mise's Node and breaks
  `better-sqlite3` (you get `'better-sqlite3' is not yet supported in Bun`). Prefix commands
  with the mise shims when scripts fail with native-addon or ESM errors:
  ```bash
  PATH="$HOME/.local/share/mise/shims:$PATH" pnpm test
  ```
- **`better-sqlite3` native addon.** If the build fails, run `pnpm rebuild better-sqlite3`
  or `pnpm approve-builds`.
- **`zod` v3 import quirk.** Some files use `import * as z from 'zod/v3'` — keep that
  as-is; do not rewrite to the default import.
- **Module boundary.** Never import `engram/lite` from `core`. `core` takes an
  `IdentityGraph` by dependency injection. This is the contract Hexis's full `engram` will
  satisfy later.

## Architecture

Four module boundaries plus the web UI:

- **`engram/`** — identity graph. `IdentityGraph` interface + `EngramLite` SQLite
  implementation + seed loader.
- **`core/`** — protocol primitives (`sealedIntent`, `detectMutual`, `quietBroadcast`,
  `filterCandidate`, `recordBroadcastResponse`, `finalizeBroadcast`), event log, stores,
  and the `humanize` LLM boundary.
- **`spectrum/`** — `Channel` surface (`send` + `onReceive`), mock adapter, Telegram
  adapter, and `createChannelFromEnv` composite.
- **`demo/`** — orchestrator (scripted timelines) + WebSocket server + CLI entry point.
- **`web/`** — Vite + React + Tailwind split-screen UI with `/double-yes` and
  `/quiet-broadcast` routes.

Dependency direction: `demo → core → engram-interface`, `demo → spectrum`,
`core → spectrum` via injected `Channel`. `engram-lite` implements the engram interface; it
is never imported by `core`.

## Demo recording

Videos are a manual step — do not attempt to automate.

1. Terminal 1: `pnpm demo:doubleyes` (or `pnpm demo:quietbroadcast`).
2. Terminal 2: `pnpm dev:web`.
3. Open `http://localhost:5173/double-yes` (or `/quiet-broadcast`).
4. Browser into presentation / full-screen mode (hide chrome).
5. Screen-record at 1080p for ~60 s. `Space` plays/pauses, `R` restarts from beat 1.
6. Save to `docs/double-yes.mp4` and `docs/quiet-broadcast.mp4`.

## Stretch goals

See `spec.md` §9. Do not build until all of Phases 0–5 are green: `threshold` primitive,
real iMessage adapter (BlueBubbles), cryptographic agent handshake, full `engram`
integration.
