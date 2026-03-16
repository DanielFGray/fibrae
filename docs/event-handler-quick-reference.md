# Event Handler Execution - Quick Reference

## Where Event Handlers Are Executed

### Files & Line Numbers

| Location           | File              | Lines   | Function                 | Purpose                           |
| ------------------ | ----------------- | ------- | ------------------------ | --------------------------------- |
| **Primary**        | `dom.ts`          | 63-91   | `attachEventListeners()` | Attach listeners to DOM elements  |
| **Error Handling** | `fiber-render.ts` | 327-374 | `handleFiberError()`     | Route errors to ErrorBoundary     |
| **DOM Updates**    | `fiber-render.ts` | 890-969 | `updateDom()`            | Update listeners on prop changes  |
| **Context**        | `runtime.ts`      | 99-109  | `runForkWithRuntime()`   | Execute Effects with full context |

## Event Handler Flow (Simplified)

```
User component:
  <button onClick={() => Effect.gen(...)} />
         ↓
attachEventListeners() detects "onClick"
         ↓
Converts to event type: "click"
         ↓
el.addEventListener("click", wrapper)
         ↓
DOM fires event
         ↓
wrapper calls user's handler(event)
         ↓
handler returns Effect<A>?
  ├─ Yes → Effect.catchAllCause() → runForkWithRuntime() → Execute async
  └─ No  → Ignored
         ↓
Effect succeeds or fails
  ├─ Fails → handleFiberError() → ErrorBoundary catches → Show fallback
  └─ Succeeds → Done
```

## Key Functions

### 1. `attachEventListeners()` - dom.ts:63

**What:** Attaches native event listeners to DOM elements

**Signature:**

```typescript
attachEventListeners(
  el: HTMLElement,
  props: Record<string, unknown>,
  runtime: FibraeRuntime,
  onError?: (cause: Cause.Cause<unknown>) => Effect.Effect<unknown, never, unknown>
): void
```

**How it works:**

```typescript
// Loop through props
// Find ones starting with "on" (onClick, onChange, etc.)
// Extract event type: onClick → click
// Create wrapper function
// Call user's handler
// If it returns an Effect, execute it async with error handling
```

### 2. `handleFiberError()` - fiber-render.ts:327

**What:** Routes errors from event handlers to ErrorBoundary

**Signature:**

```typescript
handleFiberError(
  fiber: Fiber,
  cause: unknown
): Effect.Effect<Option.Option<Fiber>, never, FibraeRuntime>
```

**How it works:**

1. Find nearest ErrorBoundary ancestor
2. If found: set hasError=true, call onError callback, queue re-render
3. If not found: log error

### 3. `runForkWithRuntime()` - runtime.ts:99

**What:** Executes an Effect with the full application context

**Signature:**

```typescript
runForkWithRuntime(runtime: FibraeRuntime) =>
  <A, E>(effect: Effect.Effect<A, E, unknown>) => void
```

**How it works:**

- Gets full context from `runtime.fullContextRef`
- Provides context to the Effect
- Forks the Effect for async execution

## Error Handling

### Flow When Event Handler Effect Fails

```
Event handler returns Effect.gen(function* () {
  yield* someFailingEffect();  // Throws error
})
        ↓
Effect.catchAllCause() catches the error
        ↓
handleFiberError(ownerFiber, cause) is called
        ↓
Find nearest ErrorBoundary parent
        ↓
Is there an ErrorBoundary?
  ├─ YES:
  │   ├─ Set errorBoundary.config.hasError = true
  │   ├─ Call errorBoundary.config.onError?.(cause)
  │   ├─ Queue boundary for re-render
  │   └─ Show fallback element
  │
  └─ NO:
      └─ Log with Effect.logError("Event handler error", cause)
```

### Using ErrorBoundary

```typescript
ErrorBoundary({
  fallback: h("div", {}, ["Error occurred"]),
  onError: (error) => console.error("Event handler failed:", error),
  children: [
    h(
      "button",
      {
        onClick: () =>
          Effect.gen(function* () {
            // This error will be caught by ErrorBoundary
            yield* Effect.fail(new Error("Something went wrong"));
          }),
      },
      ["Click me"],
    ),
  ],
});
```

## Context Available in Event Handlers

### What's Available

```typescript
onClick={() => Effect.gen(function* () {
  // All of these are available:
  const runtime = yield* FibraeRuntime;
  const registry = yield* AtomRegistry;
  const navigator = yield* NavigatorTag;

  // Plus any custom services you provided
})}
```

### Where It Comes From

- Captured at render time in `runtime.fullContextRef`
- Provided to Effect via `Effect.provide(effect, fullContext)`
- Available to all event handler Effects automatically

## Event Type Information

### At Attachment Time (dom.ts:71)

```typescript
const eventType = key.toLowerCase().substring(2); // "click"
```

### At Execution Time (in Effect)

```typescript
onClick={(event: Event) => Effect.gen(function* () {
  const eventType = event.type;  // Access from Event object
})}
```

## Listener Storage & Cleanup

### How Listeners Are Managed

```typescript
// Stored in FiberState
listenerStore: WeakMap<HTMLElement, Record<string, EventListener>>;

// When updating props:
// 1. Get stored listeners for element
// 2. Remove ones that changed or were deleted
// 3. Add new ones for changed handlers
// 4. Update the store
```

### Cleanup

- Old listeners automatically removed when:
  - Props change (event handler function replaced)
  - Element is deleted
  - Component unmounts

## Test Example

```typescript
it("shows fallback when event handler Effect fails", () => {
  // Button exists initially
  cy.getCy("fail-event").should("exist");

  // Click button with failing Effect handler
  cy.getCy("fail-event").click();

  // ErrorBoundary catches error and shows fallback
  cy.getCy("fallback-event").should("exist");
  cy.getCy("fallback-event").should("contain", "Event Error");
});
```

## Common Patterns

### Returning Nothing (Sync Handler)

```typescript
onClick={() => {
  console.log("Clicked");
  // No return - effect ignored
}}
```

### Returning an Effect (Async Handler)

```typescript
onClick={() => Effect.gen(function* () {
  yield* SomeService.doWork();
})}
```

### Handling Event Properties

```typescript
onClick={(event: Event) => {
  const target = event.target as HTMLButtonElement;
  return Effect.gen(function* () {
    yield* SomeService.handleClick(target.value);
  });
}}
```

### Updating Atoms

```typescript
onClick={() => {
  const registry = useAtomRegistry(); // Get from context
  registry.set(counterAtom, 5);
  // No return needed - sync update
}}
```

## Important Notes

✅ **What Works:**

- Event handlers can return Effects
- Errors are caught by ErrorBoundary
- Full context available to Effects
- Old listeners properly removed on updates

⚠️ **Limitations:**

- Event type not in error context (use `event.type` instead)
- Event type extraction happens at attachment time
- Changes need coordination across multiple files

## Roadmap Items

- Surface stream errors to boundary before first emission
- Improve error logging with structured data
- Add tests for specific error scenarios
