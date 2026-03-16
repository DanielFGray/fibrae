# Fibrae Event Handler Execution Analysis

## Summary

Event handlers in Fibrae are executed through a two-layer system: DOM attachment and asynchronous Effect execution. This document provides a complete analysis of where and how event handlers flow from DOM to Effect execution, including error handling mechanisms.

---

## 1. EVENT HANDLER ATTACHMENT

### Primary Location: `/packages/fibrae/src/dom.ts` (Lines 63-91)

**Function:** `attachEventListeners()`

```typescript
export const attachEventListeners = (
  el: HTMLElement,
  props: Record<string, unknown>,
  runtime: FibraeRuntime,
  onError?: (cause: Cause.Cause<unknown>) => Effect.Effect<unknown, never, unknown>,
): void
```

**What it does:**

- Iterates through component props looking for event handlers (props starting with "on")
- Extracts the event type by removing "on" prefix and converting to lowercase
  - Example: `onClick` → `click`, `onChange` → `change`
- Attaches native DOM event listeners to the element

**Key Code (Lines 69-89):**

```typescript
for (const [key, handler] of Object.entries(props)) {
  if (isEvent(key) && typeof handler === "function") {
    const eventType = key.toLowerCase().substring(2); // Extract event type

    el.addEventListener(eventType, (event: Event) => {
      const result = (handler as (e: Event) => unknown)(event);

      if (Effect.isEffect(result)) {
        // Use runForkWithRuntime to get the full application context
        const effectWithErrorHandling = (result as Effect.Effect<unknown, unknown, unknown>).pipe(
          Effect.catchAllCause((cause) => {
            if (onError) {
              return onError(cause); // Callback to ErrorBoundary
            }
            return Effect.logError("Event handler error", cause);
          }),
        );
        runForkWithRuntime(runtime)(effectWithErrorHandling);
      }
    });
  }
}
```

---

## 2. EVENT HANDLER EXECUTION FLOW

### Two-Tier Execution Model

#### **Tier 1: Synchronous (Immediate)**

1. DOM fires native event
2. User's event handler function is called with the Event object
3. Handler returns either:
   - **Synchronous result:** ignored (return value discarded)
   - **Effect object:** wrapped and executed asynchronously

#### **Tier 2: Asynchronous (Effect-based)**

1. Check if result is an Effect using `Effect.isEffect(result)`
2. Wrap the Effect with error handling via `Effect.catchAllCause()`
3. Execute via `runForkWithRuntime(runtime)(effectWithErrorHandling)`

### Example Flow

```typescript
// User's component:
<button onClick={() => {
  // Can return nothing (sync), or return an Effect
  return Effect.gen(function* () {
    yield* SomeService.doWork();
  });
}} />

// In attachEventListeners callback (line 74):
const result = (handler as (e: Event) => unknown)(event);
// result is now either:
//   - undefined (sync handler)
//   - Effect<A, E, R> (async handler)

if (Effect.isEffect(result)) {
  // Execute the Effect asynchronously
  runForkWithRuntime(runtime)(effectWithErrorHandling);
}
```

---

## 3. ERROR HANDLING MECHANISM

### Current Error Handling (Fiber-based Renderer)

**Location:** `fiber-render.ts` (Lines 949-956)

When an event handler Effect fails, the error flow is:

1. **Catch Error:** `Effect.catchAllCause((cause) => {...})`
2. **Handle via ErrorBoundary:** Call `handleFiberError(ownerFiber, cause)`
3. **Fallback:** If no ErrorBoundary, log error

```typescript
const effectWithErrorHandling = result.pipe(
  Effect.catchAllCause((cause) => {
    return ownerFiber ? handleFiberError(ownerFiber, cause) : Effect.void;
  }),
);
runForkWithRuntime(runtime)(effectWithErrorHandling);
```

### Alternative Error Handling (Legacy Renderer)

**Location:** `render.ts` (Lines 436-437)

```typescript
attachEventListeners(el, vElement.props as Record<string, unknown>, runtime);
```

Uses ErrorBoundaryChannel (Lines 300-304):

```typescript
const errorChannel: Context.Tag.Service<typeof ErrorBoundaryChannel> = {
  reportError: (error: unknown) => Deferred.fail(errorDeferred, error).pipe(Effect.ignore),
};
```

---

## 4. HANDLEFIBERROR - THE KEY ERROR HANDLER

**Location:** `fiber-render.ts` (Lines 327-374)

**Purpose:** Routes errors to nearest ErrorBoundary or logs unhandled errors

**Function Signature:**

```typescript
const handleFiberError = (
  fiber: Fiber,
  cause: unknown,
): Effect.Effect<Option.Option<Fiber>, never, FibraeRuntime>
```

**Flow:**

1. Find nearest ErrorBoundary ancestor via `findNearestErrorBoundary(fiber)`
2. If found:
   - Set `hasError = true` on the boundary's config
   - Call optional `onError` callback
   - Queue boundary for re-render
   - Reconcile with fallback element
3. If not found:
   - Log error with `Effect.logError("Unhandled error without ErrorBoundary", cause)`
   - Return `Option.none()`

**Key Code (Lines 344-354):**

```typescript
const cfg = Option.getOrElse(
  boundary.errorBoundary,
  (): ErrorBoundaryConfig => ({
    fallback: h("div", {}, []),
    hasError: false,
    onError: undefined,
  }),
);
cfg.onError?.(cause); // Call user's onError callback if provided
cfg.hasError = true; // Mark that an error occurred
boundary.errorBoundary = Option.some(cfg);
```

---

## 5. EVENT TYPE AVAILABILITY AT EXECUTION TIME

### Event Type Information

The event type is **available at attachment time only**, not at execution time:

**At Attachment (dom.ts:71):**

```typescript
const eventType = key.toLowerCase().substring(2); // "click", "change", etc.
```

**Problem:** The `eventType` string is not passed to the Effect execution context

**What IS available at execution time:**

1. The `Event` object passed to the handler (contains event type info)
2. The `runtime` context with all services
3. The `ownerFiber` reference (if error handling is needed)

**Workaround for accessing event type in Effect:**

```typescript
onClick={(event: Event) => Effect.gen(function* () {
  const eventType = event.type;  // "click"
  // Access the actual event type from the Event object
})}
```

---

## 6. CONTEXT PROPAGATION TO EVENT HANDLERS

### Full Application Context is Available

**Location:** `runtime.ts` (Lines 99-109)

```typescript
export const runForkWithRuntime =
  (runtime: FibraeRuntime) =>
  <A, E>(effect: Effect.Effect<A, E, unknown>) => {
    const withContext = Effect.gen(function* () {
      const fullContext = yield* Ref.get(runtime.fullContextRef);
      return yield* Effect.provide(effect, fullContext as Context.Context<never>);
    });
    return runtime.runFork(
      withContext as Effect.Effect<unknown, unknown, AtomRegistry.AtomRegistry>,
    );
  };
```

**What context is available in event handlers:**

- FibraeRuntime
- AtomRegistry (for atom operations)
- Navigator (for routing)
- RouterHandlers
- Any custom user services provided at render time
- All services from the full application layer stack

---

## 7. ERROR BOUNDARY INTEGRATION

### ErrorBoundary Component

**Location:** `components.ts` (Lines 68-92)

```typescript
export const ErrorBoundary = (props: {
  fallback: VElement;
  onError?: (cause: unknown) => void;
  children?: VElement | VElement[];
}): VElement
```

**How it catches event handler errors:**

1. **Creates error boundary context** during reconciliation
2. **Stores configuration** in fiber.errorBoundary
3. **Event handler errors trigger** `handleFiberError(ownerFiber, cause)`
4. **Sets hasError = true** on the boundary
5. **Queues re-render** which shows fallback
6. **Calls onError callback** if provided (user can log, report, etc.)

**Usage Example:**

```typescript
ErrorBoundary({
  fallback: h("div", {}, ["Something went wrong"]),
  onError: (error) => {
    console.error("Event handler failed:", error);
    // Could send to error tracking service
  },
  children: [
    h(
      "button",
      {
        onClick: () =>
          Effect.gen(function* () {
            yield* someFailingEffect();
          }),
      },
      ["Click me"],
    ),
  ],
});
```

---

## 8. MULTIPLE EVENT HANDLER ATTACHMENT LOCATIONS

### Location 1: New DOM Creation (fiber-render.ts:853-880)

**In `createDom` function** - when building new host elements:

- Creates the DOM element
- Calls `updateDom()` which attaches listeners (Lines 890-969)

### Location 2: DOM Update (fiber-render.ts:890-969)

**In `updateDom` function** - when updating existing elements:

```typescript
// Add new event listeners (Lines 938-966)
Object.keys(nextProps)
  .filter(isEvent)
  .filter(isNew(prevProps, nextProps))
  .forEach((name) => {
    const eventType = name.toLowerCase().substring(2);
    const handler = nextProps[name] as (event: Event) => unknown;

    const wrapper: EventListener = (event: Event) => {
      const result = handler(event);
      if (Effect.isEffect(result)) {
        const effectWithErrorHandling = result.pipe(
          Effect.catchAllCause((cause) => {
            return ownerFiber ? handleFiberError(ownerFiber, cause) : Effect.void;
          }),
        );
        runForkWithRuntime(runtime)(effectWithErrorHandling);
      }
    };
    // Store wrapper and attach
    el.addEventListener(eventType, wrapper);
  });
```

**Also removes old listeners (Lines 914-926):**

```typescript
// Remove old event listeners that changed or were removed
const eventsToRemove = Object.keys(prevProps)
  .filter(isEvent)
  .filter((key) => !(key in nextProps) || isNew(prevProps, nextProps)(key));

for (const name of eventsToRemove) {
  const eventType = name.toLowerCase().substring(2);
  const wrapper = stored[eventType];
  if (wrapper) {
    el.removeEventListener(eventType, wrapper);
    delete stored[eventType];
  }
}
```

### Location 3: Hydration (fiber-render.ts:1517-1524)

**When hydrating server-rendered DOM:**

```typescript
attachEventListeners(el, vElement.props as Record<string, unknown>, runtime, (cause) =>
  handleFiberError(fiber, cause),
);
```

Note: Hydration passes the `onError` callback directly to `attachEventListeners`.

---

## 9. CURRENT TEST COVERAGE

### Error Boundary Tests

**Location:** `packages/demo/cypress/e2e/error-boundary.cy.ts`

**Test Cases:**

1. **Render-time crash** (Line 6-9)
   - Tests that errors thrown during component rendering are caught

2. **Event handler Effect failure** (Line 11-21)

   ```typescript
   it("shows fallback when event handler Effect fails", () => {
     cy.getCy("fail-event", { timeout: 5000 }).should("exist");
     cy.getCy("fail-event").click(); // Trigger the failing event
     cy.getCy("fallback-event", { timeout: 5000 }).should("exist");
     cy.getCy("fallback-event").should("contain", "Event Error");
   });
   ```

3. **Stream failure after first emission** (Line 23-37)
   - Tests that stream errors (post-emission) are caught

4. **Stream failure before first emission** (Line 39-44)
   - Tests that stream errors (pre-emission) are caught

5. **ErrorBoundary precedence over Suspense** (Line 46-58)
   - Tests that error state takes precedence over Suspense loading

---

## 10. KEY FILES INVOLVED

| File              | Purpose                               | Key Functions                                      |
| ----------------- | ------------------------------------- | -------------------------------------------------- |
| `dom.ts`          | Event listener attachment             | `attachEventListeners()`                           |
| `fiber-render.ts` | Fiber reconciliation & error handling | `handleFiberError()`, `createDom()`, `updateDom()` |
| `render.ts`       | Legacy renderer                       | `renderVElementToDOM()`                            |
| `runtime.ts`      | Runtime context management            | `runForkWithRuntime()`                             |
| `components.ts`   | ErrorBoundary definition              | `ErrorBoundary()`                                  |
| `shared.ts`       | Type definitions                      | `ErrorBoundaryConfig`, `Fiber`                     |
| `hydration.ts`    | Server hydration                      | `hydrateFiber()`                                   |

---

## 11. ARCHITECTURE DIAGRAM

```
┌─────────────────────────────────────────────────────────────────┐
│                         DOM EVENT                               │
│              (Native browser event firing)                       │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│              attachEventListeners (dom.ts:63)                   │
│  - Extract event type: "onClick" → "click"                      │
│  - Call user's handler function with Event object               │
└────────────────────────────┬────────────────────────────────────┘
                             │
                    ┌────────┴────────┐
                    │                 │
                    ▼                 ▼
          ┌──────────────────┐  ┌──────────────────────┐
          │ Returns Nothing  │  │ Returns Effect<A>    │
          │ (Sync handler)   │  │ (Async handler)      │
          │ → Discarded      │  │                      │
          └──────────────────┘  └──────────┬───────────┘
                                           │
                                           ▼
                            ┌──────────────────────────────┐
                            │ Wrap with Error Handling     │
                            │ Effect.catchAllCause(cause)  │
                            └──────────────┬───────────────┘
                                           │
                                           ▼
                            ┌──────────────────────────────┐
                            │ runForkWithRuntime(runtime)  │
                            │ - Provide full context       │
                            │ - Execute async              │
                            └──────────────┬───────────────┘
                                           │
                    ┌──────────────────────┴──────────────────┐
                    │                                         │
                    ▼                                         ▼
          ┌──────────────────┐                   ┌────────────────────┐
          │ Effect Succeeds  │                   │ Effect Fails       │
          │ → Done           │                   │ (Cause thrown)     │
          └──────────────────┘                   └──────────┬─────────┘
                                                            │
                                                            ▼
                                        ┌────────────────────────────────┐
                                        │ handleFiberError(ownerFiber)   │
                                        │ (fiber-render.ts:327)          │
                                        └──────────────┬─────────────────┘
                                                       │
                                     ┌─────────────────┴─────────────────┐
                                     │                                   │
                                     ▼                                   ▼
                     ┌──────────────────────────┐  ┌─────────────────────────┐
                     │ ErrorBoundary Found      │  │ No ErrorBoundary       │
                     │ - Set hasError = true    │  │ - Log error           │
                     │ - Queue re-render        │  │ - Return none         │
                     │ - Call onError callback  │  └─────────────────────────┘
                     │ - Show fallback          │
                     └──────────────────────────┘
```

---

## 12. IMPORTANT NOTES

### What Works

- ✅ Event handlers can return Effects
- ✅ Errors in Effects are caught by ErrorBoundary
- ✅ Full application context available to event handler Effects
- ✅ Event type extracted from prop name (onClick → click)
- ✅ Old listeners properly removed when props change

### Current Limitations

- ⚠️ Event type not directly available in Error context (workaround: use Event.type)
- ⚠️ Error details may not include which event caused the failure
- ⚠️ `attachEventListeners` is used in multiple places; changes need coordination

### Future Improvements (Roadmap)

- Stream errors surfaced to boundary before first emission
- Logging improvements for structured error tracking
- Tests for thrown component errors, failing event Effects, failing Streams
