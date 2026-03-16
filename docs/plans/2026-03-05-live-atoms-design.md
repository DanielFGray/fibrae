# Live Atoms Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the bolt-on `fibrae/live` channel/connect pattern with first-class live atoms that integrate with fibrae's existing reactive model — reading a live atom is all a component needs to do.

**Architecture:** Live atoms use `Atom.make(stream)` from @effect-atom/atom, which returns `Atom<Result<A, E>>` with automatic Initial→Success→Failure state tracking. A `LiveConfig` service (provided via Layer) maps event names to SSE URLs. The server side uses the same atom definitions (key + schema) to produce SSE endpoints. The `LiveChannel`/`connect()`/`connectGroup()` API is replaced by atoms that are reactive by nature.

**Tech Stack:** effect, @effect-atom/atom (`Atom.make`, `Atom.serializable`, `Result`), Effect `Stream.async` for SSE transport, `Schema` for codec.

---

## Task 1: LiveConfig Service

Define the service that provides SSE connection configuration. This decouples atoms from URLs.

**Files:**

- Create: `packages/fibrae/src/live/config.ts`
- Modify: `packages/fibrae/src/live/index.ts`

**Step 1: Write the failing test**

Add to `packages/fibrae/src/live/live.test.ts`:

```ts
import { LiveConfig } from "./config.js";

describe("LiveConfig", () => {
  test("resolves URL from baseUrl + event name", () => {
    const config = LiveConfig.resolve(LiveConfig.make({ baseUrl: "/api/live" }), "clock");
    expect(config).toBe("/api/live");
  });

  test("per-event URL overrides baseUrl", () => {
    const config = LiveConfig.resolve(
      LiveConfig.make({
        baseUrl: "/api/live",
        channels: { clock: "/special/clock" },
      }),
      "clock",
    );
    expect(config).toBe("/special/clock");
  });

  test("events without override use baseUrl", () => {
    const config = LiveConfig.resolve(
      LiveConfig.make({
        baseUrl: "/api/live",
        channels: { clock: "/special/clock" },
      }),
      "counter",
    );
    expect(config).toBe("/api/live");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/fibrae/src/live/live.test.ts`
Expected: FAIL — `./config.js` doesn't exist

**Step 3: Implement LiveConfig**

Create `packages/fibrae/src/live/config.ts`:

```ts
import * as Context from "effect/Context";

export interface LiveConfigShape {
  readonly baseUrl: string;
  readonly channels?: Record<string, string>;
  readonly withCredentials?: boolean;
}

export class LiveConfig extends Context.Tag("fibrae/LiveConfig")<LiveConfig, LiveConfigShape>() {
  static make(options: LiveConfigShape): LiveConfigShape {
    return options;
  }

  /** Resolve the SSE URL for a given event name. */
  static resolve(config: LiveConfigShape, event: string): string {
    return config.channels?.[event] ?? config.baseUrl;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test packages/fibrae/src/live/live.test.ts`
Expected: PASS

**Step 5: Export from index and commit**

Add to `packages/fibrae/src/live/index.ts`:

```ts
export { LiveConfig } from "./config.js";
export type { LiveConfigShape } from "./config.js";
```

Commit: `feat(live): add LiveConfig service for URL resolution`

---

## Task 2: SSE Stream Constructor

Create a reusable function that wraps EventSource into an Effect Stream. This is the transport layer that live atoms will use.

**Files:**

- Create: `packages/fibrae/src/live/sse-stream.ts`
- Modify: `packages/fibrae/src/live/index.ts`

**Step 1: Write the failing test**

This is hard to unit-test (needs EventSource). Instead, test the stream shape by mocking minimally. Add to `live.test.ts`:

```ts
import { sseStream } from "./sse-stream.js";

describe("sseStream", () => {
  test("module exports sseStream function", () => {
    expect(typeof sseStream).toBe("function");
  });
});
```

The real integration test is the existing Cypress suite which exercises SSE end-to-end.

**Step 2: Implement sseStream**

Create `packages/fibrae/src/live/sse-stream.ts`:

```ts
import * as Stream from "effect/Stream";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/**
 * Create an Effect Stream from a Server-Sent Events endpoint.
 *
 * Each emission is a decoded value of type `A`. The stream
 * stays open until the scope is closed (component unmounts).
 */
export const sseStream = <A, I>(options: {
  readonly url: string;
  readonly event: string;
  readonly schema: Schema.Schema<A, I>;
  readonly withCredentials?: boolean;
}): Stream.Stream<A, never, never> => {
  const decode = Schema.decodeUnknownSync(Schema.parseJson(options.schema));

  return Stream.async<A>((emit) => {
    const es = new EventSource(options.url, {
      withCredentials: options.withCredentials ?? false,
    });

    es.addEventListener(options.event, (e: MessageEvent) => {
      try {
        emit.single(decode(e.data));
      } catch {
        // Decode errors are silently skipped — atom stays at previous value
      }
    });

    es.onerror = () => {
      // EventSource auto-reconnects; don't end the stream
    };

    return Effect.sync(() => es.close());
  });
};
```

**Step 3: Export and commit**

Add to `packages/fibrae/src/live/index.ts`:

```ts
export { sseStream } from "./sse-stream.js";
```

Commit: `feat(live): add sseStream — EventSource as Effect Stream`

---

## Task 3: `Atom.live()` Constructor

The core API. Creates an atom backed by an SSE stream, returning `Atom<Result<A, E>>`. Also marks the atom as serializable for SSR hydration.

**Files:**

- Create: `packages/fibrae/src/live/atom.ts`
- Modify: `packages/fibrae/src/live/index.ts`

**Step 1: Write the failing test**

Add to `live.test.ts`:

```ts
import * as Result from "@effect-atom/atom/Result";
import { Atom } from "@effect-atom/atom";
import { live } from "./atom.js";

describe("live atom", () => {
  test("creates an atom with Result type", () => {
    const clock = live("clock", {
      schema: Schema.String,
    });
    // Should be a valid atom
    expect(Atom.isAtom(clock)).toBe(true);
  });

  test("stores event name and schema as metadata", () => {
    const clock = live("clock", {
      schema: Schema.String,
    });
    expect(clock._live.event).toBe("clock");
  });

  test("is serializable with event name as key", () => {
    const clock = live("clock", {
      schema: Schema.String,
    });
    expect(Atom.isSerializable(clock)).toBe(true);
  });

  test("accepts custom key separate from event name", () => {
    const clock = live("clock", {
      schema: Schema.String,
      key: "my-clock",
    });
    expect(clock._live.event).toBe("clock");
    expect(clock[Atom.SerializableTypeId].key).toBe("my-clock");
  });

  test("initial value is Result.initial()", () => {
    const clock = live("clock", {
      schema: Schema.String,
    });
    const registry = Atom.Registry.make();
    const value = registry.get(clock);
    expect(Result.isInitial(value)).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/fibrae/src/live/live.test.ts`
Expected: FAIL — `./atom.js` doesn't exist

**Step 3: Implement `live()`**

Create `packages/fibrae/src/live/atom.ts`:

````ts
import * as Atom from "@effect-atom/atom/Atom";
import * as Result from "@effect-atom/atom/Result";
import type * as Schema from "effect/Schema";

/** Metadata attached to live atoms for runtime discovery. */
export interface LiveMeta<A, I> {
  readonly event: string;
  readonly schema: Schema.Schema<A, I>;
}

/** A live atom — an atom backed by a remote SSE source. */
export type LiveAtom<A, I = A> = Atom.Atom<Result.Result<A>> &
  Atom.Serializable<Schema.Schema<A, I>> & {
    readonly _live: LiveMeta<A, I>;
  };

export const LiveMetaTypeId = Symbol.for("fibrae/LiveMeta");

/** Check if an atom is a live atom. */
export const isLiveAtom = (atom: Atom.Atom<any>): atom is LiveAtom<any> =>
  "_live" in atom && (atom as any)._live != null;

/**
 * Create a live atom — an atom whose value is synced from a server SSE source.
 *
 * The atom's type is `Result<A>`:
 * - `Result.initial()` before SSE connects
 * - `Result.success(value)` on each event
 * - `Result.failure(cause)` on stream error
 *
 * The atom is automatically serializable for SSR hydration.
 *
 * @example
 * ```ts
 * const ClockAtom = live("clock", { schema: Schema.String })
 * // Type: LiveAtom<string>
 * // In a component: just read it
 * const clock = registry.get(ClockAtom) // Result<string>
 * ```
 */
export const live = <A, I>(
  event: string,
  options: {
    readonly schema: Schema.Schema<A, I>;
    readonly key?: string;
  },
): LiveAtom<A, I> => {
  // Create a plain writable atom with Result.initial() as default.
  // The actual SSE stream subscription is wired up by the render
  // system when it detects a live atom via LiveConfig.
  const atom = Atom.make<Result.Result<A>>(Result.initial());

  // Mark as serializable for SSR hydration
  const serialized = Atom.serializable(atom, {
    key: options.key ?? event,
    schema: Result.Schema(options.schema) as any,
  });

  // Attach live metadata
  return Object.assign(serialized, {
    _live: { event, schema: options.schema } as LiveMeta<A, I>,
  }) as any;
};
````

Note: `Result.Schema` provides the schema for the `Result<A>` type. If it doesn't exist or doesn't work as expected, we'll use a simpler approach — serialize only the success value and reconstruct the Result on hydration.

**Step 4: Run tests and iterate**

Run: `bun test packages/fibrae/src/live/live.test.ts`
Adjust imports and types until all tests pass.

**Step 5: Export and commit**

Add to `packages/fibrae/src/live/index.ts`:

```ts
export { live, isLiveAtom } from "./atom.js";
export type { LiveAtom, LiveMeta } from "./atom.js";
```

Commit: `feat(live): add live() atom constructor with Result + serialization`

---

## Task 4: Live Atom Activation in Render

When `render()` detects that a component reads a live atom, and a `LiveConfig` is in the Layer, automatically set up the SSE stream subscription. This eliminates the `connect()` call.

**Files:**

- Modify: `packages/fibrae/src/tracking.ts` — detect live atoms during tracking
- Modify: `packages/fibrae/src/fiber-render.ts` — activate SSE streams for discovered live atoms
- Modify: `packages/fibrae/src/core.ts` — pass LiveConfig through render context (if present)

**Step 1: Extend tracking to flag live atoms**

In `tracking.ts`, the tracking registry proxy already intercepts `registry.get()`. Extend it to also collect live atoms into a separate set:

```ts
// In makeTrackingRegistry, alongside accessedAtoms:
const accessedLiveAtoms = new Set<LiveAtom<any>>();

// In the get() proxy:
if (isLiveAtom(atom)) {
  accessedLiveAtoms.add(atom);
}
```

**Step 2: Wire up SSE streams in subscribeFiberAtoms**

After tracking completes and fiber atoms are subscribed, check if any are live atoms. For each live atom that isn't already connected, create the SSE stream and feed values into the atom:

```ts
// In subscribeFiberAtoms (fiber-render.ts), after existing subscription loop:
const liveConfig = Context.getOption(context, LiveConfig);
if (Option.isSome(liveConfig)) {
  for (const liveAtom of accessedLiveAtoms) {
    if (activeLiveConnections.has(liveAtom)) continue;
    const url = LiveConfig.resolve(liveConfig.value, liveAtom._live.event);
    const stream = sseStream({
      url,
      event: liveAtom._live.event,
      schema: liveAtom._live.schema,
      withCredentials: liveConfig.value.withCredentials,
    });
    // Subscribe: SSE values → atom updates
    const sub = Stream.runForEach(stream, (value) =>
      Effect.sync(() => registry.set(liveAtom, Result.success(value))),
    );
    yield * Effect.forkIn(sub, scope);
    activeLiveConnections.add(liveAtom);
  }
}
```

The `activeLiveConnections` set (scoped to the render tree) prevents duplicate connections when multiple components read the same live atom.

**Step 3: Test with existing Cypress suite**

Update the demo app to use the new `live()` API and verify the existing Cypress tests still pass. This is covered in Task 6.

**Step 4: Commit**

Commit: `feat(live): auto-activate SSE streams for live atoms in render`

---

## Task 5: Server-Side `serve()` Refactor

Update `serve()` to accept live atoms directly instead of channels. Keep backward compat by also accepting the old channel shape.

**Files:**

- Modify: `packages/fibrae/src/live/server.ts`

**Step 1: Add live atom overload to serve()**

```ts
// New: serve a single live atom
export const serve = <A, I, R>(
  atom: LiveAtom<A, I>,
  options: ServeOptions<A, R>,
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, R>

// Old: serve a channel (backward compat, deprecated)
export const serve = <A, I, R>(
  channel: LiveChannel<A, I>,
  options: ServeOptions<A, R>,
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, R>
```

Implementation: detect whether first arg is a `LiveAtom` (has `_live`) or `LiveChannel` (has `_tag: "LiveChannel"`). Extract `name` and `schema` from whichever shape is passed.

**Step 2: Add live atom overload to serveGroup()**

```ts
// New shape:
export const serveGroup = (options: {
  readonly channels: readonly {
    readonly atom: LiveAtom<any, any>
    readonly source: Effect.Effect<any, never, any>
    readonly interval?: DurationInput
    readonly equals?: ((a: any, b: any) => boolean) | false
  }[]
  readonly heartbeatInterval?: DurationInput | false
  readonly retryInterval?: DurationInput
})
```

**Step 3: Verify existing unit tests still pass**

Run: `bun test packages/fibrae/src/live/live.test.ts`
The old channel-based tests should still work (backward compat).

**Step 4: Commit**

Commit: `feat(live): serve() accepts live atoms alongside channels`

---

## Task 6: Migrate Demo App

Update the demo to use the new `live()` API. This validates the design end-to-end.

**Files:**

- Modify: `packages/demo/src/ssr-live-test-app.tsx`
- Modify: `packages/demo/src/ssr-hydrate-live-test.tsx`
- Modify: `packages/demo/server/index.ts`

**Step 1: Replace channel definitions with live atoms**

Before:

```ts
const SingleClockAtom = Atom.make("");
const SingleClockChannel = LiveSync.channel({
  name: "clock",
  schema: Schema.String,
  atom: SingleClockAtom,
});
```

After:

```ts
import { live } from "fibrae/live";
const SingleClockAtom = live("clock", { schema: Schema.String });
```

**Step 2: Replace connect() calls with plain atom reads**

Before:

```ts
const LiveSingle = () =>
  Effect.gen(function* () {
    yield* LiveSync.connect(SingleClockChannel, { url: "/api/live/test-clock" })
    const registry = yield* AtomRegistry.AtomRegistry
    const time = registry.get(SingleClockAtom)
    return <p data-cy="single-clock">{time || "Connecting..."}</p>
  })
```

After:

```ts
import { Result } from "fibrae"

const LiveSingle = () =>
  Effect.gen(function* () {
    const registry = yield* AtomRegistry.AtomRegistry
    const clock = registry.get(SingleClockAtom) // Result<string>
    return (
      <p data-cy="single-clock">
        {Result.isSuccess(clock) ? clock.value : "Connecting..."}
      </p>
    )
  })
```

No `connect()` call — just reading the atom is enough. The render system sees it's a live atom and wires up SSE via `LiveConfig`.

**Step 3: Provide LiveConfig in hydration**

In `ssr-hydrate-live-test.tsx`:

```ts
import { LiveConfig } from "fibrae/live"
import { Layer } from "effect"

const liveLayer = Layer.succeed(LiveConfig, LiveConfig.make({
  baseUrl: "/api/live/test-clock",
  channels: {
    counter: "/api/live/test-multi",
  },
}))

render(<LiveTestApp />, container, { layer: liveLayer }).pipe(...)
```

**Step 4: Update server to use live atoms**

In `server/index.ts`:

```ts
import { SingleClockAtom, MultiClockAtom, MultiCounterAtom } from "../src/ssr-live-test-app.js";

const liveTestClockHandler = LiveSync.serve(SingleClockAtom, {
  source: Effect.sync(() => new Date().toISOString()),
  interval: "1 second",
  retryInterval: "5 seconds",
});
```

**Step 5: Run Cypress tests**

Run: `npx cypress run --spec "cypress/e2e/live-sync.cy.ts"`
Expected: All 9 tests pass.

**Step 6: Commit**

Commit: `refactor(demo): migrate live demo to live atoms API`

---

## Task 7: Re-export Result from fibrae and Clean Up

Make `Result` more accessible and deprecate the old channel API.

**Files:**

- Modify: `packages/fibrae/src/live/index.ts` — mark `channel`, `connect`, `connectGroup` as deprecated
- Modify: `packages/fibrae/src/live/types.ts` — add deprecation JSDoc
- Modify: `packages/fibrae/src/live/client.ts` — add deprecation JSDoc

**Step 1: Add deprecation notices**

```ts
/** @deprecated Use `live()` to create live atoms instead. */
export { channel } from "./types.js";
/** @deprecated Live atoms auto-connect via LiveConfig. */
export { connect, connectGroup } from "./client.js";
```

**Step 2: Verify all tests pass**

Run:

```
bun test packages/fibrae/src/live/live.test.ts
npx cypress run --spec "cypress/e2e/live-sync.cy.ts"
```

**Step 3: Rebuild fibrae package**

Run: `cd packages/fibrae && bun run build`

**Step 4: Commit**

Commit: `chore(live): deprecate channel/connect API in favor of live atoms`

---

## Task 8: connectGroup Equivalent — Shared SSE Connections

When multiple live atoms resolve to the same URL (via LiveConfig), they should share a single EventSource. This replaces `connectGroup` automatically.

**Files:**

- Modify: `packages/fibrae/src/fiber-render.ts` (the activation logic from Task 4)

**Step 1: Group live atoms by resolved URL**

In the activation logic, instead of one EventSource per atom:

```ts
// Group atoms by their resolved URL
const byUrl = new Map<string, LiveAtom<any>[]>();
for (const atom of accessedLiveAtoms) {
  const url = LiveConfig.resolve(config, atom._live.event);
  const group = byUrl.get(url) ?? [];
  group.push(atom);
  byUrl.set(url, group);
}

// For each URL, open one EventSource with listeners for each event
for (const [url, atoms] of byUrl) {
  if (atoms.length === 1) {
    // Single atom — use dedicated EventSource
    // (same as Task 4)
  } else {
    // Multiple atoms — shared EventSource, multiple addEventListener calls
    const es = new EventSource(url, { withCredentials });
    for (const atom of atoms) {
      const decode = Schema.decodeUnknownSync(Schema.parseJson(atom._live.schema));
      es.addEventListener(atom._live.event, (e: MessageEvent) => {
        try {
          registry.set(atom, Result.success(decode(e.data)));
        } catch {
          /* skip */
        }
      });
    }
    // Cleanup when scope closes
    yield *
      Scope.addFinalizer(
        scope,
        Effect.sync(() => es.close()),
      );
  }
}
```

**Step 2: Test with multi-channel demo**

The existing Cypress tests for `connectGroup` behavior should pass with the shared EventSource.

**Step 3: Commit**

Commit: `feat(live): auto-share EventSource when multiple live atoms target same URL`

---

## Verification

After all tasks:

1. **Unit tests:** `bun test packages/fibrae/src/live/live.test.ts` — all pass
2. **Type check:** `cd packages/fibrae && bunx tsc --noEmit` — clean
3. **Build:** `cd packages/fibrae && bun run build` — success
4. **E2E tests:** `npx cypress run --spec "cypress/e2e/live-sync.cy.ts"` — all 9 pass
5. **Existing tests:** `npx cypress run` — no regressions

## API Before/After Summary

```
BEFORE (bolt-on):                          AFTER (first-class):
─────────────────                          ─────────────────────
const MyAtom = Atom.make("")               const MyAtom = live("clock", {
const MyCh = channel({                       schema: Schema.String,
  name: "clock",                           })
  schema: Schema.String,
  atom: MyAtom,
})

// In component:                           // In component:
yield* connect(MyCh, { url })              const clock = registry.get(MyAtom)
const val = registry.get(MyAtom)           // Result<string> — auto-connected
// string — manual setup

// In render:                              // In render:
render(<App />, el)                        render(<App />, el, {
                                             layer: Layer.succeed(LiveConfig,
                                               LiveConfig.make({ baseUrl: "/api/live" })
                                             )
                                           })

// On server:                              // On server:
serve(MyCh, { source, interval })          serve(MyAtom, { source, interval })
```
