# Effect Atom Core Documentation

This document covers the core APIs from `@effect-atom/atom` package, focusing on `Atom`, `AtomRegistry`, and `AtomRuntime` - the non-React bindings.

## Core Concepts

Effect Atom is a reactive state management library for Effect, enabling efficient state management with support for derived state, effects, and streams. Unlike React state management, it works directly with Effect.ts primitives.

## Atom

The `Atom` is the fundamental unit of reactive state in Effect Atom.

### Basic Operations

```typescript
import { Atom } from "@effect-atom/atom"

// Get atom value
const get: <A>(self: Atom<A>) => Effect.Effect<A, never, AtomRegistry>

// Check if value is an atom
const isAtom: (u: unknown) => u is Atom<any>

// Convert atom to stream
const toStream: <A>(self: Atom<A>) => Stream.Stream<A, never, AtomRegistry>

// Refresh atom value
const refresh: <A>(self: Atom<A>) => Effect.Effect<void, never, AtomRegistry>
```

### Creating Atoms

```typescript
// Basic atom creation
const countAtom = Atom.make(0)

// Atom from function with get context
const derivedAtom = Atom.make((get) => {
  const count = get(countAtom)
  return count * 2
})

// Atom family for parameterized atoms
const userAtom = Atom.family((id: string) =>
  Atom.make(Effect.succeed({ id, name: "User" + id }))
)
```

### Atom Transformations

```typescript
// Map atom values
const map: {
  <R extends Atom<any>, B>(
    f: (_: Type<R>) => B
  ): (self: R) => [R] extends [Writable<infer _, infer RW>] ? Writable<B, RW> : Atom<B>
  <R extends Atom<any>, B>(
    self: R,
    f: (_: Type<R>) => B
  ): [R] extends [Writable<infer _, infer RW>] ? Writable<B, RW> : Atom<B>
}

// Example usage
const priceAtom = Atom.make(100)
const formattedPriceAtom = Atom.map(priceAtom, (price) => `$${price.toFixed(2)}`)
```

### Atom Configuration

```typescript
// Set initial value
const initialValue: {
  <A>(initialValue: A): (self: Atom<A>) => readonly [Atom<A>, A]
  <A>(self: Atom<A>, initialValue: A): readonly [Atom<A>, A]
}

// Configure lazy evaluation
const setLazy: {
  (lazy: boolean): <A extends Atom<any>>(self: A) => A
  <A extends Atom<any>>(self: A, lazy: boolean): A
}

// Set idle time-to-live
const setIdleTTL: {
  (duration: Duration.DurationInput): <A extends Atom<any>>(self: A) => A
  <A extends Atom<any>>(self: A, duration: Duration.DurationInput): A
}

// Keep atom alive (prevent garbage collection)
const keepAlive: <A extends Atom<any>>(self: A) => A

// Debounce atom updates
const debounce: {
  (duration: Duration.DurationInput): <A extends Atom<any>>(self: A) => WithoutSerializable<A>
  <A extends Atom<any>>(self: A, duration: Duration.DurationInput): WithoutSerializable<A>
}
```

### Working with Results

```typescript
// Get result from atom containing Result type
const getResult: <A, E>(
  self: Atom<Result.Result<A, E>>,
  options?: { readonly suspendOnWaiting?: boolean | undefined }
) => Effect.Effect<A, E, AtomRegistry>

// Add fallback for Result atoms
const withFallback: {
  <E2, A2>(
    fallback: Atom<Result.Result<A2, E2>>
  ): <R extends Atom<Result.Result<any, any>>>(self: R) => /* ... */
}
```

## AtomRegistry

The `AtomRegistry` is the core component that manages a collection of atoms and their lifecycle. It provides the execution context for all atom operations and handles reactivity, subscriptions, and state management.

### Registry Interface

The complete Registry interface provides methods for all atom operations:

```typescript
export interface Registry {
  readonly [TypeId]: TypeId
  readonly getNodes: () => ReadonlyMap<Atom.Atom<any> | string, Node<any>>
  readonly get: <A>(atom: Atom.Atom<A>) => A
  readonly mount: <A>(atom: Atom.Atom<A>) => () => void
  readonly refresh: <A>(atom: Atom.Atom<A>) => void
  readonly set: <R, W>(atom: Atom.Writable<R, W>, value: W) => void
  readonly setSerializable: (key: string, encoded: unknown) => void
  readonly modify: <R, W, A>(atom: Atom.Writable<R, W>, f: (_: R) => [returnValue: A, nextValue: W]) => A
  readonly update: <R, W>(atom: Atom.Writable<R, W>, f: (_: R) => W) => void
  readonly subscribe: <A>(
    atom: Atom.Atom<A>,
    f: (_: A) => void,
    options?: { readonly immediate?: boolean }
  ) => () => void
  readonly reset: () => void
  readonly dispose: () => void
}
```

### Creating Registry

#### Basic Registry Creation

```typescript
import { Registry } from "@effect-atom/atom"

// Create registry with default options
const make: (options?: {
  readonly initialValues?: Iterable<readonly [Atom.Atom<any>, any]>
  readonly scheduleTask?: ((f: () => void) => void)
  readonly timeoutResolution?: number
  readonly defaultIdleTTL?: number
}) => Registry

// Example usage
const registry = Registry.make({
  initialValues: [[countAtom, 0], [nameAtom, "default"]],
  scheduleTask: (f) => setTimeout(f, 0), // Custom task scheduling
  timeoutResolution: 100, // Milliseconds
  defaultIdleTTL: 30000 // 30 seconds
})
```

#### Layer-based Registry Creation

```typescript
// Create registry layer for Effect programs
const layer: Layer.Layer<Registry.AtomRegistry, never, never>

// Create registry layer with options
const layerOptions: (options?: {
  readonly initialValues?: Iterable<readonly [Atom.Atom<any>, any]>
  readonly scheduleTask?: ((f: () => void) => void)
  readonly timeoutResolution?: number
  readonly defaultIdleTTL?: number
}) => Layer.Layer<AtomRegistry>

// Example usage with Effect programs
const program = Effect.gen(function* () {
  const count = yield* Atom.get(countAtom)
  yield* Effect.log(`Count is: ${count}`)
}).pipe(
  Effect.provide(Registry.layer)
)
```

### Registry Operations

#### Reading and Writing Atoms

```typescript
// Direct registry operations (synchronous)
const registry = Registry.make()

// Get atom value
const currentValue = registry.get(myAtom)

// Set writable atom value
registry.set(writableAtom, newValue)

// Update writable atom with function
registry.update(writableAtom, (current) => current + 1)

// Modify with return value
const result = registry.modify(writableAtom, (current) => [
  current, // return value
  current + 1 // new state
])
```

#### Stream Integration

```typescript
// Convert atom to stream
const toStream: {
  <A>(atom: Atom.Atom<A>): (self: Registry) => Stream.Stream<A>
  <A>(self: Registry, atom: Atom.Atom<A>): Stream.Stream<A>
}

// Convert Result atom to stream
const toStreamResult: {
  <A, E>(atom: Atom.Atom<Result.Result<A, E>>): (self: Registry) => Stream.Stream<A, E>
  <A, E>(self: Registry, atom: Atom.Atom<Result.Result<A, E>>): Stream.Stream<A, E>
}

// Get result from Result atom
const getResult: {
  <A, E>(
    atom: Atom.Atom<Result.Result<A, E>>,
    options?: { readonly suspendOnWaiting?: boolean }
  ): (self: Registry) => Effect.Effect<A, E>
}

// Example usage
const countStream = Registry.toStream(registry, countAtom)
const resultStream = Registry.toStreamResult(registry, asyncAtom)
```

#### Subscriptions and Lifecycle

```typescript
// Subscribe to atom changes
const unsubscribe = registry.subscribe(
  myAtom,
  (newValue) => console.log("Value changed:", newValue),
  { immediate: true } // Fire immediately with current value
)

// Mount atom (keeps it alive)
const unmount = registry.mount(myAtom)

// Refresh atom value
registry.refresh(myAtom)

// Reset all atoms to initial state
registry.reset()

// Dispose registry and cleanup resources
registry.dispose()
```

### Registry Type Guards and Utilities

```typescript
// Check if value is a registry
const isRegistry: (u: unknown) => u is Registry
if (Registry.isRegistry(someValue)) {
  // TypeScript knows someValue is a Registry
}

// Registry TypeId for type discrimination
const TypeId: "~effect-atom/atom/Registry"
```

### Default Registry and Dependency Injection

For simpler use cases, Effect Atom provides a default registry:

```typescript
// Default registry instance (for Vue.js integration)
const defaultRegistry: Registry.Registry

// Inject registry function (for Vue.js)
const injectRegistry: () => Registry.Registry

// Registry injection key (for Vue.js provide/inject)
const registryKey: InjectionKey<Registry.Registry>
```

### Serialization Support

```typescript
// Set serializable atom value by key
registry.setSerializable("my-atom-key", encodedValue)

// Get all nodes (for debugging/inspection)
const nodes = registry.getNodes()
```

### Registry Configuration Options

- **`initialValues`**: Pre-populate atoms with initial values
- **`scheduleTask`**: Custom task scheduler (defaults to microtask)
- **`timeoutResolution`**: Timer resolution in milliseconds
- **`defaultIdleTTL`**: Default time-to-live for idle atoms in milliseconds

### Usage with Effect Programs

```typescript
import { Atom, Registry } from "@effect-atom/atom"
import { Effect } from "effect"

const countAtom = Atom.make(0)

// Using registry in Effect programs
const program = Effect.gen(function* () {
  // Registry is available as a service
  const count = yield* Atom.get(countAtom)
  yield* Effect.log(`Current count: ${count}`)
  
  // Update the atom
  yield* Effect.func(() => {
    // Direct registry access through context
    const registry = yield* Registry
    registry.set(countAtom, count + 1)
  })
}).pipe(
  Effect.provide(Registry.layer)
)
```

## AtomRuntime

The `AtomRuntime` provides integration with Effect services and layers.

### Runtime Interface

```typescript
export interface AtomRuntime<R, ER = never> extends Atom<Result.Result<Runtime.Runtime<R>, ER>> {
  readonly factory: RuntimeFactory
  readonly layer: Atom<Layer.Layer<R, ER>>

  // Create atoms from effects
  readonly atom: {
    <A, E>(
      create: (get: Context) => Effect.Effect<A, E, Scope.Scope | R | AtomRegistry | Reactivity.Reactivity>,
      options?: { readonly initialValue?: A }
    ): Atom<Result.Result<A, E | ER>>
    
    <A, E>(
      effect: Effect.Effect<A, E, Scope.Scope | R | AtomRegistry | Reactivity.Reactivity>,
      options?: { readonly initialValue?: A }
    ): Atom<Result.Result<A, E | ER>>
  }

  // Create reactive functions
  readonly fn: {
    <E, A, Arg = void>(
      fn: (arg: Arg, get: FnContext) => Effect.Effect<A, E, Scope.Scope | AtomRegistry | Reactivity.Reactivity | R>,
      options?: {
        readonly initialValue?: A
        readonly reactivityKeys?: ReadonlyArray<unknown> | ReadonlyRecord<string, ReadonlyArray<unknown>>
        readonly concurrent?: boolean
      }
    ): AtomResultFn<Arg, A, E | ER>
  }

  // Pull subscriptions
  readonly pull: <A, E>(
    create: ((get: Context) => Stream.Stream<A, E, R | AtomRegistry | Reactivity.Reactivity>) | Stream.Stream<A, E, R | AtomRegistry | Reactivity.Reactivity>,
    options?: {
      readonly disableAccumulation?: boolean
      readonly initialValue?: ReadonlyArray<A>
    }
  ) => Writable<PullResult<A, E | ER>, void>

  // Subscription references
  readonly subscriptionRef: <A, E>(
    create: Effect.Effect<SubscriptionRef.SubscriptionRef<A>, E, R | AtomRegistry | Reactivity.Reactivity> | ((get: Context) => Effect.Effect<SubscriptionRef.SubscriptionRef<A>, E, R | AtomRegistry | Reactivity.Reactivity>)
  ) => Writable<Result.Result<A, E>, A>
}
```

### Creating AtomRuntime

```typescript
// Runtime factory
export interface RuntimeFactory {
  <R, E>(
    create: Layer.Layer<R, E, AtomRegistry | Reactivity.Reactivity> | ((get: Context) => Layer.Layer<R, E, AtomRegistry | Reactivity.Reactivity>)
  ): AtomRuntime<R, E>
  
  readonly memoMap: Layer.MemoMap
  readonly addGlobalLayer: <A, E>(layer: Layer.Layer<A, E, AtomRegistry | Reactivity.Reactivity>) => void
  readonly withReactivity: (
    keys: ReadonlyArray<unknown> | ReadonlyRecord<string, ReadonlyArray<unknown>>
  ) => <A extends Atom<any>>(atom: A) => A
}

// Create runtime from layer
const runtime: RuntimeFactory
```

### Usage Example

```typescript
import { Atom } from "@effect-atom/atom"
import { Effect, Layer } from "effect"

// Define a service
class Users extends Effect.Service<Users>()("app/Users", {
  effect: Effect.gen(function* () {
    const getAll = Effect.succeed([
      { id: "1", name: "Alice" },
      { id: "2", name: "Bob" },
    ])
    return { getAll } as const
  }),
}) {}

// Create AtomRuntime from Layer
const runtimeAtom = Atom.runtime(Users.Default)

// Create atom that uses the service
export const usersAtom = runtimeAtom.atom(
  Effect.gen(function* () {
    const users = yield* Users
    return yield* users.getAll
  }),
)

// Use with atom family for dynamic queries
export const userAtom = Atom.family((id: string) =>
  runtimeAtom.atom(
    Effect.gen(function* () {
      const users = yield* Users
      return yield* users.findById(id)
    }),
  ),
)
```

### Global Layer Configuration

```typescript
import { Atom } from "@effect-atom/atom"
import { ConfigProvider, Layer } from "effect"

// Add global layers
Atom.runtime.addGlobalLayer(
  Layer.setConfigProvider(ConfigProvider.fromJson(import.meta.env)),
)
```

## Context Interface

The `Context` interface provides methods for interacting with atoms within effects:

```typescript
export interface Context {
  <A>(atom: Atom<A>): A
  get<A>(this: Context, atom: Atom<A>): A
  result<A, E>(this: Context, atom: Atom<Result.Result<A, E>>, options?: { readonly suspendOnWaiting?: boolean }): Effect.Effect<A, E>
  once<A>(this: Context, atom: Atom<A>): A
  addFinalizer(this: Context, f: () => void): void
  mount<A>(this: Context, atom: Atom<A>): void
  refresh<A>(this: Context, atom: Atom<A>): void
  refreshSelf(this: Context): void
  set<R, W>(this: Context, atom: Writable<R, W>, value: W): void
  stream<A>(this: Context, atom: Atom<A>, options?: { readonly withoutInitialValue?: boolean; readonly bufferSize?: number }): Stream.Stream<A>
  subscribe<A>(this: Context, atom: Atom<A>, f: (_: A) => void, options?: { readonly immediate?: boolean }): void
  readonly registry: Registry.Registry
}
```

## Key Differences from React State Management

1. **Effect Integration**: Atoms work directly with Effect programs, not React state
2. **Automatic Reactivity**: Reading an atom automatically subscribes to changes
3. **Fine-grained Updates**: Only components that use changed atoms re-render
4. **Service Integration**: AtomRuntime provides dependency injection via Effect services
5. **Stream Support**: Native support for Effect streams and async operations

This covers the core non-React APIs for working with Effect Atom in your fibrae project.