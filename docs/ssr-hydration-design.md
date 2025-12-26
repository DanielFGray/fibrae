# SSR + Hydration Design

## Goal

Classic SSR with hydration:
1. **Server:** Render component tree to HTML string (fast first paint)
2. **Client:** Receive HTML, hydrate (attach event handlers, enable reactivity)
3. **Result:** Same component code works on both server and client

**Not implementing:** React Server Components style with persistent server connections or stream continuation.

---

## React's Approach (Reference)

### DOM Matching: Structure, Not IDs

React walks DOM and virtual tree in parallel:
- `getFirstHydratableChild()` - get first element/text child
- `getNextHydratableSibling()` - get next sibling  
- `canHydrateInstance()` - compare `nodeName.toLowerCase()`

**Key insight:** No `data-*` attributes needed. Tree structure must be identical.

### Suspense Boundaries: Comment Markers

React uses comment nodes to mark boundaries:
```html
<!--$-->   resolved content here   <!--/$-->
<!--$?-->  pending (streaming)     <!--/$-->
<!--$!-->  showing fallback        <!--/$-->
```

These let hydration:
- Find boundaries in existing DOM
- Know their state (resolved, pending, fallback)
- Swap content when streaming completes

### Streaming SSR

When Suspense boundary isn't ready:
1. Server emits fallback with `<!--$?-->` marker
2. Server continues rendering rest of page
3. When async resolves, server streams `<script>` that:
   - Contains real content in hidden template
   - Calls `$RC()` to swap fallback → content
4. Client hydration adopts resolved content or waits for stream

### Hydration Mismatch

When server HTML doesn't match client render:
- React logs warning with diff
- Falls back to client-side render for that subtree
- Doesn't crash the whole app

### State Serialization

React doesn't handle this - left to libraries:
```javascript
// Redux pattern
window.__PRELOADED_STATE__ = { counter: 5, todos: [...] };

// React Query pattern  
<script>window.__REACT_QUERY__ = ${dehydrate(queryClient)}</script>
```

---

## Lumon's Approach

### Philosophy

- **Same components everywhere** - no separate SSR variants
- **Atoms are the state** - serialize atom values, not arbitrary state
- **Streams restart on client** - no server continuation (simpler)
- **Structure-based matching** - like React, walk trees in parallel

### Component Return Types in SSR

| Return Type | SSR Behavior |
|-------------|--------------|
| `VElement` | Render directly |
| `Effect<VElement>` | Await effect, render result |
| `Stream<VElement>` | Wait for first emission, render it |
| `Stream` in Suspense | Wait up to threshold, then fallback |

### Atom Handling

**Server:**
1. Provide read-only AtomRegistry with initial values
2. Track which atoms are accessed during render
3. Serialize accessed atoms to manifest

**Client:**
1. Parse manifest before hydration
2. Initialize AtomRegistry with SSR values
3. Hydrate (atoms already have correct values)
4. After hydration, atoms are fully reactive

```html
<!-- Server output -->
<div id="root">...SSR content...</div>
<script id="__LUMON_STATE__" type="application/json">
{"atoms":{"counter:a":0,"counter:b":5,"todos":["item1","item2"]}}
</script>
```

### Suspense Boundaries

Use comment markers like React:

```html
<!-- Resolved during SSR -->
<!--lumon:sus:resolved-->
<div>actual content</div>
<!--/lumon:sus-->

<!-- Fallback shown (timed out or pending) -->
<!--lumon:sus:fallback-->
<div>Loading...</div>
<!--/lumon:sus-->
```

Client hydration:
- `resolved` → adopt content, attach handlers
- `fallback` → show fallback, subscribe to stream, swap when ready

### Stream Behavior

**Streams restart on client, they don't continue from server.**

Why:
- Simpler (no Bridge HTTP endpoints, no connection management)
- Matches most use cases (data fetching, not live streams)
- For truly live data, use WebSockets directly (out of scope)

Example:
```typescript
const UserData = () => Stream.fromEffect(fetchUser()).pipe(
  Stream.map(user => <div>{user.name}</div>)
);

// SSR: waits for fetchUser(), renders result
// Client: hydrates with SSR content, then re-fetches (or uses cached atom)
```

For expensive fetches, use Atoms to cache:
```typescript
const userAtom = Atom.make<User | null>(null);

const UserData = () => Effect.gen(function*() {
  const user = yield* Atom.get(userAtom);
  if (!user) return <div>Loading...</div>;
  return <div>{user.name}</div>;
});

// SSR: Atom populated before render, serialized to manifest
// Client: Atom hydrated from manifest, no re-fetch needed
```

---

## API Design

### Server

```typescript
import { renderToString } from "lumon/server";

// Render to HTML with state manifest
const { html, stateScript, dehydratedState } = yield* renderToString(h(App));

// Full page
const page = `
<!DOCTYPE html>
<html>
  <body>
    <div id="root">${html}</div>
    ${stateScript}
    <script src="/client.js"></script>
  </body>
</html>
`;
```

**Note:** `renderToString` always returns the full result including dehydrated state.
Callers who don't need state simply ignore the `stateScript` and `dehydratedState` fields.
Atoms must use `Atom.serializable({ key, schema })` to be included in the state manifest.

### Client

```typescript
import { hydrate } from "lumon";

// Hydrate existing SSR content
const container = document.getElementById("root")!;
Effect.runFork(hydrate(h(App), container));

// vs render (for non-SSR, creates fresh DOM)
Effect.runFork(render(h(App), container));
```

### Detecting Environment

```typescript
import { RenderEnv } from "lumon";

const MyComponent = () => Effect.gen(function*() {
  const env = yield* RenderEnv;
  
  if (env === "server") {
    // SSR-specific logic
  } else {
    // Client-specific logic (env === "browser")
  }
  
  return <div>...</div>;
});
```

---

## Implementation Phases

### Phase 1: AtomRegistry for SSR

1. Create `SSRAtomRegistry` - read-only, tracks accessed atoms
2. Provide it during SSR render
3. After render, extract `{ atomId → value }` map
4. Serialize to `<script id="__LUMON_STATE__">`

### Phase 2: State Manifest

1. Define manifest schema: `{ atoms: Record<string, unknown> }`
2. `renderToStringWithState()` returns `{ html, stateScript }`
3. Client-side `parseStateManifest()` reads from DOM

### Phase 3: `hydrate()` Function

1. New export alongside `render()`
2. Parse state manifest, initialize atoms
3. Walk DOM + VElement tree in parallel
4. For each node:
   - Element: verify tag matches, adopt node, attach event handlers
   - Text: verify content matches (or update), adopt
   - Component: invoke, recurse into children
5. On mismatch: warn, create fresh DOM for subtree

### Phase 4: Suspense in SSR

1. Add comment markers around Suspense boundaries
2. Track resolved vs fallback state
3. Client hydration handles both cases
4. For fallback: subscribe to stream, swap when ready

### Phase 5: Stream Handling

1. SSR waits for first emission (configurable timeout)
2. Emit with `resolved` or `fallback` marker
3. Client resubscribes to stream (fresh start)

---

## Testing Strategy

### Unit Tests (bun test)

- `SSRAtomRegistry` tracks accessed atoms
- State manifest serialization/parsing
- Suspense marker generation

### E2E Tests (Cypress)

1. **Counter hydration**
   - SSR renders `Count: 0`
   - Hydrate, click +, shows `Count: 1`
   - No flash of different content

2. **Todo list hydration**
   - SSR renders empty list
   - Hydrate, add item, works
   - State persists correctly

3. **Suspense with resolved data**
   - SSR renders actual content (not fallback)
   - Hydrate, content already visible
   - Interactions work

4. **Suspense with fallback**
   - SSR times out, renders fallback
   - Hydrate, shows fallback
   - Stream emits, swaps to content

5. **Hydration mismatch recovery**
   - Intentionally mismatched server/client
   - Warning logged
   - App still works (client re-renders subtree)

---

## Open Questions

1. **Atom key generation** - How to get stable keys for `Atom.family` instances?
   - Option A: Use the family parameter as key (e.g., `"counter:a"`)
   - Option B: Require explicit keys on atoms

2. **Nested Suspense** - How do markers work with nested boundaries?
   - Probably: each boundary has its own markers, nesting is natural

3. **Error boundaries in SSR** - Should they catch and render fallback, or propagate?
   - Probably: catch and render fallback, serialize error state

4. **Streaming SSR** - Should we support `renderToPipeableStream` style?
   - Defer for now, start with `renderToString`

---

## Non-Goals

- React Server Components (persistent connections, server actions)
- Stream continuation from server to client
- Partial hydration / islands architecture
- Client-side routing
