# Event Handler Execution Documentation Index

This directory contains comprehensive documentation on how event handlers are executed in fibrae, including their attachment, execution flow, error handling, and context propagation.

## Documents

### 1. **event-handler-execution-analysis.md** (18KB - Comprehensive)

**For:** Deep technical understanding, implementation details, architectural context

**Contains:**

- Complete event handler attachment mechanism (dom.ts:63-91)
- Two-tier execution model explanation
- Error handling flow with handleFiberError() (fiber-render.ts:327-374)
- Event type availability analysis
- Full context propagation via runForkWithRuntime() (runtime.ts:99-109)
- Multiple attachment location analysis
- Listener storage and cleanup mechanisms
- Comprehensive test coverage details
- Architecture diagram
- Line numbers for all code locations
- Limitations and future improvements

**Best for:** Developers who need to modify event handler code, understand error handling, or debug event-related issues.

### 2. **event-handler-quick-reference.md** (7KB - Quick Reference)

**For:** Quick lookups, usage patterns, common scenarios

**Contains:**

- Quick lookup table of key files and functions
- Simplified event flow diagram
- Function signatures for main APIs
- Error handling flow visualization
- Usage patterns and code examples
- Common event handler patterns
- Important notes and limitations
- Roadmap items

**Best for:** Developers using fibrae, need quick answers, implementing event handlers, or understanding error boundaries.

## Quick Facts

### Where Event Handlers Are Executed

| Aspect             | File              | Lines   | Function                 |
| ------------------ | ----------------- | ------- | ------------------------ |
| **Attachment**     | `dom.ts`          | 63-91   | `attachEventListeners()` |
| **Error Handling** | `fiber-render.ts` | 327-374 | `handleFiberError()`     |
| **DOM Updates**    | `fiber-render.ts` | 890-969 | `updateDom()`            |
| **Context**        | `runtime.ts`      | 99-109  | `runForkWithRuntime()`   |

### Event Handler Execution Flow

```
DOM Event
  ↓
attachEventListeners() wrapper
  ├─ Extract event type (onClick → "click")
  ├─ Call user handler
  │
  └─ If returns Effect
     ├─ Effect.catchAllCause()
     ├─ runForkWithRuntime() (provides context)
     └─ Execute async
        ├─ Success → Done
        └─ Failure → handleFiberError()
           ├─ Find ErrorBoundary
           ├─ Set hasError = true
           ├─ Queue re-render
           └─ Show fallback
```

### Error Handling

When an event handler Effect fails:

1. **Caught by:** `Effect.catchAllCause()` in dom.ts:79
2. **Routed to:** `handleFiberError(fiber, cause)` in fiber-render.ts:327
3. **Finds:** Nearest ErrorBoundary ancestor
4. **Actions:**
   - Sets `hasError = true` on boundary
   - Calls optional `onError` callback
   - Queues boundary for re-render
   - Renders fallback element
5. **Fallback:** If no ErrorBoundary, logs with `Effect.logError()`

### Context Available to Event Handlers

```typescript
onClick={() => Effect.gen(function* () {
  const runtime = yield* FibraeRuntime;      // Main runtime
  const registry = yield* AtomRegistry;      // Atom operations
  const navigator = yield* NavigatorTag;     // Routing
  const router = yield* RouterHandlers;      // Route matching
  // Plus any custom services
})}
```

## Key Concepts

### Two-Tier Execution Model

**Tier 1 - Synchronous:**

- DOM event fires
- User's handler function called with Event object
- Handler can return Effect or nothing

**Tier 2 - Asynchronous:**

- If Effect returned: wrap with error handling
- Execute via `runForkWithRuntime()` with full context
- All application services available

### Event Type Extraction

**At Attachment Time (dom.ts:71):**

```typescript
const eventType = key.toLowerCase().substring(2);
// onClick → "click"
// onChange → "change"
// onMouseEnter → "mouseenter"
```

**At Execution Time:**

- Event type string NOT automatically in Error context
- Workaround: use `event.type` from Event object

### Listener Storage & Cleanup

Stored in: `FiberState.listenerStore` (WeakMap<HTMLElement, Record<string, EventListener>>)

- Prevents duplicate listeners
- Enables removal of old handlers
- Prevents memory leaks

## Related Documentation

- **effect-docs.md** - Effect.ts API documentation
- **effect-atom-core.md** - Atom/AtomRegistry API reference
- **components.md** - ErrorBoundary and Suspense components
- **router-framework-plan.md** - Routing integration

## Common Questions

**Q: How do I use event handlers in fibrae?**
A: See event-handler-quick-reference.md → "Common Patterns" section

**Q: What happens when my event handler fails?**
A: See event-handler-quick-reference.md → "Error Handling" section or comprehensive analysis → "3. Error Handling Mechanism"

**Q: What context is available in event handlers?**
A: See event-handler-quick-reference.md → "Context Available in Event Handlers"

**Q: Where is the code that catches event handler errors?**
A: See event-handler-execution-analysis.md → "4. HANDLEFIBERROR - THE KEY ERROR HANDLER" (fiber-render.ts:327-374)

**Q: How are event listeners cleaned up?**
A: See event-handler-quick-reference.md → "Listener Storage & Cleanup"

## Testing

Event handler error tests: `packages/demo/cypress/e2e/error-boundary.cy.ts`

Key test: "shows fallback when event handler Effect fails" (Line 11-21)

## Future Enhancements

From project roadmap:

1. Surface stream errors to ErrorBoundary before first emission
2. Error state takes precedence over Suspense fallback
3. Enhanced structured logging with event metadata
4. More comprehensive E2E test coverage

## Revision History

- **2025-12-26**: Complete exploration and documentation created
  - Analyzed all event handler code paths
  - Identified 3 attachment locations
  - Documented error handling flow
  - Created comprehensive guides
