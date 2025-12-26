# Suspense Fiber Design: Optimistic Rendering with Fiber Parking

## Overview

This document describes the implementation of Suspense in fibrae's fiber-based renderer using an **optimistic approach** where:

1. Children are attempted first
2. If they take longer than threshold, fallback is shown
3. Suspended fibers are **parked** (continue processing in background)
4. When parked fibers complete, content swaps back

This differs from React's throw-based approach - we use Effect's structured concurrency.

## Key Insight: Effect vs React

| Aspect            | React                         | Fibrae (Effect)                   |
| ----------------- | ----------------------------- | --------------------------------- |
| Suspension signal | Component throws Promise      | Stream blocks on first emit       |
| Detection         | try/catch in work loop        | Race Effect vs timeout            |
| Recovery          | Promise.then() triggers retry | Deferred completion signals ready |
| Fiber state       | Thrown away on suspend        | Parked, continues in background   |

## Architecture

### Data Structures

**SuspenseConfig** (in `shared.ts`):

```typescript
export type SuspenseConfig = {
  fallback: VElement;
  threshold: number;
  showingFallback: boolean;
  // Reference to the original child fiber that's still processing
  parkedFiber: Option.Option<Fiber>;
  // Deferred that signals when parked fiber completes first render
  parkedComplete: Option.Option<Deferred.Deferred<void>>;
};
```

### Flow Diagram

```
INITIAL RENDER:
═══════════════

1. workLoop processes SUSPENSE fiber
   └─► updateHostComponent(SUSPENSE)
       └─► reconcileChildren(children)
       └─► returns, child fiber becomes next work unit

2. workLoop processes child (stream component)
   └─► updateFunctionComponent
       └─► Fork stream subscription
       └─► Race: Deferred.await(firstValue) vs threshold
           │
           ├─► VALUE WINS (before threshold):
           │   └─► Normal render, no suspension
           │
           └─► TIMEOUT WINS (threshold expires):
               └─► handleFiberSuspension(fiber)
                   ├─► Mark boundary.showingFallback = true
                   ├─► Store fiber in boundary.parkedFiber
                   ├─► Create parkedComplete deferred
                   ├─► queueFiberForRerender(boundary)
                   └─► Continue waiting for value (don't abort!)

3. Boundary re-renders (from queue)
   └─► updateHostComponent(SUSPENSE)
       └─► showingFallback = true
       └─► reconcileChildren([fallback])
       └─► Fallback renders and commits

4. Meanwhile, parked fiber continues...
   └─► Deferred.await(firstValue) finally resolves
       └─► signalFiberReady(fiber)
           ├─► Deferred.succeed(parkedComplete)
           └─► queueFiberForRerender(boundary)

5. Boundary re-renders again
   └─► updateHostComponent(SUSPENSE)
       └─► parkedComplete is done, restore parked fiber
       └─► showingFallback = false
       └─► reconcileChildren(children) - reuses parked fiber state
```

### Visual State Machine

```
                    ┌──────────────────┐
                    │   SUSPENSE       │
                    │   BOUNDARY       │
                    └────────┬─────────┘
                             │
              ┌──────────────┴──────────────┐
              │                             │
     [showingFallback=false]       [showingFallback=true]
              │                             │
      ┌───────▼───────┐             ┌───────▼───────┐
      │   Children    │             │   Fallback    │
      │  (rendering)  │             │  (visible)    │
      └───────┬───────┘             └───────┬───────┘
              │                             │
              │ timeout expires             │ parkedComplete resolves
              │                             │
              └──────────►◄─────────────────┘
                    swap
```

## Implementation Components

### 1. findNearestSuspenseBoundary

Walk up fiber tree to find nearest Suspense boundary:

```typescript
const findNearestSuspenseBoundary = (fiber: Fiber): Option.Option<Fiber> => {
  let current: Option.Option<Fiber> = fiber.parent;
  while (Option.isSome(current)) {
    const f = current.value;
    if (Option.isSome(f.suspense)) return Option.some(f);
    current = f.parent;
  }
  return Option.none();
};
```

### 2. handleFiberSuspension

Called when threshold expires before first stream emission:

```typescript
const handleFiberSuspension = (
  fiber: Fiber,
): Effect.Effect<void, never, FibraeRuntime> =>
  Effect.gen(function* () {
    const boundaryOpt = findNearestSuspenseBoundary(fiber);
    if (Option.isNone(boundaryOpt)) {
      // No Suspense boundary - just continue waiting
      return;
    }

    const boundary = boundaryOpt.value;
    const config = Option.getOrThrow(boundary.suspense);

    if (config.showingFallback) {
      // Already suspended - first suspension wins
      return;
    }

    // Create deferred for parked fiber completion
    const parkedComplete = yield* Deferred.make<void>();

    // Park the fiber and switch to fallback
    config.showingFallback = true;
    config.parkedFiber = Option.some(fiber);
    config.parkedComplete = Option.some(parkedComplete);

    // Trigger re-render of boundary with fallback
    yield* queueFiberForRerender(boundary);
  });
```

### 3. signalFiberReady

Called when parked fiber finally gets its first emission:

```typescript
const signalFiberReady = (
  fiber: Fiber,
): Effect.Effect<void, never, FibraeRuntime> =>
  Effect.gen(function* () {
    const boundaryOpt = findNearestSuspenseBoundary(fiber);
    if (Option.isNone(boundaryOpt)) return;

    const boundary = boundaryOpt.value;
    const config = Option.getOrThrow(boundary.suspense);

    // Signal that parked fiber is ready
    yield* Option.match(config.parkedComplete, {
      onNone: () => Effect.void,
      onSome: (deferred) => Deferred.succeed(deferred, undefined),
    });

    // Trigger re-render to swap fallback → children
    yield* queueFiberForRerender(boundary);
  });
```

### 4. updateFunctionComponent Changes

Add racing logic after forking stream subscription:

```typescript
// After: yield* Effect.forkIn(subscription, scope);

// Find threshold from nearest Suspense boundary
const suspenseBoundary = findNearestSuspenseBoundary(fiber);
const threshold = Option.match(suspenseBoundary, {
  onNone: () => 0,
  onSome: (b) =>
    Option.match(b.suspense, {
      onNone: () => 0,
      onSome: (cfg) => cfg.threshold,
    }),
});

let firstVElement: VElement;

if (threshold > 0) {
  // Race first value vs threshold
  const result =
    yield *
    Effect.race(
      Deferred.await(firstValueDeferred).pipe(
        Effect.map((v) => ({ _tag: "value" as const, value: v })),
      ),
      Effect.sleep(`${threshold} millis`).pipe(
        Effect.map(() => ({ _tag: "timeout" as const })),
      ),
    );

  if (result._tag === "timeout") {
    // Threshold expired - signal suspension
    yield * handleFiberSuspension(fiber);

    // Continue waiting for the actual value
    firstVElement = yield * Deferred.await(firstValueDeferred);

    // Signal that we're ready now
    yield * signalFiberReady(fiber);
  } else {
    firstVElement = result.value;
  }
} else {
  // No threshold - wait indefinitely
  firstVElement = yield * Deferred.await(firstValueDeferred);
}

fiber.latestStreamValue = Option.some(firstVElement);
yield * reconcileChildren(fiber, [firstVElement]);
```

### 5. updateHostComponent SUSPENSE Handling

Simplified - just check flags and reconcile:

```typescript
if (isSuspense) {
  const fallback = fiber.props.fallback as VElement;
  const threshold = (fiber.props.threshold as number) ?? 100;
  const children = fiber.props.children as VElement[] | undefined;

  // Initialize suspense config
  if (Option.isNone(fiber.suspense)) {
    fiber.suspense = Option.some({
      fallback,
      threshold,
      showingFallback: false,
      parkedFiber: Option.none(),
      parkedComplete: Option.none(),
    });
  }

  const config = Option.getOrThrow(fiber.suspense);

  // Check if parked fiber has completed
  const parkedDone =
    yield *
    Option.match(config.parkedComplete, {
      onNone: () => Effect.succeed(false),
      onSome: (d) => Deferred.isDone(d),
    });

  if (parkedDone && config.showingFallback) {
    // Parked fiber is ready - switch back to children
    config.showingFallback = false;
    config.parkedFiber = Option.none();
    config.parkedComplete = Option.none();
  }

  if (config.showingFallback) {
    // Show fallback while children are suspended
    yield * reconcileChildren(fiber, [fallback]);
  } else {
    // Show children normally
    yield * reconcileChildren(fiber, children || []);
  }
  return;
}
```

## Edge Cases

### 1. Nested Suspense Boundaries

Each stream component finds its **nearest** boundary. Inner boundaries handle their children independently.

```
<Suspense fallback={A}>        ← boundary 1
  <Suspense fallback={B}>      ← boundary 2
    <SlowComponent />          → suspends to boundary 2
  </Suspense>
  <AnotherSlowComponent />     → suspends to boundary 1
</Suspense>
```

### 2. Multiple Suspended Children

Current design: **First to suspend wins**. All children contribute to same parkedComplete.

Future consideration: Track multiple parked fibers, wait for all to complete.

### 3. Error During Suspension

ErrorBoundary takes precedence. In `handleFiberError`:

- If fiber is parked, error propagates to ErrorBoundary
- ErrorBoundary fallback replaces Suspense fallback

### 4. Threshold = 0

No suspension possible - wait indefinitely for children. Threshold race is skipped.

### 5. Fast Children

If stream emits before threshold, no suspension occurs. Fallback never shows.

### 6. Unmount During Suspension

If Suspense boundary unmounts while fiber is parked:

- Parked fiber's scope should be closed
- Stream subscription cancelled automatically via scope

## Open Questions

### Q1: Fiber State Preservation

When swapping back to children, how do we reuse the parked fiber's computed state?

**Options:**

- A) Restore parked fiber directly into tree (complex tree surgery)
- B) Create new fibers, copy `latestStreamValue` from parked (simpler)
- C) Let reconciliation handle via `alternate` mechanism (needs investigation)

**Recommendation:** Start with (B), iterate to (C) if needed.

### Q2: Multiple Children Suspension

Should we track ALL parked fibers or just first?

**Current:** First wins (simplest)
**Future:** Track all, wait for all to complete before swapping

### Q3: Parked Fiber Scope

Should parked fibers share the Suspense boundary's scope?

**Yes:** Automatic cleanup on boundary unmount
**No:** Independent lifecycle, need manual cleanup

**Recommendation:** Yes - use boundary scope for parked fiber subscriptions.

## Related Issues

- `fibrae-wav` - Port Suspense support to fiber architecture (blocked)
- `fibrae-96k` - Implement optimistic Suspense with fiber parking
- `fibrae-v3m` - Revisit error handling architecture

## Related Docs

- `SUSPENSE_RESEARCH.md` - React Suspense mechanism research
- `react-suspense-fiber-architecture.md` - How React does it
- `suspense-implementation-guide.md` - React-style implementation checklist

## Implementation Checklist

- [ ] Update `SuspenseConfig` type in `shared.ts`
- [ ] Add `findNearestSuspenseBoundary` function
- [ ] Add `handleFiberSuspension` function
- [ ] Add `signalFiberReady` function
- [ ] Modify `updateFunctionComponent` with racing logic
- [ ] Simplify `updateHostComponent` SUSPENSE handling
- [ ] Update `createFiber` to initialize new suspense fields
- [ ] Add tests for:
  - [ ] Fast children (no fallback)
  - [ ] Slow children (fallback then content)
  - [ ] Threshold = 0 (no fallback ever)
  - [ ] Nested Suspense
  - [ ] Error during suspension
  - [ ] Unmount during suspension
