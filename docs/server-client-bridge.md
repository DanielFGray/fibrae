# Server-Client Bridge Plan

## Goal
Enable Effect and Stream handoff from server to client, similar to React Server Components "passing a promise", but with Effect-native semantics.

## Core Concept
We can't transfer Fibers or Effects across the wire, but we can:
1. Run Effects/Streams on the server for SSR
2. Emit stable tokens into the HTML
3. Resume on the client by reconnecting to a live server-held resource

## Architecture Components

### 1. Server Broker
**Purpose**: Registry for Effects/Streams that need client continuation.

**Interface**:
```typescript
interface Bridge {
  // Register a Promise-like Effect for handoff
  promise<A>(fx: Effect.Effect<A>): BridgePromise<A>
  
  // Register a Stream for continuation
  stream<A>(s: Stream.Stream<A>): BridgeStream<A>
  
  // Generate manifest for client bootstrap
  renderManifest(): Effect.Effect<string>
}

interface BridgePromise<A> {
  id: string              // Unique token for this promise
  status: "resolved" | "pending"
  value?: A              // If resolved during SSR
  effect: Effect.Effect<A> // Original effect
}

interface BridgeStream<A> {
  id: string              // Unique token for this stream
  initial?: A            // First emission captured during SSR
  stream: Stream.Stream<A> // Original stream
}
```

**Lifetime Management**:
- Generate cryptographically random IDs per registration
- Store in Scope-bound registries (one per request/render)
- TTL: 30s default, configurable
- Cleanup on:
  - Client confirms hydration complete
  - Client disconnect/unsubscribe
  - TTL expiry

**State Tracking**:
- Promises: store `Deferred<A>` or resolved value
- Streams: store `Queue<A>` fed by a forked drain fiber
- Reference count for active client subscriptions

### 2. HTML Serialization Updates

**Current State** (packages/lumon/src/server.ts):
- Text nodes wrapped: `<span data-dx-t>text</span>` (line 108)
- No deterministic IDs yet
- No bridge token emission

**Required Changes**:

**Add Path-Based IDs**:
```typescript
// Track path during render traversal
type RenderPath = string; // e.g., "p:0.2.1"

interface RenderContext {
  path: RenderPath;
  bridgeIds: Map<RenderPath, string>; // path -> bridge id
}

// In renderElement, pass context and increment path at each level
const renderElement = (
  element: VElement, 
  ctx: RenderContext
): Effect.Effect<string>
```

**Anchor Attributes**:
```html
<!-- Regular dynamic element -->
<div data-dx="p:0.2.1">content</div>

<!-- Text from bridge promise/stream -->
<span data-dx-t="p:0.2.1:t0" data-dx-bridge="br_abc123">text</span>

<!-- Keyed list item -->
<li data-dx="p:1.3.0" data-dx-k="item-42">content</li>
```

**Bootstrap Manifest**:
```html
<script id="__DX_BRIDGE" type="application/json">
[
  {
    "id": "br_abc123",
    "kind": "promise",
    "status": "resolved",
    "value": {"result": "data"},
    "path": "p:0.2.1:t0"
  },
  {
    "id": "br_def456",
    "kind": "stream",
    "status": "pending",
    "initial": "first emission",
    "path": "p:1.0.0"
  }
]
</script>
```

### 3. Client Hydration

**Hydrate Entry Point**:
```typescript
interface HydrateOptions {
  root: Element;
  app: VElement;
  bridgeUrl?: string; // Default: same origin
}

function hydrate(opts: HydrateOptions): Effect.Effect<void>
```

**Hydration Process**:
1. Parse `__DX_BRIDGE` manifest
2. Scan DOM for anchor attributes, build maps:
   - `pathToNode: Map<RenderPath, Node>`
   - `bridgeIdToMeta: Map<string, BridgeMeta>`
3. Re-run render in "hydrate mode":
   - Components see existing DOM nodes via path lookup
   - Attach event handlers without node recreation
   - For bridge tokens, substitute with live Effects/Streams
4. Start bridge connections for pending/streaming resources

**Bridge Client APIs**:
```typescript
interface BridgeClient {
  // Get Effect that returns cached or fetches from server
  promise<A>(id: string, cached?: A): Effect.Effect<A>
  
  // Get Stream with initial value + server continuation
  stream<A>(id: string, initial: A): Stream.Stream<A>
}
```

### 4. Network Protocol

**Option A: Simple HTTP** (MVP)
- Promise endpoint: `GET /lumon/p/{id}`
  - Returns JSON when resolved
  - Long-poll if pending (with timeout)
- Stream endpoint: `GET /lumon/s/{id}`
  - Server-Sent Events (SSE)
  - Chunked transfer encoding
  - Client closes connection when done

**Option B: WebSocket** (Better)
- Multiplexed by ID over single connection
- Backpressure via Queue
- Heartbeat for disconnect detection
- Protocol:
  ```typescript
  type Message = 
    | { type: "promise", id: string, value: unknown }
    | { type: "stream-next", id: string, value: unknown }
    | { type: "stream-done", id: string }
    | { type: "stream-error", id: string, error: unknown }
    | { type: "unsubscribe", id: string }
    | { type: "heartbeat" }
  ```

### 5. Component Usage Patterns

**Promise Handoff**:
```typescript
const DataComponent: Component = () => Effect.gen(function*() {
  const bridge = yield* Bridge;
  
  // This Effect runs on server, might still be pending
  const dataPromise = bridge.promise(
    Effect.gen(function*() {
      yield* Effect.sleep(1000);
      return { users: ["Alice", "Bob"] };
    })
  );
  
  const data = yield* dataPromise.effect;
  
  return h("div", {}, [
    h("h1", {}, ["Users"]),
    h("ul", {}, data.users.map(u => h("li", {}, [u])))
  ]);
});

// SSR: renders with resolved data or Suspense fallback
// Client: hydrates and resumes if pending
```

**Stream Continuation**:
```typescript
const LiveCounterComponent: Component = () => Effect.gen(function*() {
  const bridge = yield* Bridge;
  
  // Stream starts on server, continues on client
  const ticker = bridge.stream(
    Stream.make(0, 1, 2).pipe(
      Stream.concat(
        Stream.iterate(3, n => n + 1).pipe(
          Stream.schedule(Schedule.spaced("1 second"))
        )
      )
    )
  );
  
  // Return stream directly; renderer handles subscription
  return ticker.stream.pipe(
    Stream.map(n => h("div", {}, [`Count: ${n}`]))
  );
});

// SSR: renders with initial: 0
// Client: hydrates and continues stream (1, 2, 3, 4, ...)
```

### 6. Security Considerations

**ID Generation**:
- Use `crypto.randomUUID()` or Effect's random service
- Never expose sequential IDs (avoid enumeration attacks)

**Value Serialization**:
- Only serialize JSON-safe values in manifest
- Large payloads go over bridge channel, not inline HTML
- Consider max inline size limit (e.g., 1KB)

**Environment Isolation**:
- Never try to serialize Effect context R
- Server-only services must not leak to client
- Bridge only passes values/events, not capabilities

**Rate Limiting**:
- Limit concurrent bridge connections per client
- Limit pending promise/stream registrations per request
- Implement TTL cleanup to prevent memory leaks

### 7. Implementation Phases

#### Phase 1: Foundation (Required First)
**Prerequisite**: Fix current issues before adding bridge
- [ ] Fix stream detection bug (packages/lumon/src/server.ts:129)
  - Replace `Symbol.iterator in result` with proper `Stream.isStream(result)` guard
  - Keep arrays as children, not streams
- [ ] Add deterministic path IDs to all nodes
  - Pass `RenderContext` through `renderElement`
  - Generate path like `p:0.2.1` (parent:child-index.grandchild-index...)
  - Emit `data-dx="path"` on elements, `data-dx-t="path"` on text spans
- [ ] Add `data-dx-k="key"` for keyed list items
- [ ] Filter non-serializable attributes (skip function/object values except style/class)

#### Phase 2: Bridge Server
- [ ] Implement `Bridge` service with Layer
  - Registry: `Map<string, BridgeEntry>`
  - Entry types: `PromiseEntry<A>`, `StreamEntry<A>`
- [ ] Add `bridge.promise<A>()` with Deferred storage
- [ ] Add `bridge.stream<A>()` with Queue + drain fiber
- [ ] Implement manifest generation with JSON output
- [ ] Add Scope-based cleanup and TTL expiry
- [ ] HTTP endpoints for promise/stream access (SSE for streams)

#### Phase 3: SSR Integration
- [ ] Update `renderElement` to accept optional `Bridge` service
- [ ] Detect `BridgePromise`/`BridgeStream` returns from components
- [ ] Emit bridge tokens in anchor attributes: `data-dx-bridge="id"`
- [ ] Include manifest in HTML: `<script id="__DX_BRIDGE">...</script>`
- [ ] Tests: SSR with bridge promise (resolved/pending), bridge stream (first value)

#### Phase 4: Client Hydration
- [ ] Implement `BridgeClient` service
- [ ] Parse `__DX_BRIDGE` manifest on client
- [ ] Scan DOM anchors and build path→node map
- [ ] Implement `hydrate(root, app, bridgeUrl?)` entry point
  - Re-run render in "hydrate mode"
  - Adopt nodes by path
  - Attach event handlers
  - Substitute bridge tokens with live Effects/Streams
- [ ] Connect to server for pending promises and streaming continuations
- [ ] Tests: hydrate with resolved promise, hydrate with pending promise, stream continuation

#### Phase 5: Advanced Features
- [ ] WebSocket multiplexing (replace SSE)
- [ ] Backpressure and flow control
- [ ] Heartbeat and disconnect detection
- [ ] Streaming SSR (flush chunks at boundaries)
- [ ] Suspense + bridge interaction
- [ ] Error boundary + bridge error propagation

### 8. Integration with Existing Code

**Fiber Fields** (packages/lumon/src/rewrite.ts:33-52):
- `latestStreamValue` (line 47): use for SSR first emission capture
- `componentScope` (line 45): attach bridge cleanup to this
- No new fiber fields needed; bridge is Layer-provided service

**Current SSR** (packages/lumon/src/server.ts):
- Keep `renderToString` signature
- Add optional `Bridge` layer to Effect context
- Components opt-in by calling `Bridge.promise`/`Bridge.stream`

**Environment Strategy**:
- Server: one-shot semantics (already present for streams at line 129)
- Client: full reactivity with bridge reconnection
- Future: add `LumonEnv` service to formalize this (from previous plan)

### 9. Testing Strategy

**Unit Tests**:
- Bridge registration and ID generation
- Manifest serialization
- Path ID generation during traversal
- Anchor attribute emission
- Client manifest parsing

**Integration Tests**:
- SSR → hydrate round-trip with bridge promise (resolved)
- SSR → hydrate round-trip with bridge promise (pending, completes on client)
- SSR → hydrate with bridge stream continuation
- Multiple bridges in same render
- Bridge cleanup on disconnect
- TTL expiry

**E2E Tests** (Cypress):
- Render component with bridge promise on server
- Verify SSR HTML contains manifest and anchors
- Hydrate and verify DOM not recreated
- Verify event handlers attached after hydration
- Stream emits subsequent values on client
- Error handling for failed bridge connections

### 10. Open Questions

1. **Serialization format**: JSON only, or support binary (MessagePack, etc.)?
2. **Chunking strategy**: Should large initial values go in manifest or separate fetch?
3. **Backpressure**: How to handle slow clients on stream bridge?
4. **Multi-tenancy**: Per-connection or per-request bridge scope?
5. **Static generation**: Should bridges work for static mode (no server), or only server/dom?

## Related Docs
- `./typed-ssr-apis.md` - Typed's approach (we're NOT copying their APIs/markers)
- `./rewrite-plan.md` - Original fiber architecture
- `./effect-atom-core.md` - Atom APIs for reactivity
- `./effect-docs.md` - Effect primitives used in bridge

## Non-Goals (Keep Scope Tight)
- Do NOT implement React Server Components' specific APIs
- Do NOT use comment markers (we use attribute anchors)
- Do NOT try to serialize Effect context R or Fibers
- Do NOT implement client-side routing (out of scope)
- Do NOT add GraphQL/tRPC integration (separate concern)

## Success Criteria
- Component returns `Effect<A>` → SSR renders result, client adopts node
- Component returns `Stream<A>` → SSR renders first emission, client continues stream
- Zero node recreation during hydration (verify in tests)
- Bridge connections close cleanly on unmount/disconnect
- No memory leaks (verify with TTL cleanup tests)
