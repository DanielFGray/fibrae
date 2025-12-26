# Suspense Quick Reference Card

## The Exception-Based Model

```
Component throws Promise
        ↓
throwException() caught
        ↓
Mark boundary: ShouldCapture
        ↓
Unwind to boundary
        ↓
Convert: ShouldCapture → DidCapture
        ↓
Boundary re-renders with fallback
        ↓
Attach .then() listener to Promise
        ↓
Promise resolves → ping listener fires
        ↓
markRootPinged() schedules new render
        ↓
Boundary re-renders with content
```

---

## Flag Reference

| Flag            | Phase              | Meaning                                        |
| --------------- | ------------------ | ---------------------------------------------- |
| `Incomplete`    | Render             | This fiber chain is broken (child suspended)   |
| `ShouldCapture` | Suspend            | Found suspension; will capture on unwind       |
| `DidCapture`    | Unwind → BeginWork | Successfully captured; re-render with fallback |

**Progression**: (no flag) → `Incomplete` & `ShouldCapture` → `DidCapture` → (clear) → (no flag)

---

## State Reference

| State                              | Meaning                                |
| ---------------------------------- | -------------------------------------- |
| `memoizedState = null`             | Not suspended, showing primary content |
| `memoizedState = SUSPENDED_MARKER` | Suspended, showing fallback            |

---

## Critical Functions

### Detection Phase

```typescript
throwException(root, returnFiber, sourceFiber, value, lanes)
  ├─ Check: value.then (is it a Wakeable?)
  ├─ Set: sourceFiber.flags |= Incomplete
  ├─ Find: suspenseBoundary = getSuspenseHandler()
  ├─ Mark: suspenseBoundary.flags |= ShouldCapture
  └─ Attach: attachPingListener(root, value, lanes)
```

### Unwind Phase

```typescript
unwindWork(current, workInProgress, renderLanes)
  ├─ Check: flags & ShouldCapture
  ├─ Convert: flags = (flags & ~ShouldCapture) | DidCapture
  └─ Return: workInProgress (to re-enter beginWork)
```

### Boundary Re-render

```typescript
updateSuspenseComponent(current, workInProgress, lanes)
  ├─ Check: didSuspend = (flags & DidCapture)
  ├─ If true: showFallback = true
  ├─ Set: memoizedState = SUSPENDED_MARKER
  └─ Render: fallback children in Offscreen
```

### Retry Phase

```typescript
attachPingListener(root, wakeable, lanes)
  └─ wakeable.then(ping, ping)
    └─ pingSuspendedRoot(root, wakeable, lanes)
      ├─ markRootPinged(root, lanes)
      └─ scheduleRender() // Work loop restarts
```

---

## Handler Stack Pattern

```typescript
// During render of Suspense boundary:
pushSuspenseHandler(suspenseBoundary);
// Render children
// If throw, getSuspenseHandler() returns this boundary
popSuspenseHandler();
```

---

## Wakeable Detection

```typescript
function isWakeable(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof value.then === "function"
  );
}
```

---

## Offscreen Component Pattern

When boundary is suspended:

```
<Suspense>
  <Offscreen mode="hidden">  ← memoizedState = OffscreenState
    {primary children}
  </Offscreen>
  <FallbackContent />        ← Shown in DOM
</Suspense>
```

When boundary resolves:

```
<Suspense>
  <Offscreen mode="visible">  ← memoizedState = OffscreenState
    {primary children}         ← Now shown
  </Offscreen>
</Suspense>
```

---

## updateQueue (Retry Queue)

```typescript
// Type
type RetryQueue = Set<Wakeable>;

// Created when suspension detected
suspenseBoundary.updateQueue = new Set([wakeable]);

// In commit phase: attach listeners
for (let wakeable of boundary.updateQueue) {
  wakeable.then(scheduleRetry, scheduleRetry);
}
```

---

## Nested Boundaries

```
<Suspense A (outer)>
  <Suspense B (inner)>
    <Component throws>
  </Suspense>
</Suspense>

Throw detected:
  Handler stack: [A, B]
  getSuspenseHandler() → B (nearest)

  Mark B: ShouldCapture
  Unwind to B: convert to DidCapture
  B re-renders with fallback

  If B still shows fallback at commit time:
    Unwind continues
    A also captures (may show its fallback)
```

---

## Error vs Suspense

```typescript
// Error: throw Error()
catch (error) {
  if (error instanceof Error) {
    // Error boundary handles
  }
}

// Suspense: throw Promise
catch (value) {
  if (value && typeof value.then === 'function') {
    // Suspense boundary handles
  } else {
    // Error boundary handles
  }
}
```

---

## Ping Flow

```
Wakeable thrown and stored in boundary.updateQueue
    ↓
attachPingListener(root, wakeable, lanes) adds .then() listener
    ↓
Wakeable resolves
    ↓
Both branches of .then() call ping callback
    ↓
ping = pingSuspendedRoot.bind(null, root, wakeable, lanes)
    ↓
pingSuspendedRoot():
  1. pingCache.delete(wakeable)
  2. markRootPinged(root, lanes)
  3. scheduleCallback(...) schedule render
    ↓
Work loop restarts
    ↓
Boundary re-renders
    ↓
If content available: success
If still throwing: repeat flow
```

---

## Common State Checks

```typescript
// Is boundary suspended?
const isSuspended = boundary.memoizedState === SUSPENDED_MARKER;

// Did we just catch a suspension?
const didCapture = (boundary.flags & DidCapture) !== NoFlags;

// Does this need retry?
const hasRetries = boundary.updateQueue && boundary.updateQueue.size > 0;

// Should show fallback?
const showFallback = isSuspended || didCapture;
```

---

## Testing Checklist

- [ ] Detect thrown Promise
- [ ] Find Suspense boundary
- [ ] Show fallback UI
- [ ] Attach listener to Promise
- [ ] Call listener when Promise resolves
- [ ] Schedule new render
- [ ] Show content on retry
- [ ] Handle nested boundaries
- [ ] Clear fallback when content ready
- [ ] Don't infinite loop if component re-throws
