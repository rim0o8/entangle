# CLAUDE.md

Entangle — the channel between agents, built on Photon Spectrum.
`SPEC.md` is the full build specification. This file is the short version
you should re-read at the start of every session.

---

## First thing every session

1. Read `SPEC.md` in full.
2. Check `git log --oneline | head` for the most recent `phase: N` commit. That is the current phase.
3. If there is no such commit, start at Phase -1 or Phase 0 per `SPEC.md §4`.
4. If existing code and `SPEC.md` disagree, the spec wins. Surface the drift, propose a targeted fix, and ask the user before any large rewrite.

---

## Quality bar

The goal is code a Photon resident reads and wants to extend. Targets:

- Whole codebase under 2000 lines of hand-written TypeScript.
- `core/protocol.ts` under 300 lines, readable top to bottom as a protocol spec.
- `bun test` green in under 10 seconds.
- Boring TypeScript that does what it says. No cleverness.

---

## Non-negotiable rules

1. `core/*` never imports from `messaging/*` or `spectrum-ts`. Ports come in via `ProtocolDeps`.
2. `core/*` functions never call `new Date()` or `Math.random()`. Those come through `deps.now()` and a shared `nanoid`.
3. LLM calls go through `core/humanize.ts`. Nowhere else.
4. Messaging calls go through `src/messaging/*`. Nowhere else.
5. Tests never hit a real API. `bun test` runs with `HUMANIZE_STUB=1` and no `ANTHROPIC_API_KEY`. CI fails otherwise.
6. Every protocol-boundary input is parsed with `zod`. Inside `core/`, types are trusted.
7. No global state. Pass `deps` explicitly to every function that needs it.
8. No `console.log` in library code (`src/core`, `src/engram`, `src/messaging`). Terminal output lives only in `src/runtime/format.ts` and under `examples/`.

---

## Phase discipline

- Work one phase at a time.
- Do not start Phase N+1 until every acceptance test in Phase N passes.
- Commit at each phase boundary: `phase: <N> - <short description>`.
- Phase -1 may run in parallel but blocks Phase 3.
- Inside a phase, commit often in small, self-explanatory chunks.

---

## Secrets

Never commit:

- `.env` (must be in `.gitignore`).
- Any handle matching `+1-*` or `+81-*`.
- `sk-ant-*` (Anthropic keys).
- `PHOTON_API_KEY=<non-empty>` or `PHOTON_PROJECT_ID=<non-empty>`.

A pre-commit hook enforces these. Do not weaken or disable it. If it blocks a legitimate commit, fix the source of the leak, not the hook.

---

## Dependencies

All allowed deps are listed in `SPEC.md §2`. Before adding anything new:

1. Prefer a zero-dep or standard-library solution.
2. If a new dep is unavoidable, state the need explicitly in the commit message.

---

## Test patterns

- Tests live next to the code they test (`foo.ts` + `foo.test.ts`).
- Every `core/*` test composes its own `ProtocolDeps` from:
  - `MemoryMessenger` (from `messaging/memory.ts`)
  - Stub `Humanizer` (returns deterministic strings)
  - In-memory SQLite (`new Database(':memory:')`)
  - An injected fake clock
- The race-condition test for `detectMutual` is the single most important test in the suite. It uses file-backed SQLite (not `:memory:`) because `:memory:` does not support concurrent connections.
- Table-driven tests for `filterCandidate`: one row per `availability` state.

---

## Commands

```bash
bun install              # setup
bun test                 # unit tests; green with no credentials
bun run dev              # live demo, real spectrum-ts, requires full .env
bun run dev -- --scenario=quiet-broadcast
bun run smoke:imessage   # Phase -1 sanity check
```

---

## When in doubt

Ask the user. Do not guess at:

- Ambiguous type shapes.
- Ambiguous acceptance criteria.
- Whether to add a new dependency or module.
- Whether to touch existing code that predates the current SPEC.

The user prefers one short question over a wrong large change.

---

*End of CLAUDE.md.*
