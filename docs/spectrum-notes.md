# spectrum-ts integration notes

> Relevant for Phase -1 / Phase 3. Captured from inspection of
> `spectrum-ts@0.4.0` installed directly from npm.

## Package name

The package ships as `spectrum-ts` on npm; SPEC §2 already named it
correctly. No rename was needed.

| concern | value |
|---|---|
| npm name | `spectrum-ts` |
| installed version | `0.4.0` |
| license | MIT |
| transitive deps | `@photon-ai/advanced-imessage`, `@photon-ai/imessage-kit`, `@photon-ai/whatsapp-business`, `zod@^4` (own copy), `better-grpc`, `@repeaterjs/repeater`, `mime-types`, `type-fest` |
| peer | `typescript ^5` |

## Construction

```ts
import { Spectrum, text } from 'spectrum-ts';
import { imessage } from 'spectrum-ts/providers/imessage';

const spectrum = await Spectrum({
  projectId: process.env.PHOTON_PROJECT_ID!,
  projectSecret: process.env.PHOTON_API_KEY!,
  providers: [imessage.config({ local: false })],
});
```

The `Spectrum(...)` factory returns a `SpectrumInstance`. Each
provider entry is a `PlatformProviderConfig`; you obtain one by
calling `.config(...)` on the provider module (e.g.
`imessage.config({ local: false })`).

Two iMessage modes are supported:

- `local: true` — drives the Mac's Messages.app via AppleScript /
  `IMessageSDK`. Can only **reply** to spaces it already sees; cannot
  create new spaces. Good for smoke-testing without Photon credentials
  but not sufficient for Entangle's demo scenario.
- `local: false` — uses Photon's cloud relay. Supports
  `imessage(spectrum).space({ users: [{ id: 'handle' }] })` to open a
  DM to an arbitrary Apple ID and then `spectrum.send(space, text(...))`.

## Ports Entangle needs

| Entangle Messenger method | spectrum-ts equivalent |
|---|---|
| `send(handle, { text })` | `imessage(spectrum).space({ users: [{ id: handle.handle }] })` then `spectrum.send(space, text(msg.text))` |
| `onReceive(handler)` | `for await (const [space, message] of spectrum.messages)` |
| shutdown | `await spectrum.stop()` |

Inbound messages have `message.content` which is a discriminated union
(`text` / `attachment` / `custom`). For Entangle we only care about
`type === 'text'`.

iMessage spaces are `{ id: string; type: 'dm' | 'group' }`. DMs we
create via `imessage(spectrum).space` use `directChat(address)` under
the hood to derive a deterministic space id.

## Gotchas

- **Two processes on one Mac** — `local: false` is safe (cloud relay
  per-Apple-ID tokens). `local: true` drives Messages.app and only one
  Messages session is available per macOS login, so you cannot run two
  agent processes under the same Apple ID in local mode.
- **Zod conflict** — `spectrum-ts` ships its own `zod@4`; Entangle uses
  `zod@3`. Both copies coexist via node_modules nesting; we do not
  import zod types from inside `spectrum-ts` into Entangle code.
- **ESM only** — `"type": "module"` in their package.json; works fine
  under Bun.
- **No README in the npm tarball at this version.** API was reverse-
  engineered from the `.d.ts` files under
  `node_modules/spectrum-ts/dist/`.

## Smoke script

`scripts/smoke-imessage.ts` sends a single iMessage to `YURI_HANDLE`
and waits up to 30s for a reply. Requires real credentials; run with:

```sh
bun run smoke:imessage
```

## Environment

Beyond the `.env.example` entries, `spectrum-ts` itself reads:

- `PHOTON_PROJECT_ID`, `PHOTON_API_KEY` — via explicit constructor
  args (passed through from Entangle's `.env`).

No other spectrum-specific env vars are required.
