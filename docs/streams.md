# Stream Handling in Didact

## Problem Statement

Components can return `Stream<VElement>` with multiple emissions over time. We need to:
1. Get the **first emission synchronously** for initial render (blocking)
2. Subscribe to **subsequent emissions asynchronously** to trigger rerenders (background)
3. Avoid consuming the stream twice (streams can only be consumed once in Effect)
4. Properly manage cleanup via component scope

## Current Architecture

### Fiber Structure
```typescript
export interface Fiber {
  type: Option.Option<ElementType>;
  props: { [key: string]: unknown; children?: VElement[] };
  dom: Option.Option<Node>;
  parent: Option.Option<Fiber>;
  child: Option.Option<Fiber>;
  sibling: Option.Option<Fiber>;
  alternate: Option.Option<Fiber>;
  effectTag: Option.Option<"UPDATE" | "PLACEMENT" | "DELETION">;
  componentScope: Option.Option<Scope.Scope>;  // For managing subscriptions
  accessedAtoms: Option.Option<Set<BaseAtom.Atom<any>>>;  // Atoms accessed during render
  latestStreamValue: Option.Option<VElement>;  // Cache of last stream emission
}
```

### Component Patterns
Based on `packages/demo/src/demo-effect.ts`:

**Pattern 1: Stateless Stream Components**
- Return `Stream<VElement>` directly
- Do NOT use Atoms
- Example: `StreamCounter` - emits 5 VElements over time with schedule

**Pattern 2: Stateful Reactive Components**
- Use Atoms for state
- Return `Effect<VElement>` or plain `VElement`
- Example: `Counter`, `TodoList`

**Key Insight**: Components either return Streams OR use Atoms, not both.

### Cached Value Optimization
Lines 429-444 in `rewrite.ts`:
```typescript
// Check if this is a rerender with cached stream value
const hasAlternate = Option.isSome(fiber.alternate);
const hasCachedValue = Option.match(fiber.alternate, {
  onNone: () => false,
  onSome: (alt) => Option.isSome(alt.latestStreamValue)
});

if (hasAlternate && hasCachedValue) {
  // This is a rerender triggered by stream emission - use cached value
  // Skip component re-execution to avoid forking new stream subscriptions
  const alt = Option.getOrThrow(fiber.alternate);
  const vElement = Option.getOrThrow(alt.latestStreamValue);

  fiber.latestStreamValue = alt.latestStreamValue;
  fiber.accessedAtoms = alt.accessedAtoms;

  yield* reconcileChildren(fiber, [vElement]);
  return;
}
```

This optimization prevents re-running stream components on every emission, which would fork multiple subscriptions.

## What We Tried (That Failed)

### ❌ Attempt 1: Stream.runHead + Stream.runForEach
```typescript
// Get first emission
const firstVElement = yield* Stream.runHead(stream);

// Subscribe to remaining
const remainingStream = stream.pipe(Stream.drop(1));
yield* Effect.forkIn(Stream.runForEach(remainingStream, ...), scope);
```

**Problem**: Can't consume stream twice. After `runHead`, the stream is exhausted.

### ❌ Attempt 2: Stream.broadcast(2)
```typescript
const [stream1, stream2] = yield* Stream.broadcast(stream, 2);
const firstValue = yield* Stream.runHead(stream1);
yield* Effect.forkIn(Stream.runForEach(stream2, ...), scope);
```

**Problem**: Type errors with `broadcast` API usage. Wasn't clear how to properly split the stream.

### ❌ Attempt 3: Fork + Ref + Sleep
```typescript
const firstValueRef = yield* Ref.make(Option.none<VElement>());
yield* Effect.forkIn(Stream.runForEach(stream, (v) => Ref.set(firstValueRef, Option.some(v))), scope);
yield* Effect.sleep("10 millis");
const firstValue = yield* Ref.get(firstValueRef);
```

**Problem**: Race condition - sleep time is arbitrary, not guaranteed to wait for first emission.

### ❌ Attempt 4: Stream.toPull (Current broken state)
```typescript
const pull = yield* Stream.toPull(stream);
const firstChunkOption = yield* pull;
// ... extract first value from chunk ...
// ... loop to pull remaining values ...
```

**Problem**: Multiple TypeScript errors:
- `Stream.toPull` returns `Effect<Option<Chunk<A>>>` not `Option<Chunk<A>>`
- Needed `Chunk.toArray()` instead of `Array.from()`
- Incorrect `yield*` placement in `Option.match`
- Complex error handling with chunks and options
- Code became too complex and hard to reason about

**Location**: Lines 479-548 in `packages/didact/src/rewrite.ts`

## ✅ Correct Solution: Deferred + Stream.runForEach

### Why This Works

`Deferred` is Effect's synchronization primitive - a one-time variable that:
- Can be completed once with a value
- Blocks fibers that `await` it until completed
- Provides clean sync/async coordination

### Implementation Pattern

```typescript
const updateFunctionComponent = Effect.fn("updateFunctionComponent")((fiber: Fiber) =>
  Effect.gen(function*() {
    // ... setup code (tracking registry, call component, normalize to stream) ...

    const stream = normalizeToStream(output).pipe(
      Stream.provideService(Registry.AtomRegistry, trackingRegistry),
      Stream.provideService(DidactRuntime, runtime),
      Stream.provideService(FiberContext, { fiber })
    );

    // Create deferred for first emission
    const firstValueDeferred = yield* Deferred.make<VElement>();

    // Get or create component scope
    const scope = yield* Option.match(fiber.componentScope, {
      onNone: () => Scope.make().pipe(Effect.tap((s) => Effect.sync(() => {
        fiber.componentScope = Option.some(s);
      }))),
      onSome: (s) => Effect.succeed(s)
    });

    // Fork stream subscription into scope
    const subscription = Stream.runForEach(stream, (vElement) =>
      Effect.gen(function*() {
        const done = yield* Deferred.isDone(firstValueDeferred);
        if (!done) {
          // First emission: complete the deferred
          yield* Deferred.succeed(firstValueDeferred, vElement);
        } else {
          // Subsequent emissions: update cache and queue rerender
          fiber.latestStreamValue = Option.some(vElement);
          yield* queueFiberForRerender(fiber).pipe(
            Effect.provideService(DidactRuntime, runtime)
          );
        }
      })
    ).pipe(
      // Ensure we don't hang if the stream fails before first emission
      Effect.catchAllCause((cause) => Effect.gen(function*() {
        const done = yield* Deferred.isDone(firstValueDeferred);
        if (!done) {
          yield* Deferred.failCause(firstValueDeferred, cause);
        }
        yield* Effect.log(`[Stream Error] ${String(cause)}`);
      }))
    );

    yield* Effect.forkIn(subscription, scope);

    // Wait for first emission (blocks until available - no race condition!)
    const firstVElement = yield* Deferred.await(firstValueDeferred);

    // Store first value and reconcile
    fiber.latestStreamValue = Option.some(firstVElement);
    fiber.accessedAtoms = Option.some(accessedAtoms);
    yield* resubscribeFiber(fiber, accessedAtoms);
    yield* reconcileChildren(fiber, [firstVElement]);
  })
);
```

### Required Imports
```typescript
import * as Deferred from "effect/Deferred";
```

### Benefits
- ✅ Single stream consumption (no duplicate subscriptions)
- ✅ Synchronous access to first value via `Deferred.await`
- ✅ No race conditions (deferred blocks until completed)
- ✅ Clean separation: first emission vs subsequent emissions
- ✅ Proper cleanup via scope (all forked fibers cleaned up)
- ✅ Type-safe and straightforward

## Fallback Support for Pending Streams

### Problem

Components that return `Stream<VElement>` or `Effect<VElement>` may not emit their first value immediately. This creates a timing gap where:
- The component fiber exists but has no DOM to render
- Tests with tight timeouts (e.g., 250ms) fail looking for elements that don't exist yet
- Users see a blank/missing section until the first emission

Example: `StreamCounter` with `Schedule.spaced("500 millis")` blocks for 500ms before first emission, exceeding Cypress's 250ms default timeout.

### Solution: `Suspense` with Runtime Readiness (Option A)

Provide a wrapper component that renders a fallback immediately and only swaps to its children after the runtime signals that a child has performed its first DOM commit.

**API Design:**
```typescript
// Single child (recommended)
h(Suspense, { fallback: h("div", {}, ["Loading..."]) }, [
  h(StreamCounter, {})
])

// Multiple children (initial version waits for FIRST child commit)
h(Suspense, { fallback: h("div", {}, ["Loading data..."]) }, [
  h(AsyncDataFetcher, {}),
  h(AnotherAsyncComponent, {})
])

// Optional future: mode to wait for 'any' (default) or 'all'
// h(Suspense, { fallback, mode: "all" }, children)

// No children: throws
h(Suspense, { fallback: h("div", {}, ["Loading..."]) }, [])  // ❌ Error
```

**Runtime Readiness Signal (Renderer Hook):**
- Add a per-fiber deferred that completes when any direct child performs its first DOM commit.
- Implementation sketch:
  - During `updateFunctionComponent` entry, allocate `fiber.childFirstCommitDeferred: Deferred<void>`.
  - In the commit phase, when a child fiber commits DOM for the first time (PLACEMENT or first UPDATE creating a node), check `child.parent`; if `parent.childFirstCommitDeferred` exists and is not done, complete it.
  - Ensure the parent deferred resets on re-execution (new fiber instance) and is cancelled/ignored on unmount via scope finalizer.

**Suspense Component Behavior:**
1. Emits fallback immediately (first stream emission).
2. Awaits `childFirstCommitDeferred` of its own fiber (provided via `FiberContext`/service).
3. After the deferred completes, emits a fragment containing all `children` VElements (second emission), which triggers a rerender via the normal stream path.
4. Children execute and reconcile normally on that rerender.

**Why Option A fixes timing:**
- The fallback stays visible until at least one child produces real DOM.
- No pre-execution of children inside Suspense; execution remains in the renderer, preserving service context and atom tracking.
- Avoids flakiness where a synchronous second emission would replace fallback too early.

**Implementation Pattern (conceptual):**
```typescript
export const Suspense = (props: { 
  fallback: VElement;
  children: VElement[];
  // future: mode?: "any" | "all";
}): Stream.Stream<VElement> => {
  if (!props.children || props.children.length === 0) {
    throw new Error("Suspense requires at least one child");
  }

  return Stream.unwrap(Effect.gen(function* () {
    const { fiber } = yield* FiberContext; // service to access current fiber
    // Defer completes when any direct child commits its first DOM
    const waitForChildCommit = yield* getChildFirstCommitAwaiter(fiber); // Effect<void>

    return Stream.concat(
      Stream.succeed(props.fallback),
      Stream.fromEffect(waitForChildCommit).pipe(
        Stream.as(h([], props.children)) // children fragment
      )
    );
  }));
};
```

> `getChildFirstCommitAwaiter` is provided by the runtime and uses the per-fiber deferred described above. For the initial version, it resolves on the first child commit ("any"). A future "all" mode can be implemented with a small countdown latch when creating direct children.

**Runtime Behavior:**
1. User wraps async component(s) with `Suspense`.
2. `Suspense` emits `fallback` immediately and blocks its second emission on `childFirstCommitDeferred`.
3. Children are reconciled on the second emission; their own streams/effects run normally.
4. Fallback remains visible until a child commits; then the children fragment replaces it.
5. Subsequent child stream emissions go through the cached rerender path.

**Benefits:**
- ✅ Immediate DOM presence (fallback renders synchronously)
- ✅ Fallback persists until a child actually renders DOM
- ✅ No arbitrary delays or sleeps; no pre-execution hacks
- ✅ Leverages existing deferred-based stream subscription and reconciliation
- ✅ Compatible with both `Stream` and `Effect` children
- ✅ Extensible to "all children" with a small runtime latch

## Edge Cases & Error Handling

### Suspense-Specific Edge Cases

1. Multiple Children
- Initial behavior: swap when the FIRST direct child commits ("any").
- Future: add `mode: "all"` to wait for all direct children. Implement with a countdown latch that completes when all direct children have performed their first commit.
- Tests: verify fallback remains until first child commits; optionally add a pending test for `mode: "all"` once implemented.

2. No Children ❌
- Throw `Error("Suspense requires at least one child")`.

3. Non-async Child ✅
- Commits immediately; fallback will swap very quickly. Document potential brief flicker.

4. Child Throws/Fails During Execution 🚧
- Current: error propagates and crashes the child fiber.
- Future: Error Boundary component should catch and render an error state.

5. Nested Suspense ✅
- Works naturally; each Suspense listens for its own children’s first commit.

6. Child Continues Emitting After Mount ✅
- Normal behavior via cached rerender path.

7. Suspense with Atom-based Children ✅
- Works: first commit happens after the Effect first render, then later atom updates rerender normally.

8. Never-committing Children ✅
- If a child never produces DOM (e.g., never emits), fallback remains indefinitely.
- Optional future: `timeoutMs` prop to transition or show an error state.

9. Unmount Races ✅
- Ensure commit hook checks that the parent fiber is still mounted/open before completing its deferred, or ignore rerendering if scope is closed. Add a mounted flag or use scope finalizer.

10. Service Context Propagation ✅
- Children get proper `FiberContext` through normal `updateFunctionComponent` after the second emission. Atom memoization remains correct.

11. Data-cy Attributes in Tests 🚧
- Ensure fallback mirrors expected structure to make tests deterministic (e.g., `data-cy` selectors).

### General Stream Edge Cases

- Early stream failure
  - Catch failures in the subscription and, if the first value was not emitted yet, `Deferred.failCause` the deferred to avoid hanging the initial render.
  - With Suspense: the fallback remains; an Error Boundary can surface the error.
  
- Never-emitting streams
  - With Suspense: fallback shows indefinitely (or until `timeoutMs`, if implemented).
  - Without Suspense: `Deferred.await` blocks forever; consider an optional renderer-level timeout that suggests wrapping in Suspense.
  
- Stream completion
  - No special action needed. When the stream completes, the background fiber ends; the last cached value remains and rerenders stop.
  
- Very fast emitters/bursts
  - Existing rerender batching with a Set-backed queue deduplicates multiple emissions per microtask, preventing thrash.
  
- Fallback with cached stream values
  - The cached value optimization handles rerenders. Fallback only applies to initial mount before any child first commit.

### Execution Flow

**Initial Render (Stream component):**
1. Component returns Stream.
2. Fork subscription with `runForEach` into scope.
3. Block on `Deferred.await` waiting for first emission.
4. First emission completes deferred, unblocks await.
5. Reconcile with first value.
6. Background fiber continues processing subsequent emissions.

**Initial Render (Suspense):**
1. Suspense emits fallback synchronously.
2. Runtime allocates `childFirstCommitDeferred` for Suspense fiber.
3. When any direct child first commits DOM, runtime completes the deferred.
4. Suspense second emission (children fragment) occurs, triggering rerender; children reconcile and mount.

**Subsequent Stream Emissions:**
1. Background fiber processes new emission.
2. Updates `fiber.latestStreamValue`.
3. Queues rerender.
4. Rerender uses cached value and reconciles.

**Atom Changes (non-stream components):**
1. Atom changes trigger rerender.
2. Component re-runs with new atom values.
3. Returns new VElement (not a stream).
4. Normal reconciliation.

## Implementation Steps

### Phase 1: Core Deferred Pattern (✅ Complete)
1. ✅ Add import: `import * as Deferred from "effect/Deferred";` (around line 1-12)
2. ✅ Replace lines 479-548 (broken `Stream.toPull` code) with the Deferred pattern above using `Deferred.isDone` and `catchAllCause` to handle early failures.
3. ✅ Keep cached value optimization at lines 429-444 as-is
4. ✅ Remove `Chunk` import if it was added (no longer needed)

### Phase 2: Fallback Support with Runtime Readiness (🚧 Planned)
1. Add runtime hook for child-first-commit:
   - Allocate `childFirstCommitDeferred` per fiber on `updateFunctionComponent` entry.
   - Complete when any direct child first commits DOM; guard with mounted/closed-scope checks.
2. Implement `Suspense` in `packages/didact/src/rewrite.ts`:
   - Validate `children` non-empty.
   - Build stream: `Stream.concat(Stream.succeed(fallback), Stream.fromEffect(getChildFirstCommitAwaiter(currentFiber)).pipe(Stream.as(childrenFragment)))`.
3. Export `Suspense` from `packages/didact/src/index.ts`.
4. Update demo `StreamCounter` usage to wrap with `Suspense` and ensure `data-cy` attributes match tests.
5. Optional (future): add `mode?: "any" | "all"` and `timeoutMs?: number`.

### Phase 3: Testing & Validation
1. Run build: `bun run build`
2. Run tests: `bun --filter demo cypress:run`
3. Check specific stream test: `bun --filter demo cypress:run -- --spec cypress/e2e/stream-components.cy.ts`
4. Verify:
   - Fallback appears immediately (within 250ms) and persists until first child commit (~500ms in demo)
   - Children replace fallback on commit, then update with subsequent emissions
   - No infinite loops or duplicate subscriptions
   - No rerenders after unmount (add a test)

## Test Expectations

From `packages/demo/cypress/e2e/stream-components.cy.ts`:

StreamCounter should:
1. Initially show "Loading..."
2. After ~500ms show "Ready: 3"
3. After ~1000ms show "Ready: 2"
4. After ~1500ms show "Ready: 1"
5. After ~2000ms show "Complete!"
6. Stay in final state (no more emissions)

This validates that:
- Fallback renders immediately and remains until a child first commits
- Subsequent emissions trigger updates
- Stream completes properly
- No infinite loops

## Related Files

- Main implementation: `packages/didact/src/rewrite.ts`
  - Lines 416-550: `updateFunctionComponent` (ready signal + Suspense live here)
  - Lines 429-444: Cached value optimization (keep as-is)

- Test component: `packages/demo/src/demo-effect.ts`
  - Lines 57-99: `StreamCounter` component

- E2E tests: `packages/demo/cypress/e2e/stream-components.cy.ts`

## References

- Effect Deferred docs: `./effect-docs.md` or https://effect.website/docs/concurrency/deferred
- effect-ui implementation: `packages/effect-ui/src/dom.tsx` (uses marker comments + runForEach, different approach)
