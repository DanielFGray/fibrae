## Didact Rewrite Plan (Effect-First, Atom-Driven)

### Goals
- Components are Effect programs with automatic reactivity.
- Fine-grained rerenders driven by Atom reads.
- Deterministic reconciliation/commit; predictable cleanup via Scope.
- No React parity; leverage Effect primitives directly.

---

### Adopt (from Effect-UI, adapted to Didact)

1) Service + Scope pattern
```ts
import { Effect, FiberSet, Ref, Option, Scope } from "effect";
import { Registry } from "@effect-atom/atom";
class DidactRuntime extends Effect.Service<DidactRuntime>()("DidactRuntime", {
  dependencies: [Registry.layer],
  scoped: Effect.gen(function* () {
    const registry = yield* Registry.AtomRegistry
    const scope = yield* Scope.make() // runtime-level scope
    const runFork = yield* FiberSet.makeRuntime<Registry.AtomRegistry>()

    const stateRef = yield* Ref.make({
      currentRoot: Option.none<Fiber>(),
      wipRoot: Option.none<Fiber>(),
      nextUnitOfWork: Option.none<Fiber>(),
      deletions: [] as Fiber[],
      renderQueue: [] as Fiber[], // deduped set maintained separately
      batchScheduled: false,
    })

    return { stateRef, registry, scope, runFork } as const
  }),
}) {}
```
- Provide `scope` for global lifecycle and per-component subscopes for cleanup.
- Keep `runFork` to auto-execute handler effects.

2) Normalize component output
```ts
function normalizeToStream(v: VElement | Effect.Effect<VElement> | Stream.Stream<VElement>): Stream.Stream<VElement> {
  if (Stream.isStream(v as any)) return v as Stream.Stream<VElement>
  if (Effect.isEffect(v as any)) return Stream.fromEffect(v as Effect.Effect<VElement>)
  return Stream.succeed(v as VElement)
}
```
- Ensures a single rendering path regardless of return type.

3) Direct DOM helpers
- Keep `updateDom/createDom` and extend cautiously for attr vs property, class/style merging, and streamed props later.

---

### Avoid (why)
- Comment markers: Not needed; we keep a persistent fiber tree and concrete DOM refs.
- Ephemeral components: We need persistent fibers to retain subscriptions and alternate links.
- No reconciliation: We must reconcile for keys/lists and efficient updates.

---

## Architecture

### 1) Per-component scope and read tracking
- Each component fiber owns a `componentScope: Scope.Scope` created on (re)render and closed on unmount or before re-subscribing.
- Capture which atoms a component reads by executing its Effect/Stream with a wrapped Registry that records `get()`/`stream()` calls.
  - Implement a lightweight proxy implementing the Registry interface; forward to the real registry, but collect atoms on `get`.
  - Provide the proxy via `Effect.provideService(Registry, proxy)` while running the component program or stream.
- Store the set of accessed atoms on the fiber for future diffing.

Why a wrapper? `Atom.get` is an Effect that depends on the Registry service. By providing a proxy during component execution, we can reliably detect reads without invasive changes or manual instrumentation.

### 2) Component execution
- `updateFunctionComponent(fiber)` flow:
  1. Reset fiber hooks state (as today) and create/replace `componentScope`.
  2. Call the component to get `VElement | Effect | Stream`.
  3. Normalize with `normalizeToStream`.
  4. Run the stream to its latest value for this render tick, under the Registry proxy, capturing accessed atoms. Example: `Stream.runLast` or `Stream.runScoped` to produce one `VElement` (initially support single value per render; incremental streaming can come later).
  5. Diff subscriptions: unsubscribe old (by closing old scope), create new subscriptions in the new `componentScope` (see next section).
  6. `reconcileChildren(fiber, [vElement])`.

- Host components: unchanged aside from potential streamed props support later.

### 3) Subscriptions and cleanup
- For each accessed atom `A` on the fiber:
  - Build a stream from the actual registry: `Registry.toStream(registry, A)` (or `Atom.toStream(A)` if you provide the registry context), then
  - Subscribe with: `Stream.runForEach(stream, () => queueFiberForRerender(fiber))` and `Effect.forkIn(componentScope)` to bind lifetime to the component.
- Use `Effect.forEach` with `{ discard: true, concurrency: "unbounded" }` to fork subscriptions efficiently without collecting results.
- On unmount, or before resubscribing, close the fiber's `componentScope` to cleanly interrupt all subscriptions.

Rationale: No manual unsubscribe bookkeeping is needed; the scope owns all fibers started for that component. Subscriptions can fork in parallel since they're independent effects.

### 4) Rerender queue and batching
- Maintain a deduped set of fibers to rerender and schedule batch processing exactly once per tick.
- Scheduling: Prefer using the registry’s `scheduleTask` if available; otherwise `queueMicrotask` is fine; consider `setTimeout(0)` if microtasks starve UI.
- `queueFiberForRerender(f)`:
  - Add to set if not present.
  - If not `batchScheduled`, flip it and schedule `processBatch()`.

- `processBatch()`:
  - Snapshot and clear the set (to allow coalescing new invalidations into the next batch).
  - For each fiber, prepare/update `wipRoot` appropriately and run `performUnitOfWork` sequentially.
  - Commit once after all work, then clear `batchScheduled`.

Important: Keep reconciliation/commit single-threaded. Avoid `concurrency: "unbounded"` here to protect fiber links and DOM mutations.

### 5) Reconciliation and commit
- Keep the current algorithm and invariants.
- Ensure `deleteFiber` closes `componentScope` before removing children to guarantee timely cleanup.

### 6) Event handlers
- Keep current auto-execution for Effect-returning handlers.
- Prefer providing the runtime’s actual registry instance (service) rather than a generic `Registry.layer`, so handlers run in the same environment as rendering.

### 7) DOM utilities (near-term polish)
- Property vs attribute detection (booleans, special cases like `value`, `checked`).
- Class and style merging that tolerates strings and object maps.
- Optional: basic streamed prop support by subscribing in `updateDom` and binding to the component scope (defer until core is stable).

---

## Pitfalls and guards
- Parallel reconciliation: Don’t. Keep mutation path single-threaded; parallelism is fine for background Effects owned by scopes.
- Mixed return types: Always normalize component outputs before use.
- Missed dependencies: Only reads inside the proxied registry are tracked. Ensure component body (Effect/Stream) runs under the proxy.
- Root churn: Rerender batching should dedupe fibers and commit once; avoid building multiple conflicting `wipRoot`s.

---

## Milestones
1) Output normalization + safe `updateFunctionComponent` path (single `VElement`).
2) Per-component `Scope` + unmount cleanup via `Scope.close`.
3) Registry proxy for read tracking; store accessed atoms per fiber.
4) Subscriptions via `Registry.toStream` forked in component scope.
5) Rerender queue with dedupe + single-threaded batch processing and commit.
6) Event handler environment uses runtime registry instance.
7) DOM utilities polish; optional streamed props.
8) Later: incremental streaming of children and keyed lists performance tweaks.

---

## Reference sketches

Per-component scope and subscriptions
```ts
function resubscribeFiber(fiber: Fiber, accessed: ReadonlySet<Atom.Atom<any>>) {
  if (fiber.componentScope) {
    // Interrupt existing subscriptions
    Scope.close(fiber.componentScope, Exit.void)
  }
  fiber.componentScope = yield* Scope.make()

  yield* Effect.forEach(accessed, (atom) =>
    Effect.forkIn(
      Stream.runForEach(Registry.toStream(registry, atom), () => queueFiberForRerender(fiber)),
      fiber.componentScope
    ), { discard: true })
}
```

Rerender batching (sequential work)
```ts
const queueFiberForRerender = Effect.fn("queueFiberForRerender")((fiber: Fiber) =>
  Effect.gen(function* () {
    const { stateRef } = yield* DidactRuntime
    yield* Ref.update(stateRef, (s) => {
      // maintain a Set in closure or on state
      addToPendingSet(fiber)
      if (!s.batchScheduled) s.batchScheduled = true
      return s
    })
    if (!(yield* isBatchScheduled())) schedule(processBatch)
  })
)

const processBatch = Effect.fn("processBatch")(() =>
  Effect.gen(function* () {
    const batch = drainPendingSet() // unique fibers snapshot

    for (const fiber of batch) {
      yield* performUnitOfWork(fiber)
    }

    yield* commitRoot()
    markBatchComplete()
  })
)
```

# 💡 Suggestions

  1. Use Effect.forEach with { discard: true }
Effect's iteration APIs are more efficient:
``` ts
// ✅ Better
yield* Effect.forEach(
  accessedAtoms,
  (atom) => {
    const subscription = Stream.runForEach(/*...*/);
    return Effect.forkIn(subscription, componentScope);
  },
  {
    concurrency: "unbounded", // Subscriptions can be parallel
    discard: true             // Don't collect results
  }
);
```

``` ts
// ❌ Less efficient
for (const atom of accessedAtoms) {
  const subscription = Stream.runForEach(/*...*/);
  yield* Effect.forkIn(subscription, componentScope);
}
```
