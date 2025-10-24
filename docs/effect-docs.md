# Effect APIs for didact-effect

This document contains Effect.ts APIs that are relevant for building the didact-effect JSX renderer.

## Core Runtime APIs

### FiberSet.makeRuntime

**Purpose**: Create an Effect run function that is backed by a FiberSet.

```typescript
declare const makeRuntime: <
  R = never,
  A = unknown,
  E = unknown,
>() => Effect.Effect<
  <XE extends E, XA extends A>(
    effect: Effect.Effect<XA, XE, R>,
    options?: Runtime.RunForkOptions | undefined,
  ) => Fiber.RuntimeFiber<XA, XE>,
  never,
  Scope.Scope | R
>
```

**Use case for didact-effect**: This will be essential for creating a runtime that can manage component fibers. EventHandler will need to run as their own fibers, and the FiberSet helps manage the collection of all component fibers.

## Service Management

### Effect.Service

**Purpose**: Simplifies the creation and management of services in Effect by defining both a `Tag` and a `Layer`.

**Key features**:
- Combines the definition of a `Context.Tag` and a `Layer` in a single step
- Supports various ways of providing service implementation:
  - Using an `effect` to define the service dynamically
  - Using `sync` or `succeed` to define the service statically  
  - Using `scoped` to create services with lifecycle management
- Allows specifying dependencies for the service
- Can generate accessors for convenience

**Example**:
```typescript
class DidactRuntime extends Effect.Service<DidactRuntime>()("DidactRuntime", {
  accessors: true,
  scoped: Effect.gen(function*() {
    const registry = yield* AtomRegistry.AtomRegistry;
    return {
      nextUnitOfWork: Option.none<Fiber>(),
      currentRoot: Option.none<Fiber>(),
      wipRoot: Option.none<Fiber>(),
      deletions: [] as Fiber[],
    };
  }),
}) {}

```

**Use case for didact-effect**: Can be used to create services for DOM manipulation, event handling, or state management that components can depend on.

## State Management

### Atom (from @effect-atom/atom)

**Note**: We will use Atom instead of plain Ref for component state management. See `docs/effect-atom-core.md` for complete Atom documentation.

**Core Operations for didact-effect**:
- `Atom.make(initialValue)` - Create reactive atom
- `Atom.get(atom)` - Read current value (Effect)
- `Atom.set(atom, value)` - Set new value (via AtomRegistry)
- `Atom.update(atom, fn)` - Update with function (via AtomRegistry)

**Key Benefits for didact-effect**:
- **Automatic Reactivity**: Reading an atom automatically subscribes components to changes
- **Fine-grained Updates**: Only components using changed atoms re-render
- **Effect Integration**: Atoms work directly with Effect programs
- **AtomRegistry**: Provides centralized state management and subscription system

**Basic Pattern**:
```typescript
const Counter: Component = (props) =>
  Effect.gen(function* () {
    const count = yield* Atom.make(0);
    return h("button", { onClick: () => Atom.update(count, n => n + 1) }, [
      `Count: ${yield* Atom.get(count)}`,
    ]);
  });
```

### Ref (Effect built-in)

**Purpose**: Lower-level mutable reference for internal runtime state.

**Use case for didact-effect**: Used internally by the runtime for managing component lifecycle, DOM state, and other non-reactive state that doesn't need automatic subscriptions.

## Asynchronous Coordination

### Queue

**Purpose**: Lightweight in-memory queue with built-in back-pressure for asynchronous, type-safe data handling.

**Core Operations**:
- `Queue.offer` - Adds a value to the queue
- `Queue.take` - Removes and returns the oldest value from the queue

**Queue Types**:
- `Queue.bounded(capacity)` - Back-pressure when full
- `Queue.unbounded()` - No capacity limit
- `Queue.dropping(capacity)` - Discards new values when full
- `Queue.sliding(capacity)` - Removes old values for new ones

**Advanced Operations**:
- `Queue.offerAll` - Add multiple items at once
- `Queue.takeAll` - Retrieve all items at once
- `Queue.takeUpTo(n)` - Take up to n items
- `Queue.takeN(n)` - Take exactly n items (suspends until available)
- `Queue.poll` - Non-blocking take (returns Option)

**Specialized Interfaces**:
- `Queue.Enqueue<A>` - Offer-only operations
- `Queue.Dequeue<A>` - Take-only operations

**Use case for didact-effect**: **Primary use will be for queueing render work**. When atoms change and components need to re-render, the render work will be queued up for batch processing. Also useful for event queues and coordinating between component updates and DOM operations.

## Data Structures

### HashMap

**Core Interface**:
```typescript
export interface HashMap<out Key, out Value>
  extends Iterable<[Key, Value]>,
    Equal,
    Pipeable,
    Inspectable {
  readonly [TypeId]: TypeId
}
```

**Purpose**: Immutable hash map data structure.

**Key Operations**:
- `HashMap.empty()` - Create empty HashMap
- `HashMap.make(...entries)` - Create from entries
- `HashMap.get(map, key)` - Get value by key
- `HashMap.set(map, key, value)` - Set key-value pair
- `HashMap.has(map, key)` - Check if key exists
- `HashMap.remove(map, key)` - Remove key
- `HashMap.keys/values/entries` - Iteration

**Use case for didact-effect**: Useful for component props, managing component instances by ID, or caching computed values.

## Streaming & Reactive Programming

### Stream

**Core Interface**:
```typescript
export interface Stream<out A, out E = never, out R = never>
  extends Stream.Variance<A, E, R>,
    Pipeable
```

**Purpose**: A description of a program that may emit zero or more values of type `A`, may fail with errors of type `E`, and uses context of type `R`.

**Characteristics**:
- Purely functional pull-based stream
- Inherent laziness and backpressure
- Emits arrays of values for performance
- Rich composition capabilities
- Error management similar to Effect

**Use case for didact-effect**: Could be used for reactive event streams, managing component update streams, or handling continuous data flows.

## Resource Management

### Scope

**Purpose**: Core construct for managing resources safely and composably.

**Key Concepts**:
- Represents the lifetime of one or more resources
- When closed, all resources are released
- Supports finalizers for cleanup logic
- Finalizers execute in reverse order (stack unwinding)

**Core Operations**:
- `Scope.make()` - Create a new scope
- `Scope.addFinalizer(scope, finalizer)` - Add cleanup logic
- `Scope.close(scope, exit)` - Close scope and run finalizers
- `Effect.addFinalizer(finalizer)` - Add finalizer to current scope
- `Effect.scoped(effect)` - Wrap effect with automatic scope management

**Finalizer Execution**:
- Finalizers run in reverse order of addition
- Execute on success, failure, or interruption
- Guaranteed to run when scope closes

**Use case for didact-effect**: Essential for managing component lifecycles, DOM element cleanup, event listener removal, and resource cleanup when components unmount.

## Summary for didact-effect Implementation

Based on this research, here's how these APIs map to didact-effect needs:

1. **FiberSet.makeRuntime** - Core runtime for managing component fibers
2. **Effect.Service** - Services for DOM manipulation, event handling  
3. **Atom (from @effect-atom/atom)** - Reactive component state with automatic subscriptions
4. **AtomRegistry** - Centralized state management and subscription system
5. **Queue** - **Render work queue** for batching component re-renders when atoms change
6. **HashMap** - Component instance management and prop storage
7. **Stream** - Reactive event streams (optional advanced feature)
8. **Scope** - Component lifecycle and resource management
9. **Ref** - Internal runtime state (non-reactive)

### Key Architecture Points:

- **Atom + AtomRegistry**: Provides the reactive foundation where reading an atom automatically subscribes components to changes
- **FiberSet.makeRuntime**: Manages concurrent component rendering as separate fibers
- **Effect.Service**: Enables dependency injection for DOM services, event handling, etc.
- **Scope**: Ensures proper cleanup when components unmount
- **Queue**: **Render work queue** - batches component re-renders when atoms change, ensuring efficient DOM updates

The combination of these APIs provides a solid foundation for building an Effect-first JSX renderer with automatic fine-grained reactivity, proper resource management, and concurrent component execution.

---

## **Effect Iteration APIs for Performance**

Effect provides specialized iteration APIs that offer benefits over traditional `for` and `while` loops:

### **1. `Effect.forEach` - Replace `for` loops with effectful operations**

```typescript
// ❌ Traditional loop (sequential, imperative)
for (const atom of accessedAtoms) {
  const subscription = Stream.runForEach(
    Atom.toStream(atom),
    () => queueFiberForRerender(fiber)
  );
  yield* Effect.forkIn(subscription, componentScope);
}

// ✅ Effect.forEach (declarative, configurable concurrency)
yield* Effect.forEach(
  accessedAtoms, 
  (atom) => {
    const subscription = Stream.runForEach(
      Atom.toStream(atom),
      () => queueFiberForRerender(fiber)
    );
    return Effect.forkIn(subscription, componentScope);
  },
  { 
    concurrency: "unbounded",  // Parallel subscriptions
    discard: true              // Don't collect results
  }
);
```

**Benefits:**
- **Configurable concurrency**: Sequential (default), bounded, or unbounded
- **Short-circuiting**: Stops on first error (unless mode: "either")
- **Discard option**: Avoids memory overhead when results not needed
- **Type-safe**: Full inference of success/error types

### **2. `Queue.takeAll` - Replace polling loops**

```typescript
// ❌ Manual polling loop (multiple effect executions)
const batch: Fiber[] = [];
let fiber = yield* Queue.poll(state.renderQueue);
while (Option.isSome(fiber)) {
  batch.push(fiber.value);
  fiber = yield* Queue.poll(state.renderQueue);
}

// ✅ Queue.takeAll (single atomic operation)
const batch = yield* Queue.takeAll(state.renderQueue);
```

**Benefits:**
- **Atomic**: Single operation vs multiple polls
- **Returns Chunk**: More efficient than array building
- **Non-blocking**: Returns empty Chunk if queue empty

### **3. `Effect.iterate` - Replace while loops with state**

```typescript
// ❌ Traditional while loop
let state = initial;
while (condition(state)) {
  const newState = yield* updateState(state);
  state = newState;
}
return state;

// ✅ Effect.iterate (declarative state iteration)
yield* Effect.iterate(
  initial,
  {
    while: (state) => condition(state),
    body: (state) => updateState(state)
  }
);
```

**Benefits:**
- **Declarative**: Intent clearer than imperative loop
- **Effect-aware**: Handles effectful state updates naturally
- **Composable**: Easy to combine with other Effect operators

### **4. `Effect.loop` - Collect results while iterating**

```typescript
// ❌ Manual accumulation
const results = [];
let i = 0;
while (i < fiber.children.length) {
  const result = yield* reconcileChild(fiber.children[i]);
  results.push(result);
  i++;
}

// ✅ Effect.loop (declarative with accumulation)
const results = yield* Effect.loop(
  0,
  {
    while: (i) => i < fiber.children.length,
    step: (i) => i + 1,
    body: (i) => reconcileChild(fiber.children[i])
  }
);
```

**Benefits:**
- **Combines state + results**: No manual array building
- **Discard option**: Can run for side effects only
- **Indexed iteration**: Built-in counter management

### **5. `Effect.reduce` - Replace fold/accumulate patterns**

```typescript
// ❌ Manual reduce with effects
let acc = initial;
for (const item of items) {
  const result = yield* processItem(item);
  acc = combine(acc, result);
}

// ✅ Effect.reduce (declarative accumulation)
const result = yield* Effect.reduce(
  items,
  initial,
  (acc, item, index) => 
    processItem(item).pipe(
      Effect.map(result => combine(acc, result))
    )
);
```

**Benefits:**
- **Sequential guarantee**: Order preserved
- **Index tracking**: Built-in iteration counter
- **Type inference**: Accumulator type inferred

### **6. `Effect.all` - Process multiple effects**

```typescript
// ❌ Sequential processing
const results = [];
for (const fiber of fibers) {
  const result = yield* performUnitOfWork(fiber);
  results.push(result);
}

// ✅ Effect.all with concurrency
const results = yield* Effect.all(
  fibers.map(fiber => performUnitOfWork(fiber)),
  { 
    concurrency: "unbounded",      // Parallel execution
    mode: "either"                 // Collect all results even if some fail
  }
);
```

**Benefits:**
- **Flexible input**: Arrays, tuples, structs, records
- **Concurrency control**: Sequential, bounded, unbounded
- **Error handling modes**: "default" (short-circuit), "either" (collect all), "validate" (with Options)
- **Type preservation**: Maintains structure of input

### **When to Use Each API**

| Use Case | API | Example |
|----------|-----|---------|
| Iterate with effects, don't need results | `Effect.forEach` + `{ discard: true }` | Processing side effects for each atom subscription |
| Iterate with effects, collect results | `Effect.forEach` | Mapping over children to get reconciled results |
| Drain queue completely | `Queue.takeAll` | Batch processing render queue |
| While loop with effectful condition | `Effect.iterate` | Polling until condition met |
| For loop with index and results | `Effect.loop` | Walking fiber tree with state |
| Accumulate over collection | `Effect.reduce` | Building up DOM from children |
| Parallel task execution | `Effect.all` + `{ concurrency }` | Concurrent fiber rendering |

### **Performance Characteristics**

**Why Effect APIs can be faster than manual loops:**

1. **Optimized execution paths**: Effect's runtime can optimize chains of operations
2. **Fiber scheduling**: Concurrent operations use Effect's fiber scheduler efficiently
3. **Memory efficiency**: `discard: true` avoids allocating result arrays
4. **Chunk-based collections**: `Queue.takeAll` returns Chunk (persistent data structure)
5. **Short-circuiting**: Early termination on errors avoids unnecessary work
6. **Batching**: Effect can batch multiple operations together in some cases

**When traditional loops are acceptable:**

- Pure synchronous operations (no Effects)
- Simple iteration without error handling needs
- Very small collections (<10 items) where overhead doesn't matter
- Building data structures that Effect APIs don't directly support

**Best practice**: Use Effect iteration APIs for all effectful operations. The declarative style makes code more maintainable and enables Effect's runtime optimizations.
