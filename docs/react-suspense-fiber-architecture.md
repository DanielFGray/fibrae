# React Suspense in Fiber Architecture - Research Summary

## 1. How React Detects Suspended Components

### Signal Mechanism: Thrown Promises (Wakeables)

- **Detection Method**: A component signals suspension by **throwing a Promise-like object** (called a "Wakeable" - an object with a `.then()` method)
- **Code Path**: When a component throws during render, it propagates up and is caught in `throwException()` (ReactFiberThrow.js)
- **Type Check** (line 382):
  ```javascript
  if (value !== null && typeof value === 'object') {
    if (typeof value.then === 'function') {
      // This is a wakeable. The component suspended.
      const wakeable: Wakeable = (value: any);
    }
  }
  ```

### Key Insight

- **Not just Promises**: Any object with `.then()` works (React calls these "Wakeables")
- **Async Detection**: The thrown value indicates the component isn't ready - React attaches listeners and will retry when it resolves
- **Implicit Dependency**: The component itself throws; React doesn't query or check state - it relies on exceptions

---

## 2. How React Races Suspense Against Threshold (Fallback vs Content)

### The DidCapture Flag Flow

**Phase 1: Detection** → Sets `ShouldCapture`

- When a child throws a Wakeable, React marks the nearest Suspense boundary fiber with `ShouldCapture` flag (line 357 in ReactFiberThrow.js)
- This signals "something suspended in my subtree"

**Phase 2: Unwind** → Converts to `DidCapture`

- During the unwind phase (ReactFiberUnwindWork.js, line 171-172):
  ```javascript
  if (flags & ShouldCapture) {
    workInProgress.flags = (flags & ~ShouldCapture) | DidCapture;
    return workInProgress; // Re-enter begin phase
  }
  ```
- This conversion happens in `unwindWork()` when the boundary is encountered during stack unwinding
- The boundary is then **re-rendered** with `DidCapture` flag set

**Phase 3: Decide Content vs Fallback** → `updateSuspenseComponent()`

- In BeginWork (line 2356):
  ```javascript
  const didSuspend = (workInProgress.flags & DidCapture) !== NoFlags;
  if (
    didSuspend ||
    shouldRemainOnFallback(current, workInProgress, renderLanes)
  ) {
    showFallback = true;
    workInProgress.flags &= ~DidCapture;
  }
  ```
- `DidCapture` flag + `memoizedState` checks determine: show primary (content) or fallback
- Sets boundary's `memoizedState = SUSPENDED_MARKER` when showing fallback

### The Heuristics (Throttling)

- **Shell Boundary Check** (line 414): If suspended at root level, delay commit
- **Fallback Throttle** (line 816): Only restart if 500ms passed since last fallback appeared
- **New Boundary Check** (line 431-434): Call `renderDidSuspend()` only for newly mounted boundaries

**Race Result**:

- If promise resolves **during render**: Ping listener fires, content may render
- If promise still pending **at render completion**: Fallback commits to DOM, re-render scheduled for retry

---

## 3. How the Fiber Work Loop Handles Suspended Components

### Normal Flow → Incomplete → Unwind

1. **Component throws Wakeable**
   - `throwException()` is called during render
   - Sets `sourceFiber.flags |= Incomplete` (line 372)
   - Marks Suspense boundary with `ShouldCapture`

2. **Complete Phase Detects Incomplete** (line 3278 in ReactFiberWorkLoop.js):

   ```javascript
   if ((completedWork.flags & Incomplete) !== NoFlags) {
     unwindUnitOfWork(completedWork, skipSiblings);
     return; // Exit complete, enter unwind
   }
   ```

3. **Unwind Phase** (lines 3338-3409):
   - Walks up fiber tree via `.return` pointers
   - Calls `unwindWork()` at each level to pop context
   - When `ShouldCapture` is found, converts to `DidCapture` and **returns the boundary fiber**
   - Work loop then re-enters **begin phase** at the boundary
   - Boundary's `updateSuspenseComponent()` re-renders with fallback children

4. **Siblings are Skipped** (line 3395):

   ```javascript
   if (!skipSiblings) {
     const siblingFiber = incompleteWork.sibling;
     if (siblingFiber !== null) {
       workInProgress = siblingFiber;
       return; // Continue with next sibling
     }
   }
   ```

   - By default, other suspended siblings still render (for progressive loading)
   - Can be skipped based on `skipSiblings` flag

### Key: Re-queueing via Retry

- **Ping Listener** (lines 4731-4775): `attachPingListener()` waits for Wakeable to resolve
- When resolved, calls `pingSuspendedRoot()` which:
  - Removes wakeable from cache
  - Calls `markRootPinged()` to schedule a new render
  - Restarts the work loop at this boundary

---

## 4. Key Fiber Data Structures for Suspense

### Fiber Fields

| Field             | Purpose                                                                                                       | Set By                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `flags` (Bitmask) | **DidCapture** = currently showing fallback; **ShouldCapture** = suspension detected, needs capture           | throwException(), unwindWork() |
| `memoizedState`   | For Suspense: `null` = unsuspended, non-null = suspended state (SUSPENDED_MARKER for primary children hidden) | updateSuspenseComponent()      |
| `updateQueue`     | For Suspense: **RetryQueue** = Set<Wakeable> of promises to retry when resolved                               | throwException() (line 473)    |
| `lanes`           | Priority level for work; merged when suspension occurs                                                        | throwException()               |
| `child`           | Points to fallback or primary Offscreen wrapper depending on showFallback                                     | updateSuspenseComponent()      |

### SuspenseState Type (ReactFiberSuspenseComponent.js, lines 31-43):

```typescript
type SuspenseState = {
  dehydrated: null | SuspenseInstance; // For SSR; null means showing fallback
  treeContext: null | TreeContext; // Tree position info
  retryLane: Lane; // Priority for hydration retry
  hydrationErrors: Array<CapturedValue<mixed>> | null;
};
```

### RetryQueue (line 61):

```typescript
type RetryQueue = Set<Wakeable>;
```

- Wakeables that suspended; attached to Suspense boundary
- Used in commit phase to attach `.then()` listeners for retry

### FiberRoot.pingCache (line 4751):

```javascript
pingCache: new PossiblyWeakMap(); // Maps Wakeable → Set<Lanes>
```

- Memoizes ping listeners per lane (prevents duplicate listeners)
- Cleared when Wakeable resolves

---

## Key Insights for Implementation

### 1. Exception is the Signal

- Components throw, they don't emit events or return status
- React's try-catch-like model uses exceptions naturally

### 2. Boundary Re-renders Twice

- **First pass**: Try to render content (primary children)
- **If suspended**: Unwind to boundary, set DidCapture flag, re-render with fallback

### 3. Async Coordination

- **Ping listeners** are the retry mechanism - when Wakeable resolves, root is "pinged" to re-render
- **Throttling** prevents cascading fallbacks (500ms rule for successive fallbacks)

### 4. Flag Progression

```
ShouldCapture (detected)
    ↓
DidCapture (during unwind conversion)
    ↓
Clear flag (when Suspense boundary renders fallback)
    ↓
Re-render on ping (with boundary in normal/suspended state)
```

### 5. State Tracking

- Boundary's `memoizedState` = `SUSPENDED_MARKER` when showing fallback
- Offscreen wrapper's `memoizedState` = OffscreenState (tracks if primary is hidden)
- `updateQueue` = retry queue (Set of Wakeables to listen for)

### 6. Critical Context: getSuspenseHandler()

- Stack-based context tracks the current Suspense boundary during render
- When exception thrown, finds **nearest handler** via `getSuspenseHandler()`
- Allows nested boundaries to each handle their own suspensions
