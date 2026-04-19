# Entangle

> The channel between agents. Where humans cannot speak.

A TypeScript library for agent-to-agent communication between two humans AI agents, built on Photon Spectrum SDK.

Under 2000 LoC of hand-written TypeScript. core/protocol.ts reads as a 300-line protocol spec. bun test is green in under a second without network or API keys.

## Try it

- bun install
- bun test (37 tests, <100ms, zero network)
- HUMANIZE_STUB=1 bun run examples/double-yes.ts (in-memory walk-through)
- HUMANIZE_STUB=1 bun run examples/quiet-broadcast.ts (20 candidates, 3 delivered)

For the live demo (two real iMessages via Spectrum):

    cp .env.example .env
    # fill in PHOTON_PROJECT_ID, PHOTON_API_KEY, ANTHROPIC_API_KEY,
    #   YURI_HANDLE, ALEX_HANDLE, MIKA_HANDLE, TARO_HANDLE, KEN_HANDLE
    bun run dev
    bun run dev -- --scenario=quiet-broadcast

## What happens

    +-----------+                                +-----------+
    | Yuri      |                                | Alex      |
    | (agent)   |                                | (agent)   |
    +-----+-----+                                +-----+-----+
          | sealedIntent(from=yuri, to=alex)           |
          v                                            v
    +---------------------------------------------------------+
    |  IntentStore (shared SQLite; tryMatch = BEGIN IMMEDIATE)|
    +---------------------------------------------------------+
          |                                            ^
          v                                            |
       detectMutual --- counterpart? --- yes ----------+
          |                                            |
          v                                            v
    +---------------------------------------------------------+
    |  humanize (Claude Sonnet in live mode; stub in tests)   |
    +---------------------------------------------------------+
          |                                            |
          v                                            v
    +---------------------------------------------------------+
    |  Messenger (Spectrum iMessage, or MemoryMessenger)      |
    +---------------------------------------------------------+
          |                                            |
          v                                            v
       Yuri iPhone                                 Alex iPhone

Two people independently seal an intent to collaborate with each other. The protocol detects mutuality atomically, humanizes a reveal message on each side, and delivers both as real iMessages. Neither person sees what the other wrote until both have opted in.

## Layout

    src/
      core/       the protocol (types, stores, humanize, protocol.ts)
      engram/     identity graph (SQLite, 20-person seed)
      messaging/  Messenger port: spectrum + memory adapters
      runtime/    agent.ts, dev orchestrator, format, events sink, tail-events
      index.ts    public API

See [SPEC.md](SPEC.md) for the build specification and [docs/spectrum-notes.md](docs/spectrum-notes.md) for integration details.

## Observability

Every protocol event (sealed, matched, suppressed, probed, response, bubble-up) is appended to .entangle/events.jsonl. Pretty-print it with:

    bun run tail-events

## License

MIT.
