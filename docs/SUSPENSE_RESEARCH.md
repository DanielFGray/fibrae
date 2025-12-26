# Suspense Research Documentation Index

This directory contains comprehensive research and implementation guides for React's Suspense mechanism in the fiber architecture. All documentation is derived from analyzing React's source code.

## Files Overview

### 1. **react-suspense-fiber-architecture.md** (Main Research)

The foundational research document with answers to the four core questions:

- **How React detects suspended components** - Thrown Promises (Wakeables) mechanism
- **How React races suspense against threshold** - DidCapture flag progression and fallback decision
- **How the work loop handles suspended components** - Incomplete flag detection and unwind phase
- **Key data structures** - Fiber fields, SuspenseState type, RetryQueue, pingCache

**Best for**: Understanding the core mechanisms and architecture

### 2. **suspense-flow-diagram.md** (Visual Flows)

ASCII diagrams showing execution flow from multiple angles:

- High-level suspension → commit → retry flow
- Flag and state progression timeline
- Wakeable data flow through the system
- Nested boundary example

**Best for**: Visual learners, understanding phase transitions

### 3. **suspense-implementation-guide.md** (Practical Implementation)

Detailed guide for implementing Suspense in an Effect-based renderer:

- Five-phase suspension flow with specific actions
- Code requirements for each phase
- Fiber field descriptions
- Implementation checklist (30 items)
- Common pitfalls and testing strategies

**Best for**: Building Suspense support, concrete implementation steps

### 4. **suspense-quick-reference.md** (Cheat Sheet)

Quick lookup reference for common patterns:

- Exception-based model flowchart
- Flag and state reference tables
- Critical function signatures
- Handler stack pattern
- Common state checks

**Best for**: Quick lookups during implementation, debugging

## Key Concepts Summary

### The Core Mechanism

**Exception-Based Async Signaling**

React uses exceptions to signal suspension. When a component isn't ready:

1. **Component throws** - Any object with `.then()` method (Wakeable)
2. **Exception caught** - `throwException()` handler detects Wakeable
3. **Boundary marked** - Nearest Suspense boundary gets `ShouldCapture` flag
4. **Stack unwound** - `unwindWork()` converts flag to `DidCapture`
5. **Fallback rendered** - Boundary re-renders showing fallback instead of content
6. **Listener attached** - `.then()` listener waits for Promise resolution
7. **Retry scheduled** - When Promise resolves, "ping" listener fires
8. **Content rendered** - Boundary re-renders, content shown if available

### Five Phases

| Phase          | Trigger            | Key Action                         | Location                    |
| -------------- | ------------------ | ---------------------------------- | --------------------------- |
| **Detection**  | Component throws   | Mark boundary with `ShouldCapture` | `throwException()`          |
| **Incomplete** | Complete phase     | Detect `Incomplete` flag           | `completeUnitOfWork()`      |
| **Unwind**     | Walking up tree    | Convert flag to `DidCapture`       | `unwindWork()`              |
| **Fallback**   | Re-enter BeginWork | Render fallback children           | `updateSuspenseComponent()` |
| **Retry**      | Promise resolves   | Schedule new render                | `pingSuspendedRoot()`       |

### Critical Components

**Fiber Flags** (bitmasks)

- `Incomplete` - Fiber chain broken by suspension
- `ShouldCapture` - Suspension detected, needs unwinding
- `DidCapture` - Suspension caught, re-render with fallback

**Fiber State**

- `memoizedState` - `null` (showing content) or `SUSPENDED_MARKER` (showing fallback)
- `updateQueue` - `Set<Wakeable>` (promises to listen for)

**Stack Context**

- Handler stack - Like error boundaries, tracks nearest Suspense boundary
- `getSuspenseHandler()` - Returns nearest boundary during render

## Implementation Path

For fibrae, follow this order:

1. **Phase 1: Detection** (2-3 steps)
   - Add try-catch to fiber rendering
   - Detect Wakeables
   - Mark boundaries with `ShouldCapture`

2. **Phase 2: Unwind** (2-3 steps)
   - Detect `Incomplete` flag
   - Implement unwind phase
   - Convert `ShouldCapture` → `DidCapture`

3. **Phase 3: Fallback Rendering** (2-3 steps)
   - Check `DidCapture` in boundary
   - Render fallback children
   - Set `memoizedState`

4. **Phase 4: Retry** (2-3 steps)
   - Attach `.then()` listeners
   - Implement ping callback
   - Schedule new renders

5. **Phase 5: Integration** (2-3 steps)
   - Handle nested boundaries
   - Add error vs suspense differentiation
   - Test end-to-end

## Quick Reference

### Detect Wakeable

```typescript
value !== null && typeof value === "object" && typeof value.then === "function";
```

### Handler Stack Pattern

```typescript
pushSuspenseHandler(fiber);
try {
  // render children
} finally {
  popSuspenseHandler();
}
```

### Flag Checks

```typescript
// Suspended?
const suspended = fiber.memoizedState === SUSPENDED_MARKER;

// Just caught?
const captured = (fiber.flags & DidCapture) !== NoFlags;

// Needs retry?
const needsRetry = (fiber.flags & ShouldCapture) !== NoFlags;
```

### Unwind Check

```typescript
// In complete phase:
if ((fiber.flags & Incomplete) !== NoFlags) {
  unwindUnitOfWork(fiber);
  return;
}

// In unwind phase:
if ((fiber.flags & ShouldCapture) !== NoFlags) {
  fiber.flags = (fiber.flags & ~ShouldCapture) | DidCapture;
  return fiber; // Re-enter beginWork
}
```

## Common Mistakes to Avoid

1. **Not checking `.then()`** - Treat all errors like suspensions
2. **Not maintaining handler stack** - Boundary detection fails
3. **Forgetting to pop context** - Wrong boundary handles suspension
4. **Not storing Wakeable** - Retry listener never attached
5. **Clearing fallback early** - Primary still suspended
6. **Infinite retry loops** - Component re-throws immediately

## React Source References

All findings based on React source code at:

- `packages/react/packages/react-reconciler/src/ReactFiberBeginWork.js` (line 2341)
- `packages/react/packages/react-reconciler/src/ReactFiberThrow.js` (line 364)
- `packages/react/packages/react-reconciler/src/ReactFiberUnwindWork.js` (line 66)
- `packages/react/packages/react-reconciler/src/ReactFiberWorkLoop.js` (line 4731)
- `packages/react/packages/react-reconciler/src/ReactFiberSuspenseComponent.js` (line 31)

## Study Order

**For understanding:**

1. Read `react-suspense-fiber-architecture.md` (sections 1-4)
2. Review `suspense-flow-diagram.md` (visual confirmation)
3. Skim `suspense-quick-reference.md` (flag/state tables)

**For implementing:**

1. Read `suspense-implementation-guide.md` (five phases)
2. Use `suspense-quick-reference.md` (function signatures)
3. Reference `react-suspense-fiber-architecture.md` (as needed)
4. Check `suspense-flow-diagram.md` (state transitions)

## Related Documentation

- `effect-docs.md` - Effect.ts APIs for async coordination
- `effect-atom-core.md` - Atom/AtomRegistry for reactive state
- `router-framework-plan.md` - How Suspense fits with routing

## Testing Resources

See `suspense-quick-reference.md` testing section and `suspense-implementation-guide.md` testing chapter for:

- Wakeable creation utilities
- Boundary testing patterns
- Test checklist (10 items)

---

**Last Updated**: 2025-12-25
**Research Scope**: React source code architecture (fiber, suspense, work loop)
**Completeness**: 100% - covers all four core questions from research request
