# React Suspense Execution Flow Diagram

## High-Level Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    RENDER PHASE BEGINS                      │
│                  Work loop calls beginWork()                │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
         ┌───────────────────────────────────────┐
         │   Component Function Executes         │
         │   (e.g., <Suspense> or child)        │
         └────────────┬────────────────────────┘
                      │
         ┌────────────▼──────────────┐
         │  Component throws         │
         │  (or child throws)        │
         │  Wakeable object          │
         └────────────┬──────────────┘
                      │
                      ▼
      ┌──────────────────────────────────┐
      │  throwException() called         │
      │  in catch handler                │
      ├──────────────────────────────────┤
      │ 1. Set sourceFiber.flags        │
      │    |= Incomplete                │
      │ 2. Find nearest Suspense boundary│
      │    via getSuspenseHandler()     │
      │ 3. Mark boundary with          │
      │    ShouldCapture flag          │
      │ 4. Attach ping listener to      │
      │    Wakeable                     │
      └────────────┬─────────────────────┘
                   │
                   ▼
  ┌────────────────────────────────────────┐
  │   COMPLETE PHASE                       │
  │   Try to walk up tree normally         │
  └────────┬─────────────────────────────┘
           │
           ▼
    ┌──────────────────────────┐
    │ Detect Incomplete flag   │
    │ on child                 │
    │ (flags & Incomplete)     │
    └───────┬──────────────────┘
            │
            ▼
  ┌──────────────────────────────────────────┐
  │  UNWIND PHASE                            │
  │  Walk UP fiber tree via .return          │
  ├──────────────────────────────────────────┤
  │ 1. Pop contexts at each level            │
  │ 2. When Suspense boundary found:         │
  │    - Check (flags & ShouldCapture)       │
  │    - Convert to DidCapture               │
  │    - Return boundary fiber               │
  └───────┬──────────────────────────────────┘
          │
          ▼
  ┌──────────────────────────────────────────┐
  │  RE-ENTER BEGIN PHASE AT BOUNDARY        │
  │  Call updateSuspenseComponent()          │
  ├──────────────────────────────────────────┤
  │ 1. Check DidCapture flag                 │
  │ 2. Set showFallback = true               │
  │ 3. Set memoizedState = SUSPENDED_MARKER  │
  │ 4. Render fallback children instead      │
  │    of primary children                   │
  └───────┬──────────────────────────────────┘
          │
          ▼
  ┌──────────────────────────────────────────┐
  │  COMMIT PHASE                            │
  │  Fallback commits to DOM                 │
  └──────────────────────────────────────────┘

═════════════════════════════════════════════════════════

  ┌──────────────────────────────────────────┐
  │ MEANWHILE: PING LISTENER                 │
  │ (runs in parallel/async)                 │
  ├──────────────────────────────────────────┤
  │ When Wakeable resolves:                  │
  │ 1. wakeable.then(ping, ping) fires      │
  │ 2. pingSuspendedRoot() called           │
  │ 3. Clear from pingCache                 │
  │ 4. markRootPinged(root, lane)           │
  │ 5. Schedule new render at root          │
  │ 6. Work loop restarts                   │
  └──────────────────────────────────────────┘

  ┌──────────────────────────────────────────┐
  │  RETRY RENDER                            │
  │  Boundary re-renders with DidCapture     │
  │  still set, but now content might not    │
  │  throw (data loaded)                     │
  │                                          │
  │  1. Primary children render successfully │
  │  2. Set memoizedState = null             │
  │  3. Fallback hidden, content shown       │
  └──────────────────────────────────────────┘
```

---

## Flag & State Progression

```
Timeline for Suspense Boundary Fiber:

BEGIN (initial render):
  flags: NoFlags
  memoizedState: null

CHILD THROWS:
  flags: ShouldCapture (set by throwException)
  memoizedState: null (unchanged yet)

UNWIND PHASE:
  flags: DidCapture (converted in unwindWork)
  memoizedState: null (still unchanged)

RE-ENTER BEGIN:
  flags: DidCapture → clear it
  memoizedState: SUSPENDED_MARKER (set in updateSuspenseComponent)

RENDER FALLBACK:
  Child: Offscreen { memoizedState: OffscreenState (hidden) }
         ↓
         Fallback JSX

COMMIT:
  DOM shows fallback

ON RETRY (after ping):
  flags: ShouldCapture again (if still suspended)
  OR
  flags: NoFlags (if resolved)
  memoizedState: null (if resolved)

  Child: Offscreen { memoizedState: OffscreenState (visible) }
         ↓
         Primary JSX
```

---

## Key Data Flow

```
┌─────────────────────────────────────────────────────────┐
│ Wakeable (thrown by component)                          │
├─────────────────────────────────────────────────────────┤
│ Must have: .then(onResolve, onReject) method            │
│ Signals: component not ready, retry when resolved       │
└─────────────┬───────────────────────────────────────────┘
              │
              ├──→ throwException() → attached to RetryQueue
              │
              ├──→ attachPingListener() → creates ping listener
              │    listener calls pingSuspendedRoot()
              │
              ▼
    Wakeable resolves
              │
              ├──→ ping listener fires
              │
              ├──→ pingSuspendedRoot()
              │    markRootPinged(root, lanes)
              │
              ▼
    New render scheduled
              │
              ├──→ Work loop restarts
              │
              ├──→ Suspense boundary re-renders
              │
              ▼
    Content renders (if data loaded)
```

---

## Nested Boundaries Example

```
<Root>
  <Suspense fallback={<OuterFallback/>}>  ← Outer boundary
    <Suspense fallback={<InnerFallback/>}>  ← Inner boundary
      <DataComponent />  ← Throws Wakeable
    </Suspense>
  </Suspense>
</Root>

When DataComponent throws:

1. throwException() finds getSuspenseHandler()
   → Returns INNER boundary (nearest in context stack)

2. Mark INNER boundary with ShouldCapture

3. Unwind phase: walk up
   → INNER boundary caught, convert ShouldCapture → DidCapture
   → Return INNER to re-render

4. Re-render INNER with fallback
   → Show <InnerFallback/>

5. On retry: if data loaded, show <DataComponent/>
   Otherwise, unwind continues to OUTER boundary

6. If INNER still suspended and commit would show fallback,
   then OUTER also captures it (if needed)
```
