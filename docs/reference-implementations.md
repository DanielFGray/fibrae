# Reference Implementation Patterns

Quick reference for patterns from TanStack Router and Effect Platform that we're adapting for Fibrae Router.

## TanStack History (`packages/tanstack-router/packages/history/src/index.ts`)

### Core Interface

```typescript
interface RouterHistory {
  location: HistoryLocation; // Current location (reactive getter)
  length: number; // History stack length
  subscribers: Set<(opts) => void>; // Location change listeners
  subscribe: (cb) => () => void; // Add listener, returns unsubscribe
  push: (path, state?, opts?) => void; // Navigate forward
  replace: (path, state?, opts?) => void; // Replace current entry
  go: (n, opts?) => void; // Move n entries
  back: (opts?) => void; // Go back 1
  forward: (opts?) => void; // Go forward 1
  canGoBack: () => boolean; // Check if back is possible
  createHref: (path) => string; // Build full href from path
  block: (blocker) => () => void; // Navigation blocking
  flush: () => void; // Flush pending history changes
  destroy: () => void; // Cleanup listeners
  notify: (action) => void; // Notify subscribers of change
}

interface HistoryLocation {
  href: string; // Full href
  pathname: string; // Path without search/hash
  search: string; // Query string including ?
  hash: string; // Hash including #
  state: ParsedHistoryState; // History state object
}
```

### Factory Pattern

TanStack uses a generic `createHistory(opts)` that's configured differently:

- `createBrowserHistory()` - Real browser history.pushState/replaceState
- `createMemoryHistory({ initialEntries })` - In-memory for SSR/tests
- `createHashHistory()` - Hash-based routing for static hosts

### Key Implementation Details

1. **State Index Tracking**: Each history entry has `__TSR_index` for position tracking
2. **Throttled Updates**: Browser history changes batched via microtask to prevent excessive calls
3. **Optimistic Updates**: Location updated in memory immediately, browser synced async
4. **Rollback on Block**: If navigation blocked, rollback to previous location
5. **popstate Handling**: Browser back/forward fires popstate, compute delta from index

### Fibrae Adaptation

For Effect-first implementation:

```typescript
// History as Effect service (not class)
class History extends Context.Tag("fibrae/History")<
  History,
  {
    readonly location: Atom.Atom<HistoryLocation>; // Reactive via Atom
    readonly push: (path: string, state?: unknown) => Effect.Effect<void>;
    readonly replace: (path: string, state?: unknown) => Effect.Effect<void>;
    readonly back: Effect.Effect<void>;
    readonly forward: Effect.Effect<void>;
    readonly go: (n: number) => Effect.Effect<void>;
    readonly canGoBack: Effect.Effect<boolean>;
  }
>() {}

// Layers for different environments
const BrowserHistory: Layer.Layer<History>; // Real window.history
const MemoryHistory: (url: string) => Layer.Layer<History>; // SSR/tests
```

---

## Effect HttpApiBuilder (`effect/packages/platform/src/HttpApiBuilder.ts`)

### Core Pattern

Separation of **declaration** (HttpApi/HttpApiGroup/HttpApiEndpoint) from **implementation** (HttpApiBuilder.group).

### Builder.group Signature

```typescript
export const group = <
  ApiId extends string,
  Groups extends HttpApiGroup.HttpApiGroup.Any,
  ApiError,
  ApiR,
  const Name extends HttpApiGroup.HttpApiGroup.Name<Groups>,
  Return
>(
  api: HttpApi.HttpApi<ApiId, Groups, ApiError, ApiR>,
  groupName: Name,
  build: (handlers: Handlers.FromGroup<...>) => Handlers.ValidateReturn<Return>
): Layer.Layer<HttpApiGroup.ApiGroup<ApiId, Name>, ...>
```

### Handlers Interface

```typescript
interface Handlers<E, Provides, R, Endpoints> {
  // Fluent builder - each handle() returns new Handlers with endpoint removed
  handle<Name extends EndpointName<Endpoints>>(
    name: Name,
    handler: HandlerWithName<Endpoints, Name, E, R1>,
    options?: { uninterruptible?: boolean }
  ): Handlers<E, Provides, R | R1, ExcludeName<Endpoints, Name>>

  handleRaw<Name>(name, handler): Handlers<...>  // Full response access
}
```

### Key Implementation Details

1. **Handlers Object Protocol**:

```typescript
const HandlersProto = {
  [HandlersTypeId]: { _Endpoints: identity },
  pipe() { return pipeArguments(this, arguments) },
  handle(name, handler, options) {
    const endpoint = this.group.endpoints[name]
    return makeHandlers({
      group: this.group,
      handlers: Chunk.append(this.handlers, { endpoint, handler, ... })
    })
  }
}
```

2. **Build Function Result Validation**:

```typescript
type ValidateReturn<A> = [_Endpoints] extends [never]
  ? A // All endpoints handled - valid
  : `Endpoint not handled: ${EndpointName<_Endpoints>}`; // Type error shows missing
```

3. **Layer Construction**:

```typescript
Router.use((router) =>
  Effect.gen(function* () {
    const context = yield* Effect.context<any>();
    const group = api.groups[groupName]!;
    const result = build(makeHandlers({ group, handlers: Chunk.empty() }));
    const handlers = Effect.isEffect(result) ? yield* result : result;
    // Register routes on router...
  }),
);
```

### Fibrae Adaptation

Current RouterBuilder follows this pattern but simpler:

- Uses `GroupHandlers` interface with fluent `.handle()`
- Build function takes initial handlers, returns built handlers
- Result is `Layer.Layer<RouterHandlers>` for DI

Future enhancements:

- Add type-level tracking of unhandled routes (like HttpApiBuilder)
- Support middleware/interceptors pattern

---

## Router.ts Pattern (`packages/tanstack-router/packages/router-core/src/router.ts`)

### Router State

```typescript
interface RouterState {
  status: "pending" | "idle";
  matches: RouteMatch[]; // Current matched routes
  pendingMatches?: RouteMatch[]; // During navigation
  location: ParsedLocation;
  resolvedLocation?: ParsedLocation;
  lastUpdated: number;
}
```

### Key Responsibilities

1. **Route Tree Processing**: Parse route definitions into matchable tree
2. **Location Matching**: Match pathname to route(s)
3. **Loader Orchestration**: Load data for matched routes (parallel where possible)
4. **State Management**: Track navigation status, matches, loader data
5. **History Integration**: Subscribe to history, trigger matches on change

---

## Summary: What to Build Next

For `fibrae-26q` (History service):

1. **Location Type**: `{ pathname, search, hash, state, href }`
2. **History Service Tag**: Context.Tag with location Atom + navigation Effects
3. **BrowserHistoryLive Layer**:
   - Subscribe to popstate
   - Wrap history.pushState/replaceState as Effects
   - Update location Atom on changes
4. **MemoryHistoryLive Layer**:
   - In-memory entries array with index
   - For SSR (static) and tests
5. **Integration Points**:
   - Navigator service will depend on History
   - RouterBuilder will subscribe to History.location to trigger route matching
