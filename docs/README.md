# docs/

Demo video drop folder. Referenced from the repo `README.md` and `CLAUDE.md`.

## Expected files

Record both as 1080p screen captures (~60 s each) and save them here:

- `double-yes.mp4` — the Double Yes scenario (spec §5.1).
- `quiet-broadcast.mp4` — the Quiet Broadcast scenario (spec §5.2).

## How to record

Run the orchestrator + web UI in two terminals, open the scene in presentation mode, and
screen-record. Full steps live in `CLAUDE.md` → "Demo recording".

```bash
# terminal 1
pnpm demo:doubleyes           # or pnpm demo:quietbroadcast

# terminal 2
pnpm dev:web
# open http://localhost:5173/double-yes (or /quiet-broadcast)
```

Keyboard: `Space` play/pause, `R` restart from beat 1.

Both videos plus a combined 2-minute cut are the last deliverable for the Photon
application (spec §6 Phase 5). Claude Code does not record these — that is a manual step
for Yuri.
