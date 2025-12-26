# Fibrae Router & Framework Features Plan

## Overview

This document captures research and planning for adding TanStack Router/Start-inspired routing and framework features to Fibrae. The goal is an **Effect-first router** that integrates naturally with Fibrae's reactive model.

## Design Decisions (Confirmed)

1. **Part of core package** - Router lives in `packages/fibrae/`, not a separate package
2. **No `use*` hooks** - Just Effect functions accessing router via Effect context
3. **Loaders via Effect DI** - Same loader code, different service implementations injected on server vs browser (or isomorphic)
4. **Code-based routing for MVP** - File-based routing is future phase
5. **SSR integration required** - Must work with existing `renderToString()`/hydration
6. **Borrow from Effect HTTP router** - Use patterns from `@effect/platform` HttpRouter and `@typed/router`

---

## Current Fibrae State

### Core Features (Already Implemented)

- **Effect-first JSX renderer**: Components are Effect programs
- **Atoms for reactive state**: Fine-grained reactivity via `@effect-atom/atom`
- **SSR with hydration**: `renderToString()` server-side, `render()` with hydration client-side
- **Suspense boundaries**: Async content with fallbacks, SSR timeout handling
- **ErrorBoundary**: Catch component/stream failures
- **Stream-based components**: Components can return `Stream<VElement>` for reactive updates

### Key Files

- `packages/fibrae/src/core.ts` - Main render() entry point
- `packages/fibrae/src/server.ts` - SSR renderToString()
- `packages/fibrae/src/hydration.ts` - Client-side hydration
- `packages/fibrae/src/runtime.ts` - FibraeRuntime service
- `packages/demo/server/index.ts` - Example Effect HTTP SSR server

---

## Effect HTTP Router Patterns (from @effect/platform & @typed/router)

### 1. HttpRouter API (server-side)

```typescript
import { HttpRouter, HttpServerResponse } from "@effect/platform";

// Empty starting point + chainable methods
const router = HttpRouter.empty.pipe(
  HttpRouter.get("/posts/:id", postHandler),
  HttpRouter.post("/posts", createHandler),
  HttpRouter.use(HttpMiddleware.logger),
);
```

### 2. Route as Data (@typed/route)

```typescript
import * as Route from "@typed/route";

// Routes are immutable data with match/interpolate
const postRoute = Route.parse("/posts/:id");
postRoute.match("/posts/123"); // => Option.some({ id: "123" })
postRoute.interpolate({ id: "123" }); // => "/posts/123"

// Path param syntax:
// :paramName   - Required
// :paramName?  - Optional
// :paramName*  - Zero or more (array)
// :paramName+  - One or more (array)
```

### 3. Schema-Validated Params

```typescript
const userRoute = Route.integer("id"); // { id: number }
const uuidRoute = Route.uuid("userId"); // { userId: Uuid }
const customRoute = Route.paramWithSchema("id", Schema.NumberFromString);
```

### 4. RouteGuard Pattern (Effect-based matching)

```typescript
interface RouteGuard<Route, Success, Error, Context> {
  readonly route: Route;
  readonly guard: Guard<string, Success, Error, Context>;
}

// Matching returns Effect<Option<Params>>
const guard = RouteGuard.fromRoute(Route.parse("/posts/:id"));
guard.guard("/posts/123"); // => Effect.succeed(Option.some({ id: "123" }))

// Chain with map, filter, flatMap for data loading
const enrichedGuard = RouteGuard.mapEffect(guard, (params) =>
  Effect.gen(function* () {
    const db = yield* Database;
    return yield* db.getPost(params.id);
  }),
);
```

### 5. CurrentRoute Context

```typescript
interface CurrentRoute {
  readonly route: Route.Any;
  readonly parent: Option<CurrentRoute>; // Nested routing
}

// Reactive values that update on navigation
const CurrentParams: RefSubject.Filtered<Record<string, string>>;
const CurrentSearchParams: RefSubject.Computed<URLSearchParams>;
```

### 6. RouteMatcher for Client-Side (Fx-based)

```typescript
const router = Matcher.empty
  .match(Route.parse("/"), (ref) => Fx.map(ref, () => <HomePage />))
  .match(Route.parse("/posts/:id"), (ref) =>
    Fx.switchMap(ref, ({ id }) => <PostPage postId={id} />))
  .notFound(() => <NotFoundPage />)
```

### Key Takeaways

- **Routes are values** with `match()` and `interpolate()` methods
- **Composable** - concat, mount at prefix, transform
- **Guards return Effects** - async validation, context access
- **CurrentRoute context** - relative navigation, active detection
- **Reactive** - params/search update automatically on navigation

---

## TanStack Router/Start Architecture Summary

### Package Structure

```
router-core/          # Framework-agnostic core (routing logic, matching, state)
history/              # Browser history abstraction
react-router/         # React bindings (hooks, components)
router-generator/     # File-based route generation
start-client-core/    # Framework client features (server functions, hydration)
start-server-core/    # Server handler, request/response utilities
```

### Key Concepts

#### 1. Router Core (`router-core/src/router.ts`)

- `RouterCore` class manages routing state via `@tanstack/store`
- Maintains route tree, current matches, pending navigation
- History integration via `@tanstack/history`
- Type-safe route definitions with path params, search params

#### 2. Route Definition (`router-core/src/route.ts`)

```typescript
// Route options include:
- path: string              // URL path with param syntax ($id, $)
- component: Component      // What to render
- loader: LoaderFn          // Data loading (isomorphic - runs on server AND client)
- beforeLoad: BeforeLoadFn  // Pre-navigation logic, context building
- validateSearch: Validator // Type-safe search param validation
- parseParams/stringifyParams  // Type-safe path param handling
```

#### 3. File-Based Routing (`router-generator/src/generator.ts`)

File naming conventions:

- `__root.tsx` - Root route (always rendered, contains `<Outlet>`)
- `index.tsx` - Index route at `/`
- `posts.tsx` - Layout route at `/posts` (renders `<Outlet>` for children)
- `posts.$postId.tsx` - Dynamic route at `/posts/:postId`
- `_auth/` prefix - Pathless layout (groups routes without URL segment)
- `posts_.edit.tsx` - Non-nested route (breaks out of parent layout)

#### 4. Nested Layouts

Routes form a tree. Each route's component renders, with `<Outlet>` showing child content:

```
URL: /posts/123
Renders: <Root><Posts><Post /></Posts></Root>
```

#### 5. Data Loading (`router-core/src/load-matches.ts`)

- Loaders are **isomorphic** (run on both server and client)
- Run in parallel for matched route chain
- Support `beforeLoad` for sequential context building
- Cached with configurable staleness

#### 6. History (`history/src/index.ts`)

```typescript
interface RouterHistory {
  location: HistoryLocation;
  push(path, state): void;
  replace(path, state): void;
  go(n): void;
  back(): void;
  forward(): void;
  subscribe(cb): unsubscribe;
  block(blocker): unblock;
}
```

#### 7. Server Functions (`start-client-core/src/createServerFn.ts`)

```typescript
const getUser = createServerFn({ method: "GET" })
  .inputValidator(schema)
  .handler(async ({ data }) => {
    // Runs only on server, client makes RPC call
    return await db.users.find(data.id);
  });
```

#### 8. Execution Model (`start/guide/execution-model.md`)

- **Isomorphic by default**: Code runs on both server and client
- **Server-only**: `createServerFn()` (RPC), `createServerOnlyFn()` (throws on client)
- **Client-only**: `createClientOnlyFn()`, `<ClientOnly>` component
- **Environment-specific**: `createIsomorphicFn().server().client()`

#### 9. SSR Integration (`router-core/src/ssr/ssr-server.ts`)

- Dehydrates router state (matches, loader data, context)
- Streams data to client via script injection
- Uses seroval for serialization
- Client rehydrates from `window.__TSR__` data

---

## MVP Fibrae Router Design

### Core Principles

1. **No hooks** - Effect functions only, access via Effect context
2. **Mirror Effect HttpApi pattern** - Separate route declaration from handler implementation
3. **Schema-validated params** - Template literal syntax with `Route.param()` like HttpApiSchema
4. **Effect DI for loaders** - Inject different implementations on server/client
5. **Atom-based reactivity** - Router state in Atoms for automatic UI updates
6. **Loader/component split** - Components are `f(data)`, loaders handle fetching (enables SSR hydration)

### API Design (Mirrors @effect/platform HttpApi)

```typescript
import { Effect, Layer } from "effect"
import { Route, Router, RouterBuilder } from "fibrae"
import { Schema as S } from "effect"

const idParam = Route.param("id", S.NumberFromString)

// ============================================
// 1. Define routes with schemas (pure declarations)
// ============================================

export const AppRoutes = Router.group("app")
  .add(
    Route.get("home", "/")
  )
  .add(
    Route.get("posts", "/posts")
      .setSearchParams(
        S.partial(S.Struct({
          sort: S.Union(S.Literal("date"), S.Literal("popular")),
          page: S.NumberFromString
        }))
      )
  )
  .add(
    // Template literal syntax for path params (like HttpApiEndpoint)
    Route.get("post")`/posts/${idParam}`
  )
  .add(
    Route.get("postComments")`/posts/${idParam}/comments`
  )

// ============================================
// 2. Create the router from groups
// ============================================

export const AppRouter = Router.make("AppRouter").add(AppRoutes)

// ============================================
// 3. Implement handlers (separate from route definitions)
// ============================================

export const AppRoutesLive = RouterBuilder.group(
  AppRouter,
  "app",
  (handlers) =>
    Effect.gen(function* () {
      const Posts = yield* PostsService

      return handlers
        .handle("home", {
          loader: () => Effect.succeed({ featured: [] }),
          component: ({ loaderData }) => <HomePage featured={loaderData.featured} />
        })

        .handle("posts", {
          loader: ({ searchParams }) =>
            Posts.list({ sort: searchParams.sort, page: searchParams.page }),
          component: ({ loaderData }) => <PostsPage posts={loaderData} />
        })

        .handle("post", {
          loader: ({ path: { id } }) => Posts.getById(id),
          component: ({ loaderData }) => <PostPage post={loaderData} />
        })

        .handle("postComments", {
          loader: ({ path: { id } }) => Posts.getComments(id),
          component: ({ loaderData, outlet }) => <CommentsPage comments={loaderData} />
        })
    })
)

// ============================================
// 4. Build the live router layer
// ============================================

export const AppRouterLive = RouterBuilder.router(AppRouter).pipe(
  Layer.provide(AppRoutesLive),
  Layer.provide(PostsService.Default)
)
```

### Comparison with Effect HttpApi

| HttpApi (Server)                                     | Fibrae Router (Client)                                  |
| ---------------------------------------------------- | ------------------------------------------------------- |
| `HttpApiEndpoint.get("name", "/path")`               | `Route.get("name", "/path")`                            |
| `HttpApiEndpoint.get("name")`\`/path/${param}\``     | `Route.get("name")`\`/path/${param}\``                  |
| `HttpApiSchema.param("id", Schema)`                  | `Route.param("id", Schema)`                             |
| `.setUrlParams(schema)`                              | `.setSearchParams(schema)`                              |
| `HttpApiGroup.make("name")`                          | `Router.group("name")`                                  |
| `HttpApi.make("name")`                               | `Router.make("name")`                                   |
| `HttpApiBuilder.group(api, "name", handlers => ...)` | `RouterBuilder.group(router, "name", handlers => ...)`  |
| `handlers.handle("endpoint", ({ path }) => ...)`     | `handlers.handle("route", { loader, component })`       |
| `HttpApiBuilder.api(Api).pipe(Layer.provide(...))`   | `RouterBuilder.router(Router).pipe(Layer.provide(...))` |

### Navigation (Type-Safe by Route Name)

```typescript
// Access navigator from Effect context
const nav = yield* Router.Navigator

// Type-safe navigation by route name
yield* nav.go("post", { path: { id: 123 } })
yield* nav.go("posts", { searchParams: { sort: "popular", page: 2 } })
yield* nav.back
yield* nav.forward

// Link component
<Link to="post" params={{ id: 123 }}>View Post</Link>
<Link to="posts" search={{ sort: "date" }}>All Posts</Link>

// Check if route is active
const isActive = nav.isActive("post", { path: { id: 123 } })
```

### Handler Props Interface

```typescript
interface HandlerConfig<TPath, TSearch, TLoaderData> {
  // Loader: Effect that fetches data
  // - Runs on server during SSR
  // - Runs on client during navigation (or hydrates from SSR state)
  loader: (ctx: {
    path: TPath; // Decoded path params
    searchParams: TSearch; // Decoded search params
  }) => Effect.Effect<TLoaderData, Error, Services>;

  // Component: Pure function of data (NOT an Effect)
  component: (props: {
    loaderData: TLoaderData; // Result from loader
    path: TPath; // Path params (for display/links)
    searchParams: TSearch; // Search params
    outlet: VElement | null; // Child route content (future)
  }) => VElement;
}
```

### SSR Integration

```typescript
// Server: Match route, run loader, render
const serverHandler = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest
  const url = new URL(request.url)

  // Router layer for this request
  const routerLayer = Router.serverLayer({
    router: AppRouter,
    pathname: url.pathname,
    search: url.search
  })

  // Render with router - loader runs, component renders
  const { html, dehydratedState } = yield* renderToString(<App />).pipe(
    Effect.provide(routerLayer),
    Effect.provide(AppRouterLive)
  )

  // dehydratedState includes: { route, path, searchParams, loaderData }
  return HttpServerResponse.html(buildPage(html, dehydratedState))
})

// Client: Hydrate from server state
const clientHydrate = Effect.gen(function* () {
  const serverState = window.__DIDACT_ROUTER__

  // Browser layer - first render uses server's loaderData (no fetch)
  const routerLayer = Router.browserLayer({
    router: AppRouter,
    initialState: serverState  // Hydrate loader data
  })

  yield* hydrate(<App />, root).pipe(
    Effect.provide(routerLayer),
    Effect.provide(AppRouterLive)
  )
})

// Subsequent navigations run loader fresh
```

### File Structure (in packages/fibrae/src/)

```
router/
  Route.ts           # Route.get, Route.param, template literal parsing
  Router.ts          # Router.make, Router.group
  RouterBuilder.ts   # RouterBuilder.group, RouterBuilder.router
  Navigator.ts       # Navigator service, navigation Effects
  Link.tsx           # Link component
  index.ts           # Public exports
```

---

## MVP Scope

### In Scope

1. **Route definition** - `Route.get("name")`\`/path/${param}\`` with Schema-validated params
2. **Route groups** - `Router.group("name").add(...)` for organization
3. **Router** - `Router.make("name").add(group)` to compose groups
4. **Handler implementation** - `RouterBuilder.group(router, "name", handlers => ...)`
5. **Loader/component split** - Loaders fetch data, components render (enables SSR hydration)
6. **Link component** - Type-safe navigation by route name
7. **Navigator service** - `nav.go("route", { path, searchParams })`, `nav.back`, `nav.forward`
8. **SSR support** - Server-side matching, loader execution, dehydration/hydration
9. **Browser history** - Push/replace/back/forward integration

### Out of Scope (Future Phases)

- **Nested routes / layouts** - Deferred (flat routes only for MVP)
- **Loader caching** - Deferred (always re-run loaders on navigation)
- **`<Outlet />` component** - Deferred (use `outlet` prop when nested routes added)
- **Actions / mutations** - Form submissions, data modifications (POST/PUT/DELETE).
  Design considerations for future:
  - Actions in handler config: `actions: { delete: ..., update: ... }`
  - Or separate route methods: `Route.post`, `Route.delete`
  - After-action behavior: redirect, revalidate loader, or return data
  - Progressive enhancement for forms (work without JS)
- **File-based routing** - Vite plugin, future phase
- **Server functions / RPC** - Future phase
- **Scroll restoration** - Can add later
- **Route preloading** - Future optimization
- **Route guards / beforeLoad** - Future phase

---

## Open Questions (Remaining)

1. **Pending UI** - How to show loading state during navigation?
   - MVP: `isNavigating` Atom in Navigator service
   - Integrate with Suspense for loader Effects

2. **Error handling** - Loader failures surface to ErrorBoundary, or per-route error component?
   - MVP: Use existing ErrorBoundary

3. **History state** - Do we need to support arbitrary state in push/replace?
   - MVP: Support it but don't require it

---

## References

- TanStack Router source: `packages/tanstack-router/`
- TanStack Router docs: https://tanstack.com/router
- TanStack Start docs: https://tanstack.com/start
- Fibrae SSR design: `docs/ssr-hydration-design.md`
- Typed SSR patterns: `docs/typed-ssr-apis.md`
