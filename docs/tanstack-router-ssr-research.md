# TanStack Router SSR/Hydration Research

This document analyzes how TanStack Router handles SSR rendering and client-side hydration without adding wrapper DOM elements.

## Key Finding Summary

TanStack Router avoids wrapper elements by:

1. **Using React's native component model** - Components render directly without synthetic wrappers
2. **Leveraging React Context** for match tracking instead of DOM markers
3. **State-driven rendering** - Route changes update router state, triggering React re-renders through normal reconciliation
4. **SafeFragment** - A simple `<>{props.children}</>` wrapper that adds zero DOM nodes

---

## 1. How Does TanStack Router Render Route Components?

### Match.tsx - The Core Rendering Component

**File:** `packages/tanstack-router/packages/react-router/src/Match.tsx`

```tsx
// The Match component is memoized and receives only a matchId
export const Match = React.memo(function MatchImpl({ matchId }: { matchId: string }) {
  const router = useRouter()
  const matchState = useRouterState({
    select: (s) => {
      const match = s.matches.find((d) => d.id === matchId)
      return {
        routeId: match.routeId,
        ssr: match.ssr,
        _displayPending: match._displayPending,
      }
    },
    structuralSharing: true as any,
  })

  const route = router.routesById[matchState.routeId]

  // Conditionally wrap in boundaries - SafeFragment is a no-op wrapper
  const ResolvedSuspenseBoundary = shouldWrap ? React.Suspense : SafeFragment
  const ResolvedCatchBoundary = routeErrorComponent ? CatchBoundary : SafeFragment
  const ResolvedNotFoundBoundary = routeNotFoundComponent ? CatchNotFound : SafeFragment

  return (
    <matchContext.Provider value={matchId}>
      <ResolvedSuspenseBoundary fallback={pendingElement}>
        <ResolvedCatchBoundary ...>
          <ResolvedNotFoundBoundary ...>
            <MatchInner matchId={matchId} />
          </ResolvedNotFoundBoundary>
        </ResolvedCatchBoundary>
      </ResolvedSuspenseBoundary>
    </matchContext.Provider>
  )
})
```

### MatchInner - Renders the Actual Component

```tsx
export const MatchInner = React.memo(function MatchInnerImpl({ matchId }: { matchId: string }) {
  const router = useRouter()
  const { match, key, routeId } = useRouterState({ ... })
  const route = router.routesById[routeId]

  // Direct component rendering - no wrapper!
  const out = React.useMemo(() => {
    const Comp = route.options.component ?? router.options.defaultComponent
    if (Comp) {
      return <Comp key={key} />  // Component rendered directly
    }
    return <Outlet />
  }, [key, route.options.component, router.options.defaultComponent])

  // Handle various states (pending, error, not-found)
  if (match.status === 'pending') {
    throw router.getMatch(match.id)?._nonReactive.loadPromise
  }
  // ... other status handling

  return out  // Returns component directly, no wrapper
})
```

### SafeFragment - Zero DOM Overhead

**File:** `packages/tanstack-router/packages/react-router/src/SafeFragment.tsx`

```tsx
export function SafeFragment(props: any) {
  return <>{props.children}</>;
}
```

This is used as a conditional wrapper - when no boundary is needed, `SafeFragment` is used instead of `React.Suspense` or error boundaries, adding zero DOM nodes.

### Outlet - Nested Route Rendering

```tsx
export const Outlet = React.memo(function OutletImpl() {
  const router = useRouter();
  const matchId = React.useContext(matchContext); // Get parent match from context

  // Find the next child match
  const childMatchId = useRouterState({
    select: (s) => {
      const matches = s.matches;
      const index = matches.findIndex((d) => d.id === matchId);
      return matches[index + 1]?.id;
    },
  });

  if (!childMatchId) {
    return null;
  }

  return <Match matchId={childMatchId} />; // Render next match directly
});
```

**Key Insight:** The `Outlet` uses React Context (`matchContext`) to track which match is the "current" one, then renders the next match in the chain. No DOM markers needed!

---

## 2. How Does TanStack Router Handle SSR?

### Server-Side Rendering Flow

**File:** `packages/tanstack-router/packages/react-router/src/ssr/RouterServer.tsx`

```tsx
export function RouterServer<TRouter extends AnyRouter>(props: { router: TRouter }) {
  return <RouterProvider router={props.router} />;
}
```

The server renders the exact same component tree as the client. There's no special server-only markup.

### Client-Side Hydration

**File:** `packages/tanstack-router/packages/react-router/src/ssr/RouterClient.tsx`

```tsx
export function RouterClient(props: { router: AnyRouter }) {
  if (!hydrationPromise) {
    if (!props.router.state.matches.length) {
      hydrationPromise = hydrate(props.router);
    } else {
      hydrationPromise = Promise.resolve();
    }
  }
  return (
    <Await promise={hydrationPromise} children={() => <RouterProvider router={props.router} />} />
  );
}
```

### Matches Component - SSR-Aware

**File:** `packages/tanstack-router/packages/react-router/src/Matches.tsx`

```tsx
export function Matches() {
  const router = useRouter();

  // Do not render a root Suspense during SSR or hydrating from SSR
  const ResolvedSuspense =
    router.isServer || (typeof document !== "undefined" && router.ssr)
      ? SafeFragment
      : React.Suspense;

  const inner = (
    <ResolvedSuspense fallback={pendingElement}>
      {!router.isServer && <Transitioner />}
      <MatchesInner />
    </ResolvedSuspense>
  );
  // ...
}
```

**Key SSR Pattern:** During SSR, `SafeFragment` replaces `React.Suspense` to avoid hydration mismatches.

---

## 3. Route Transitions / Re-renders

### Transitioner Component

**File:** `packages/tanstack-router/packages/react-router/src/Transitioner.tsx`

```tsx
export function Transitioner() {
  const router = useRouter();
  const [isTransitioning, setIsTransitioning] = React.useState(false);

  const { hasPendingMatches, isLoading } = useRouterState({
    select: (s) => ({
      isLoading: s.isLoading,
      hasPendingMatches: s.matches.some((d) => d.status === "pending"),
    }),
    structuralSharing: true,
  });

  // Hook into React's transition API
  router.startTransition = (fn: () => void) => {
    setIsTransitioning(true);
    React.startTransition(() => {
      fn();
      setIsTransitioning(false);
    });
  };

  // Subscribe to history changes
  React.useEffect(() => {
    const unsub = router.history.subscribe(router.load);
    return () => unsub();
  }, [router, router.history]);

  return null; // Renders nothing - just manages state!
}
```

**Key Insight:** The `Transitioner` renders **nothing** (`return null`). It's purely a state management component that:

1. Subscribes to history changes
2. Uses `React.startTransition` for smooth updates
3. Emits lifecycle events

### State-Driven Re-renders

When navigating from Route A to Route B:

1. History changes trigger `router.load()`
2. `router.load()` matches new routes and updates `router.state.matches`
3. React components subscribed via `useRouterState()` re-render
4. `Match` components render the new route's component

**No DOM manipulation is needed** - React's reconciliation handles swapping components.

---

## 4. Dehydration/Hydration Strategy

### Dehydrated Data Structure

**File:** `packages/tanstack-router/packages/router-core/src/ssr/types.ts`

```typescript
export interface DehydratedMatch {
  i: string; // Match ID
  b?: unknown; // __beforeLoadContext
  l?: unknown; // loaderData
  e?: unknown; // error
  u: number; // updatedAt
  s: string; // status
  ssr?: boolean; // SSR flag
}

export interface DehydratedRouter {
  manifest: Manifest | undefined;
  dehydratedData?: any;
  lastMatchId?: string;
  matches: Array<DehydratedMatch>;
}
```

### Server-Side Dehydration

**File:** `packages/tanstack-router/packages/router-core/src/ssr/ssr-server.ts`

```typescript
export function dehydrateMatch(match: AnyRouteMatch): DehydratedMatch {
  const dehydratedMatch: DehydratedMatch = {
    i: match.id,
    u: match.updatedAt,
    s: match.status,
  };
  // Only include properties that have values
  if (match.__beforeLoadContext !== undefined) dehydratedMatch.b = match.__beforeLoadContext;
  if (match.loaderData !== undefined) dehydratedMatch.l = match.loaderData;
  // ...
  return dehydratedMatch;
}
```

### Client-Side Hydration

**File:** `packages/tanstack-router/packages/router-core/src/ssr/ssr-client.ts`

```typescript
export async function hydrate(router: AnyRouter): Promise<any> {
  // 1. Read bootstrap data from window.$_TSR
  const { manifest, dehydratedData, lastMatchId } = window.$_TSR.router;

  // 2. Match routes against current location
  const matches = router.matchRoutes(router.state.location);

  // 3. Hydrate each match with server data
  matches.forEach((match) => {
    const dehydratedMatch = window.$_TSR.router.matches.find((d) => d.i === match.id);
    if (dehydratedMatch) {
      hydrateMatch(match, dehydratedMatch);
    }
  });

  // 4. Update router state
  router.__store.setState((s) => ({ ...s, matches }));

  // 5. Call user hydration hook
  await router.options.hydrate?.(dehydratedData);
}

function hydrateMatch(match: AnyRouteMatch, dehydratedMatch: DehydratedMatch): void {
  match.id = dehydratedMatch.i;
  match.__beforeLoadContext = dehydratedMatch.b;
  match.loaderData = dehydratedMatch.l;
  match.status = dehydratedMatch.s;
  match.ssr = dehydratedMatch.ssr;
  match.updatedAt = dehydratedMatch.u;
  match.error = dehydratedMatch.e;
}
```

### Bootstrap Script

**File:** `packages/tanstack-router/packages/router-core/src/ssr/tsrScript.ts`

```javascript
self.$_TSR = {
  h() {
    this.hydrated = true;
    this.c();
  }, // Signal hydration complete
  e() {
    this.streamEnded = true;
    this.c();
  }, // Signal stream ended
  c() {
    if (this.hydrated && this.streamEnded) {
      delete self.$_TSR;
      delete self.$R["tsr"];
    }
  },
  p(script) {
    !this.initialized ? this.buffer.push(script) : script();
  },
  buffer: [],
};
```

### Stream Transformation

**File:** `packages/tanstack-router/packages/router-core/src/ssr/transformStreamWithRouter.ts`

The router injects serialized state **at the end of HTML** (before `</body>`), not inline with components:

```typescript
// Simplified flow:
function transformStreamWithRouter(router, appStream) {
  // 1. Stream through HTML chunks
  // 2. Find </body> tag
  // 3. Insert router state scripts BEFORE </body>
  // 4. Continue streaming closing tags
}
```

---

## 5. Patterns for Fibrae

### What We Can Adopt

1. **State-Driven Rendering**
   - Route changes update a central store
   - Components subscribe to relevant state slices
   - React/Fibrae reconciliation handles DOM updates

2. **Context for Match Tracking**

   ```tsx
   const matchContext = React.createContext<string | undefined>(undefined);
   ```

   Instead of DOM markers, use context to track the current position in the match tree.

3. **Conditional Boundary Wrapping**

   ```tsx
   const Wrapper = needsBoundary ? SuspenseBoundary : Fragment;
   return <Wrapper>{children}</Wrapper>;
   ```

4. **SSR-Aware Component Selection**

   ```tsx
   const ResolvedSuspense = isServer ? SafeFragment : Suspense;
   ```

5. **Deferred State Injection**
   - Serialize state to `<script>` tags injected at stream end
   - Client reads from `window.__DIDACT__` during hydration
   - No inline markers needed

### Key Differences from Our Current Approach

| Our Approach                               | TanStack Approach                           |
| ------------------------------------------ | ------------------------------------------- |
| `<span style="display:contents">` wrappers | No wrappers - direct component rendering    |
| DOM markers for re-render locations        | React Context for position tracking         |
| Wrapper provides stable DOM reference      | Component identity (key) provides stability |
| SSR produces wrapper elements              | SSR produces identical markup to client     |

### Migration Path for Fibrae

1. **Remove wrapper spans from function component rendering**
   - Use component identity/keys for reconciliation instead

2. **Use Effect atoms for position tracking**
   - Instead of DOM markers, track component positions in Effect state

3. **Separate concerns**
   - `Match` - handles boundaries, suspense, error catching
   - `MatchInner` - renders the actual component
   - `Outlet` - finds and renders child matches

4. **Stream transformation for SSR**
   - Inject state scripts at document end, not inline
   - Use marker script IDs for coordination

---

## Conclusion

TanStack Router achieves wrapper-free SSR/hydration by:

1. **Not needing wrappers at all** - React's component model with `key` props handles identity
2. **Context over DOM** - Match tracking uses React Context, not DOM traversal
3. **State over markers** - Router state drives rendering, not DOM manipulation
4. **Stream injection** - Dehydrated state goes at document end, not inline

For Fibrae, the key insight is that **stable DOM locations for re-renders** can be achieved through:

- Unique component keys
- Effect-based state management
- Virtual DOM reconciliation

Rather than synthetic wrapper elements.
