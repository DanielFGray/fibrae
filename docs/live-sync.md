# LiveSync — Server-to-Client Atom Sync over SSE

## Overview

`fibrae/live` provides real-time server-to-client state synchronization using Server-Sent Events. Define a `LiveChannel` that pairs an Effect Schema with a writable atom, serve it as an SSE endpoint on the server, and connect to it from a fibrae component on the client. State changes are automatically deduplicated, schema-validated, and pushed into atoms that drive reactive UI updates.

## Architecture

```
Server                                          Client
Effect source ──poll──> Schema.encode           EventSource
       │                     │                       │
       v                     v                       v
  Stream.repeatEffect   Stream.mapEffect        JSON.parse
       │                     │                       │
       v                     v                       v
  Schedule.spaced    Stream.changesWith (dedup)  Schema.decode
                             │                       │
                             v                       v
                     encodeSSE (Uint8Array)     registry.set(atom, value)
                             │
                             v
                    ReadableStream (SSE response)
```

## API Reference

### `channel(opts)` — Define a sync point

```ts
const channel: <A, I>(opts: {
  name: string;
  schema: Schema.Schema<A, I>;
  atom: Atom.Writable<A>;
}) => LiveChannel<A, I>;
```

Creates a `LiveChannel` binding a name, schema, and atom together. The `name` becomes the SSE `event:` field. The schema handles encode (server) and decode (client). The atom receives decoded values on the client.

### `serve(channel, opts)` — Single-channel SSE endpoint

```ts
const serve: <A, I, R>(
  channel: LiveChannel<A, I>,
  options: ServeOptions<A, R>,
) => Effect.Effect<HttpServerResponse, never, R>;
```

**`ServeOptions`:**
| Option | Type | Default | Description |
|------------- |-------------------|----------------|--------------------------------------|
| `source` | `Effect<A, never, R>` | required | Effect that fetches current state |
| `interval` | `DurationInput` | `"2 seconds"` | Polling interval |
| `diffBased` | `boolean` | `true` | Only emit when value changes (JSON equality) |

Returns an `HttpServerResponse` with a streaming SSE body. The source Effect's `R` requirement propagates to the caller. Fiber cleanup happens automatically when the client disconnects — `Stream.toReadableStreamRuntime` handles backpressure and interruption.

### `serveGroup({ channels })` — Multiplexed SSE endpoint

```ts
const serveGroup: <Channels extends readonly ServeGroupChannelOptions[]>(options: {
  channels: Channels;
}) => Effect.Effect<HttpServerResponse, never, R>;
```

**`ServeGroupChannelOptions`:**
| Field | Type | Description |
|-------------|-------------------------|---------------------------------|
| `channel` | `LiveChannel<A, I>` | The channel definition |
| `source` | `Effect<A, never, R>` | State source for this channel |
| `interval` | `DurationInput` (opt) | Per-channel polling interval |

Merges multiple channel streams into one SSE connection with `Stream.mergeAll({ concurrency: "unbounded" })`. Each channel polls independently. Always deduplicates (diffBased is not configurable here).

### `connect(channel, opts)` — Client single-channel subscription

```ts
const connect: <A, I>(
  channel: LiveChannel<A, I>,
  options: ConnectOptions,
) => Effect.Effect<void, never, AtomRegistry | ComponentScope>;
```

**`ConnectOptions`:** `{ url: string }` — the SSE endpoint URL.

Opens an `EventSource`, listens for events matching `channel.name`, decodes via schema, and sets the atom through `AtomRegistry`. The EventSource is closed automatically when the component's scope finalizes (unmount). Decode errors are logged and skipped. SSR-safe: no-op when `typeof window === "undefined"`.

### `connectGroup(channels, opts)` — Client multi-channel subscription

```ts
const connectGroup: (
  channels: readonly LiveChannel<any, any>[],
  options: ConnectOptions,
) => Effect.Effect<void, never, AtomRegistry | ComponentScope>;
```

Single `EventSource` dispatching to multiple atoms by event name. Same cleanup and SSR-safety behavior as `connect()`.

### Codec utilities

- **`encodeSSE(name, data)`** — Encodes `event: <name>\ndata: <json>\n\n` as `Uint8Array`
- **`encodeComment(text)`** — Encodes `: <text>\n\n` as `Uint8Array` (keepalive)
- **`SSE_HEADERS`** — `{ "Cache-Control": "no-cache", Connection: "keep-alive", "Access-Control-Allow-Origin": "*" }`

## Usage Example

```ts
import { Schema } from "effect"
import { Atom } from "@effect-atom/atom"
import * as LiveSync from "fibrae/live"

// --- Shared: define the channel ---
const Light = Schema.Struct({ id: Schema.String, on: Schema.Boolean })
const LightsAtom = Atom.make<typeof Light.Type[]>([])

const LightsChannel = LiveSync.channel({
  name: "lights",
  schema: Schema.Array(Light),
  atom: LightsAtom,
})

// --- Server: expose SSE endpoint ---
import { HttpRouter } from "@effect/platform"

const handler = LiveSync.serve(LightsChannel, {
  source: getLightsFromDB,   // Effect<Light[], never, DbService>
  interval: "2 seconds",
})

HttpRouter.get("/api/live/lights", handler)

// --- Client: subscribe in a component ---
const LightsIndicator = () =>
  Effect.gen(function* () {
    yield* LiveSync.connect(LightsChannel, { url: "/api/live/lights" })
    const lights = yield* Atom.get(LightsAtom)
    return <div>{lights.length} lights connected</div>
  })
```

## Notes

- **Automatic deduplication**: `serve()` defaults `diffBased: true`, comparing via `JSON.stringify` equality. `serveGroup()` always deduplicates.
- **Fiber cleanup**: `Stream.toReadableStreamRuntime` ties the server-side polling fiber to the response stream lifetime. Client disconnect kills the fiber.
- **Client auto-reconnect**: `EventSource` reconnects automatically per the SSE spec.
- **SSR-safe**: `connect()` and `connectGroup()` are no-ops when `typeof window === "undefined"`.
- **Decode errors**: Logged to console, never crash the subscription.
