# LiveSync Tests, Docs & Demo Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add unit tests, documentation, and a demo for the `fibrae/live` module.

**Architecture:** Tests cover codec (pure functions), channel constructor, and server stream pipeline. Docs are a single reference markdown file. Demo adds a live clock route to the existing Bun SSR server.

**Tech Stack:** bun:test, Effect Stream/Schema, @effect/platform HttpRouter

---

### Task 1: Codec unit tests

**Files:**

- Create: `packages/fibrae/src/live/live.test.ts`

**Step 1: Write codec tests**

```ts
/* eslint-disable local/no-run-promise -- Tests need to bridge Effect to async test runner */
import { describe, test, expect } from "bun:test";
import { encodeSSE, encodeComment, SSE_HEADERS } from "./codec.js";

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe("codec", () => {
  test("encodeSSE formats event with name and JSON data", () => {
    const result = decode(encodeSSE("lights", { on: true }));
    expect(result).toBe('event: lights\ndata: {"on":true}\n\n');
  });

  test("encodeSSE handles string data", () => {
    const result = decode(encodeSSE("msg", "hello"));
    expect(result).toBe('event: msg\ndata: "hello"\n\n');
  });

  test("encodeSSE handles array data", () => {
    const result = decode(encodeSSE("items", [1, 2, 3]));
    expect(result).toBe("event: items\ndata: [1,2,3]\n\n");
  });

  test("encodeComment formats keepalive comment", () => {
    const result = decode(encodeComment("keepalive"));
    expect(result).toBe(": keepalive\n\n");
  });

  test("SSE_HEADERS has required fields", () => {
    expect(SSE_HEADERS["Cache-Control"]).toBe("no-cache");
    expect(SSE_HEADERS.Connection).toBe("keep-alive");
  });
});
```

**Step 2: Run tests**

Run: `cd packages/fibrae && bun test src/live/live.test.ts`
Expected: PASS

**Step 3: Commit**

```
test: add LiveSync codec unit tests
```

---

### Task 2: Channel constructor and server stream tests

**Files:**

- Modify: `packages/fibrae/src/live/live.test.ts`

**Step 1: Add channel and server tests**

Append to test file:

```ts
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Schema from "effect/Schema";
import * as Ref from "effect/Ref";
import { Atom } from "@effect-atom/atom";
import { channel } from "./types.js";
import { serve, serveGroup } from "./server.js";

// Helper to read N events from a ReadableStream of SSE bytes
const readEvents = (body: ReadableStream<Uint8Array>, n: number): Promise<string[]> =>
  new Promise(async (resolve) => {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    const events: string[] = [];
    while (events.length < n) {
      const { value, done } = await reader.read();
      if (done) break;
      events.push(decoder.decode(value));
    }
    await reader.cancel();
    resolve(events);
  });

describe("channel", () => {
  test("constructs a LiveChannel with correct shape", () => {
    const atom = Atom.make(0);
    const ch = channel({ name: "counter", schema: Schema.Number, atom });
    expect(ch._tag).toBe("LiveChannel");
    expect(ch.name).toBe("counter");
    expect(ch.atom).toBe(atom);
  });
});

describe("serve", () => {
  test("emits SSE events from source", async () => {
    const atom = Atom.make(0);
    const ch = channel({ name: "count", schema: Schema.Number, atom });
    const counter = Ref.unsafeMake(0);

    const response = await Effect.runPromise(
      serve(ch, {
        source: Ref.getAndUpdate(counter, (n) => n + 1),
        interval: "50 millis",
        diffBased: false,
      }),
    );

    const body = response.body.value as ReadableStream<Uint8Array>;
    const events = await readEvents(body, 3);

    expect(events[0]).toContain("event: count");
    expect(events[0]).toContain("data: 0");
    expect(events[1]).toContain("data: 1");
    expect(events[2]).toContain("data: 2");
  });

  test("deduplicates when diffBased is true", async () => {
    const atom = Atom.make("");
    const ch = channel({ name: "val", schema: Schema.String, atom });
    // Source always returns "same"
    const response = await Effect.runPromise(
      serve(ch, {
        source: Effect.succeed("same"),
        interval: "50 millis",
        diffBased: true,
      }),
    );

    const body = response.body.value as ReadableStream<Uint8Array>;
    // Should only get 1 event (first emission), then stream stalls since value never changes
    const events = await readEvents(body, 1);
    expect(events).toHaveLength(1);
    expect(events[0]).toContain('data: "same"');
  });
});

describe("serveGroup", () => {
  test("multiplexes multiple channels", async () => {
    const atomA = Atom.make(0);
    const atomB = Atom.make("");
    const chA = channel({ name: "nums", schema: Schema.Number, atom: atomA });
    const chB = channel({ name: "strs", schema: Schema.String, atom: atomB });

    const response = await Effect.runPromise(
      serveGroup({
        channels: [
          { channel: chA, source: Effect.succeed(42), interval: "50 millis" },
          { channel: chB, source: Effect.succeed("hi"), interval: "50 millis" },
        ],
      }),
    );

    const body = response.body.value as ReadableStream<Uint8Array>;
    const events = await readEvents(body, 2);
    const all = events.join("");
    // Both channels should appear
    expect(all).toContain("event: nums");
    expect(all).toContain("event: strs");
  });
});
```

**Step 2: Run tests**

Run: `cd packages/fibrae && bun test src/live/live.test.ts`
Expected: PASS

**Step 3: Commit**

```
test: add LiveSync channel, serve, and serveGroup tests
```

---

### Task 3: Documentation

**Files:**

- Create: `docs/live-sync.md`

**Step 1: Write docs**

Reference doc covering architecture, API, and usage examples for single + multiplexed channels. Keep concise — one page.

**Step 2: Commit**

```
docs: add LiveSync reference documentation
```

---

### Task 4: Demo — server-side live clock

**Files:**

- Modify: `packages/demo/server/index.ts` (add `/ssr/live` route + `/api/live/clock` SSE endpoint)

**Step 1: Add live clock SSE endpoint and SSR page**

- Define a `ClockChannel` with `Schema.String` and an atom
- Use `LiveSync.serve(ClockChannel, { source: Effect.sync(() => new Date().toISOString()), interval: "1 second" })`
- Mount at `/api/live/clock`
- Add `/ssr/live` page that renders a simple component and hydration script reference

**Step 2: Demo — client-side hydration**

**Files:**

- Create: `packages/demo/src/ssr-hydrate-live.tsx`

Simple hydration entry that calls `LiveSync.connect(ClockChannel, { url: "/api/live/clock" })` and renders the atom value.

**Step 3: Run dev server and verify**

Run: `bun run dev:server`
Visit: `http://localhost:3001/ssr/live`
Expected: Page shows a live-updating clock timestamp

**Step 4: Commit**

```
feat: add LiveSync clock demo
```
