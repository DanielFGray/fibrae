# Suspense Implementation Guide for Effect-Based Renderer

Based on React fiber architecture research, this guide outlines the essential mechanisms needed to implement Suspense in an Effect-based renderer.

## Core Concept: Exception-Based Async Signaling

React's Suspense doesn't query component state—it **catches exceptions**. Components signal they're not ready by **throwing a Wakeable** (any object with a `.then()` method, typically a Promise).

```typescript
// Component that suspends
export function UserProfile() {
  // Throws a Promise during render
  const user = use(fetchUser(userId));
  return <div>{user.name}</div>;
}

// React catches this throw and:
// 1. Finds nearest Suspense boundary
// 2. Marks it with ShouldCapture flag
// 3. Attaches listener to Promise
// 4. Re-renders boundary with fallback
// 5. When Promise resolves, retries render
```

---

## Five-Phase Suspense Flow

### Phase 1: Suspension Detection (During Render)

**Trigger**: Component throws Promise/Wakeable during `beginWork()`

**Actions**:

- Mark suspended fiber with `Incomplete` flag
- Find nearest Suspense boundary via context stack (like error boundaries)
- Mark boundary with `ShouldCapture` flag
- Store Promise in boundary's `updateQueue` (retry queue)
- Attach `.then()` listener to Promise

**Code Location**: `throwException()` → `markSuspenseBoundaryShouldCapture()`

**For Effect-based renderer**:

- Use try-catch during fiber rendering
- Detect Wakeables: `value !== null && typeof value.then === 'function'`
- Maintain Suspense handler stack (context-like)
- Store Wakeables in boundary fiber's `updateQueue`

### Phase 2: Incomplete Fiber Detection (Complete Phase)

**Trigger**: Walk up from suspended fiber during `completeUnitOfWork()`

**Actions**:

- Detect `Incomplete` flag on current fiber
- Exit normal complete phase
- Switch to unwind phase (like exception bubbling)

**For Effect-based renderer**:

- After attempting to complete a fiber, check: `(fiber.flags & Incomplete)`
- If true, jump to unwind instead of completing siblings

### Phase 3: Unwind to Boundary (Unwind Phase)

**Trigger**: Walking up tree from incomplete fiber

**Actions**:

- Pop contexts at each level (maintains stack consistency)
- When reaching a fiber with `ShouldCapture` flag:
  - Convert flag: `ShouldCapture` → `DidCapture`
  - Return this fiber to work loop
- Work loop re-enters `beginWork()` at the boundary

**For Effect-based renderer**:

- Walk up via `fiber.return` pointers
- Check each fiber: `(fiber.flags & ShouldCapture)`
- On match: convert flag and return fiber
- Continue unwinding if no match (unhandled suspension)

### Phase 4: Boundary Re-renders with Fallback (Re-enter BeginWork)

**Trigger**: Work loop calls `beginWork()` on boundary with `DidCapture` flag

**Actions**:

1. Check `DidCapture` flag: `const didSuspend = (flags & DidCapture) !== NoFlags`
2. Set `showFallback = true`
3. Clear `DidCapture` flag
4. Set `memoizedState = SUSPENDED_MARKER` to track suspended state
5. Render fallback children instead of primary
6. Wrap primary children in `Offscreen` component (hidden)

**For Effect-based renderer**:

- In boundary's render function, check `DidCapture` flag
- If set, render `.fallback` prop instead of `.children`
- Store suspended state in `memoizedState` for retry

### Phase 5: Retry on Promise Resolution (Async Listener)

**Trigger**: Promise/Wakeable resolves

**Actions**:

1. Promise `.then()` listener fires (attached in Phase 1)
2. `pingSuspendedRoot()` called:
   - Remove Wakeable from ping cache
   - Call `markRootPinged(root, lanes)` to schedule work
   - Work loop restarts from root
3. Root renders again, suspense boundary re-renders
4. If data now available, primary children render successfully
5. If still suspended, repeat from Phase 1

**For Effect-based renderer**:

- In Phase 1, call: `wakeable.then(ping, ping)`
- Ping function schedules new render cycle
- Boundary re-renders; check if data loaded
- Clear `memoizedState` when primary succeeds

---

## Key Data Structures

### Fiber Fields for Suspense

```typescript
interface Fiber {
  // Flags (bitmask)
  flags: number;
  // Key flags for Suspense:
  // - Incomplete: Component threw; fiber chain broken
  // - ShouldCapture: Detected suspension; needs capture on unwind
  // - DidCapture: Captured suspension; re-rendering with fallback

  // State
  memoizedState: any;
  // For Suspense boundary:
  // - null: Not suspended, showing primary
  // - SUSPENDED_MARKER: Suspended, showing fallback

  // Retry queue
  updateQueue: Set<Wakeable> | null;
  // Set of Promises to listen for retry

  // Tree navigation
  return: Fiber | null; // Parent (for unwind)
  child: Fiber | null; // First child
  sibling: Fiber | null; // Next sibling
}
```

### Suspension Context Stack

React uses a context stack (like error boundaries) to find the nearest Suspense boundary:

```typescript
// Maintain during render:
let suspenseStack: Fiber[] = [];

function pushSuspenseHandler(fiber: Fiber) {
  suspenseStack.push(fiber);
}

function popSuspenseHandler() {
  suspenseStack.pop();
}

function getSuspenseHandler(): Fiber | null {
  return suspenseStack.length > 0
    ? suspenseStack[suspenseStack.length - 1]
    : null;
}
```

When a component throws:

```typescript
const suspenseBoundary = getSuspenseHandler();
// This is the nearest Suspense component to handle it
```

---

## Implementation Checklist

### Core Suspense Mechanism

- [ ] Try-catch during fiber render phase to detect thrown Wakeables
- [ ] Suspense handler context stack (push on enter, pop on exit)
- [ ] Mark suspended fiber with `Incomplete` flag
- [ ] Mark boundary with `ShouldCapture` flag
- [ ] Store Wakeable in boundary's `updateQueue`
- [ ] Attach `.then()` listener to Wakeable

### Unwind & Capture

- [ ] Detect `Incomplete` flag during complete phase
- [ ] Switch to unwind phase instead of complete
- [ ] Pop contexts while unwinding
- [ ] Find fiber with `ShouldCapture` flag
- [ ] Convert flag to `DidCapture`
- [ ] Return boundary to re-enter begin phase

### Boundary Re-render

- [ ] In boundary's `updateSuspenseComponent()`:
  - Check `DidCapture` flag
  - Set `showFallback` based on flag
  - Store state in `memoizedState`
  - Render `.fallback` if suspended, `.children` if not
- [ ] Hide primary children in `Offscreen` component when suspended

### Retry Logic

- [ ] Implement ping callback that schedules new render
- [ ] Clear boundary's `memoizedState` when primary renders successfully
- [ ] Handle nested boundaries (inner boundary caught first)
- [ ] Throttle fallback appearance (optional, for UX)

---

## Simple Example: Minimal Suspense

```typescript
// Minimal Suspense component
function Suspense({ children, fallback }) {
  const [suspended, setSuspended] = useState(false);
  const [error, setError] = useState(null);

  // This would be handled by the fiber/render system
  // but shown here for conceptual clarity:

  return suspended ? fallback : children;
}

// User component that suspends
function UserData({ userId }) {
  // Effect throws a promise, signals "not ready"
  const user = use(fetchUser(userId));
  return <div>{user.name}</div>;
}

// Usage
function App() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <UserData userId="123" />
    </Suspense>
  );
}

// Flow:
// 1. Start rendering <UserData>
// 2. Calls use(fetchUser("123")) which throws Promise
// 3. catch handler finds Suspense boundary
// 4. Marks boundary with ShouldCapture
// 5. Unwind to boundary, set DidCapture
// 6. Re-render Suspense → showFallback = true
// 7. Render <div>Loading...</div>
// 8. When promise resolves:
//    - ping listener fires
//    - Suspense re-renders
//    - Now <UserData> succeeds, shows <div>Alice</div>
```

---

## Differences from Error Boundaries

| Aspect        | Error Boundary              | Suspense                        |
| ------------- | --------------------------- | ------------------------------- |
| **Signal**    | `throw new Error()`         | `throw Promise`                 |
| **Detection** | Any thrown error            | Promise-like objects (`.then`)  |
| **Fallback**  | Error component (single)    | Fallback element (two branches) |
| **Recovery**  | Requires component re-mount | Automatic retry on promise      |
| **State**     | `hasError` boolean          | `memoizedState` (null/MARKER)   |
| **Re-render** | Once, after caught          | Multiple times until resolved   |

---

## Testing Suspense

```typescript
// Test utilities
function createWakeable(): Promise<void> {
  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  promise.resolve = resolve;
  promise.reject = reject;
  return promise;
}

// Test case
test('shows fallback, then content', () => {
  const wakeable = createWakeable();

  const { container } = render(
    <Suspense fallback={<div>Loading</div>}>
      <Component wakeable={wakeable} />
    </Suspense>
  );

  // Fallback shown
  expect(container.textContent).toBe('Loading');

  // Resolve promise
  wakeable.resolve();

  // Content shown
  expect(container.textContent).toBe('Ready');
});
```

---

## Common Pitfalls

1. **Not checking if value has `.then()`**: Only Promises/Wakeables should trigger suspense, not all errors
2. **Not maintaining handler stack**: Push/pop context during render, or boundary detection fails
3. **Forgetting to pop context during unwind**: Can cause incorrect boundary matching in nested trees
4. **Not storing Wakeable in updateQueue**: Retry listeners won't be attached in commit phase
5. **Clearing fallback too early**: If primary still suspended, don't clear fallback until retry succeeds
6. **Infinite loops**: Be careful with retry logic to avoid immediate re-suspension

---

## Next Steps for Fibrae

1. Add exception handling to fiber render phase
2. Implement Suspense boundary detection (push/pop handler stack)
3. Add flag management (Incomplete, ShouldCapture, DidCapture)
4. Implement unwind phase in work loop
5. Add Wakeable detection and ping listener attachment
6. Test with simple suspended component
7. Add error boundary integration (errors vs suspense)
8. Handle nested boundaries
9. Add fallback throttling heuristics
10. Integrate with Effect streams (if components use Effects for async)
