# fibrae

Effect-native JSX renderer with automatic reactivity, type-safe routing, SSR, and live server-sent data.

## Installation

```bash
npm install fibrae @effect-atom/atom effect
```

Configure TypeScript for JSX:

```json
// tsconfig.json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "fibrae"
  }
}
```

## Components

Components are functions that return one of three types:

| Return type        | Use case                                          |
| ------------------ | ------------------------------------------------- |
| `VElement`         | Static markup, no async work or services needed   |
| `Effect<VElement>` | Async data, service access, atom reads            |
| `Stream<VElement>` | Live-updating UI that re-renders on each emission |

```tsx
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Schedule from "effect/Schedule";
import { Atom, AtomRegistry } from "fibrae";

// Static component -- returns VElement directly
const Header = () => <h1>Hello</h1>;

// Effect component -- can yield services and read atoms
const Counter = () =>
  Effect.gen(function* () {
    const registry = yield* AtomRegistry.AtomRegistry;
    const count = yield* Atom.get(countAtom);
    return <button onClick={() => registry.update(countAtom, (n) => n + 1)}>Count: {count}</button>;
  });

// Stream component -- emits new VElements over time
const Clock = () =>
  Stream.fromSchedule(Schedule.spaced("1 second")).pipe(
    Stream.scan(0, (n) => n + 1),
    Stream.map((seconds) => <span>Uptime: {seconds}s</span>),
  );
```

Effect and Stream components automatically re-render when accessed atoms change.

## State (Atoms)

State is managed through atoms from `@effect-atom/atom`.

```tsx
import { Atom, AtomRegistry } from "fibrae";

const countAtom = Atom.make(0);
```

| API                                        | Description                                                           |
| ------------------------------------------ | --------------------------------------------------------------------- |
| `Atom.make(initial)`                       | Create an atom with an initial value                                  |
| `Atom.get(atom)`                           | Read value inside an Effect (subscribes component to changes)         |
| `registry.get(atom)`                       | Read value synchronously (e.g. in event handlers)                     |
| `registry.set(atom, value)`                | Set a new value                                                       |
| `registry.update(atom, fn)`                | Update with a function `(current) => next`                            |
| `registry.modify(atom, fn)`                | Update and return a derived value `(current) => [result, next]`       |
| `Atom.family(fn)`                          | Create parameterized atoms -- `fn(key)` returns a unique atom per key |
| `Atom.serializable(atom, { key, schema })` | Mark atom for SSR state transfer                                      |

### Reading and Writing State

Inside Effect components, use `Atom.get` to read atoms. This subscribes the component to changes -- when the atom's value changes, the component automatically re-renders.

For writes, obtain the `AtomRegistry` service and call `set` or `update`:

```tsx
const TodoList = () =>
  Effect.gen(function* () {
    const registry = yield* AtomRegistry.AtomRegistry;
    const todos = yield* Atom.get(todosAtom);
    return (
      <ul>
        {todos.map((t) => (
          <li>{t}</li>
        ))}
        <button onClick={() => registry.update(todosAtom, (ts) => [...ts, "New"])}>Add</button>
      </ul>
    );
  });
```

### Serializable Atoms

Atoms marked with `Atom.serializable` are included in SSR dehydration and automatically restored during client hydration:

```tsx
import * as Schema from "effect/Schema";

const themeAtom = Atom.make<"light" | "dark">("light").pipe(
  Atom.serializable({ key: "app-theme", schema: Schema.Literal("light", "dark") }),
);
```

## ComponentScope

Effect components can access their lifecycle via the `ComponentScope` service. It provides:

- `scope` -- an Effect `Scope` for registering cleanup logic that runs on unmount
- `mounted` -- a `Deferred<void>` that resolves after the component's DOM subtree is committed

```tsx
import * as Effect from "effect/Effect";
import * as Scope from "effect/Scope";
import * as Deferred from "effect/Deferred";
import { ComponentScope } from "fibrae";
import { pipe } from "effect/Function";

const JsonEditor = () =>
  Effect.gen(function* () {
    const { scope, mounted } = yield* ComponentScope;
    const containerRef = { current: null as HTMLDivElement | null };

    // Fork a fiber that waits for mount, then initializes a third-party library
    yield* pipe(
      Effect.gen(function* () {
        yield* Deferred.await(mounted);
        const editor = monaco.create(containerRef.current!);
        yield* Scope.addFinalizer(
          scope,
          Effect.sync(() => editor.dispose()),
        );
      }),
      Effect.forkScoped,
      Scope.extend(scope),
    );

    return <div ref={(el) => (containerRef.current = el)} />;
  });
```

For simple cleanup without waiting for mount:

```tsx
const Tracker = () =>
  Effect.gen(function* () {
    const { scope } = yield* ComponentScope;
    yield* Scope.addFinalizer(
      scope,
      Effect.sync(() => analytics.cleanup()),
    );
    return <div>Tracking active</div>;
  });
```

## Event Handlers

Event handler props (`onClick`, `onSubmit`, etc.) can return Effect values. When they do, the Effect is automatically forked with the full application context -- including all services provided to `render()`.

```tsx
// Plain event handler
const Button1 = () => <button onClick={() => console.log("clicked")}>Plain</button>;

// Effect event handler -- forked automatically
const Button2 = () => <button onClick={() => Effect.log("clicked via Effect")}>Effectful</button>;

// Access services in event handlers
const LogoutButton = () =>
  Effect.gen(function* () {
    const auth = yield* AuthService;
    return <button onClick={() => auth.logout()}>Log out</button>;
  });
```

If an Effect event handler fails, the error is wrapped in `EventHandlerError` and caught by the nearest `ErrorBoundary`.

## Routing

The router is available via `fibrae/router`. It follows the Effect HttpApi pattern: declare routes, organize into groups, then implement handlers separately.

```tsx
import { Route, Router, RouterBuilder, Link, RouterOutlet } from "fibrae/router";
import { Navigator, NavigatorLive, BrowserHistoryLive } from "fibrae/router";
```

### Declaring Routes

```tsx
import * as Schema from "effect/Schema";

// Static path
const homeRoute = Route.get("home", "/");

// Dynamic path with schema-validated parameters (template literal syntax)
const postRoute = Route.get("post")`/posts/${Route.param("id", Schema.NumberFromString)}`;

// Query parameters
const searchRoute = Route.get("search", "/search").setSearchParams(
  Schema.Struct({ q: Schema.String, page: Schema.optional(Schema.NumberFromString) }),
);
```

### Organizing Routes

Routes are organized into groups, then groups are added to a router:

```tsx
// Simple group
const appRouter = Router.make("app").add(Router.group("main").add(homeRoute).add(postRoute));

// Layout group -- wraps child routes with a layout component
// Child routes are matched relative to the basePath
const appRouter = Router.make("app")
  .add(Router.group("public").add(homeRoute))
  .add(
    Router.layout("dashboard", "/dashboard")
      .add(Route.get("overview", "/overview")) // matches /dashboard/overview
      .add(Route.get("settings", "/settings")), // matches /dashboard/settings
  );
```

### Implementing Handlers

Use `RouterBuilder.group` for regular groups and `RouterBuilder.layoutGroup` for layout groups:

```tsx
const MainRoutesLive = RouterBuilder.group(appRouter, "main", (handlers) =>
  handlers
    .handle("home", {
      component: () => <h1>Home</h1>,
      head: () => ({ title: "Home" }),
    })
    .handle("post", {
      loader: ({ path }) => fetchPost(path.id), // plain value or Effect
      component: ({ loaderData }) => <PostPage post={loaderData} />,
      head: ({ loaderData }) => ({ title: loaderData.title }),
    }),
);

const DashboardRoutesLive = RouterBuilder.layoutGroup(appRouter, "dashboard", (handlers) =>
  handlers
    .layout(() => (
      <div class="dashboard">
        <Sidebar />
        <RouterOutlet />
      </div>
    ))
    .handle("overview", { component: () => <Overview /> })
    .handle("settings", { component: () => <Settings /> }),
);
```

Handler config options:

| Field            | Type                                         | Description                                                    |
| ---------------- | -------------------------------------------- | -------------------------------------------------------------- |
| `component`      | `(props) => VElement`                        | Required. Receives `{ loaderData, path, searchParams }`        |
| `loader`         | `(ctx) => T \| Effect<T>`                    | Optional. Runs before component, result passed as `loaderData` |
| `head`           | `(ctx) => HeadData \| Effect<HeadData>`      | Optional. Per-route `<head>` metadata                          |
| `prerender`      | `boolean`                                    | Optional. Mark route for static pre-rendering                  |
| `getStaticPaths` | `() => PathParams[] \| Effect<PathParams[]>` | Optional. Enumerate params for prerender                       |

### Link Component

`Link` takes a real path via the `href` prop — just import and use:

```tsx
import { Link } from "fibrae/router";

<Link href="/">Home</Link>
<Link href={`/posts/${id}`}>Post {id}</Link>
<Link href="/search" search={{ q: "effect" }}>Search</Link>
<Link href="/posts" replace>Posts (replace)</Link>
```

For type-safe hrefs, register your router via module augmentation:

```tsx
declare module "fibrae/router" {
  interface RegisteredRouter {
    AppRouter: typeof AppRouter;
  }
}

// Now <Link href="/typo" /> is a compile-time error!
// But <Link href={`/posts/${id}`} /> passes — matches /posts/${string}
```

Link renders an `<a>` with the correct `href` (works with SSR) and intercepts clicks for SPA navigation. It applies an `"active"` CSS class when the current pathname matches (customizable via `activeClass` prop).

### RouterOutlet

`RouterOutlet` subscribes to the current route and renders the matched handler's component. For layout groups, nested `RouterOutlet` components render at increasing depth:

```tsx
const App = () => (
  <div>
    <Nav />
    <RouterOutlet />
  </div>
);
```

`OutletDepth` is a context tag that tracks nesting level, managed automatically by the renderer.

### Programmatic Navigation

The `Navigator` service provides route-aware navigation:

```tsx
const GoHomeButton = () =>
  Effect.gen(function* () {
    const navigator = yield* Navigator;
    return <button onClick={() => navigator.go("home")}>Go Home</button>;
  });

// With params
navigator.go("post", { path: { id: 42 } });

// Replace instead of push
navigator.go("settings", { replace: true });

// Back / forward
navigator.back;
navigator.forward;

// Check active state
const active = yield * navigator.isActive("home");
```

### Wiring It Up

```tsx
import * as Layer from "effect/Layer";
import { pipe } from "effect/Function";
import { render } from "fibrae";
import { NavigatorLive, BrowserHistoryLive } from "fibrae/router";

const routerLayer = pipe(
  NavigatorLive(appRouter),
  Layer.provideMerge(BrowserHistoryLive),
  Layer.provideMerge(MainRoutesLive),
);

render(<App />, document.getElementById("root")!, { layer: routerLayer });
```

### History Implementations

| Layer                         | Description                                   |
| ----------------------------- | --------------------------------------------- |
| `BrowserHistoryLive`          | Real browser history with `popstate` handling |
| `MemoryHistoryLive(options?)` | In-memory stack for SSR and testing           |

`MemoryHistoryLive` accepts `initialPathname`, `initialSearch`, `initialHash`, and `initialState`.

## Error Handling

`ErrorBoundary` catches errors in its subtree and shows a fallback. It supports recovery — when children re-emit (e.g. route change), the boundary resets and shows the new content.

```tsx
import { ErrorBoundary } from "fibrae";

const App = () => (
  <ErrorBoundary fallback={(error) => <div>Error: {error._tag}</div>}>
    <RouterOutlet />
  </ErrorBoundary>
);
```

The `fallback` receives a `ComponentError` union. Match on `_tag` for per-type handling:

```tsx
const fallback = (error: ComponentError) => {
  switch (error._tag) {
    case "RenderError":
      return <div>Render failed: {error.componentName}</div>;
    case "StreamError":
      return <div>Stream failed: {error.phase}</div>;
    case "EventHandlerError":
      return <div>Event {error.eventType} failed</div>;
  }
};
```

Error types:

| Type                | Fields                    | When                                                                            |
| ------------------- | ------------------------- | ------------------------------------------------------------------------------- |
| `RenderError`       | `cause`, `componentName?` | Component threw during render or its Effect failed                              |
| `StreamError`       | `cause`, `phase`          | Stream component failed (`"before-first-emission"` or `"after-first-emission"`) |
| `EventHandlerError` | `cause`, `eventType`      | An Effect event handler failed (e.g. `eventType: "click"`)                      |

Boundaries nest naturally — inner boundaries catch first, unhandled errors propagate outward.

## Suspense

`Suspense` uses a threshold-based strategy: it tries to render children immediately. If children take longer than `threshold` ms (default 100), the fallback is shown until children complete.

```tsx
import { Suspense } from "fibrae";

const App = () => (
  <Suspense fallback={<div>Loading...</div>} threshold={200}>
    <SlowComponent />
  </Suspense>
);
```

Works with Effect components (async service calls) and Stream components. During SSR, Suspense emits HTML comment markers (`<!--fibrae:sus:resolved-->` or `<!--fibrae:sus:fallback-->`) so the client can hydrate correctly.

## SSR

Server-side rendering produces HTML plus serialized atom state.

### renderToString

`renderToString` creates its own `AtomRegistry` internally. Use it for simple cases:

```tsx
import * as Effect from "effect/Effect";
import { renderToString } from "fibrae/server";

const program = Effect.gen(function* () {
  const { html, dehydratedState } = yield* renderToString(<App />);

  return `<!DOCTYPE html>
<html>
  <body>
    <div id="root">${html}</div>
    <script type="application/json" id="__fibrae-state__">${JSON.stringify(dehydratedState)}</script>
    <script src="/client.js"></script>
  </body>
</html>`;
});

const page = await Effect.runPromise(program);
```

### renderToStringWith

When your components require additional services (e.g. routing), use `renderToStringWith` and provide layers yourself:

```tsx
import { renderToStringWith, SSRAtomRegistryLayer } from "fibrae/server";
import * as Layer from "effect/Layer";

const program = Effect.gen(function* () {
  const { html, dehydratedState } = yield* renderToStringWith(<App />);
  return { html, dehydratedState };
});

await Effect.runPromise(
  program.pipe(
    Effect.provide(Layer.mergeAll(SSRAtomRegistryLayer, navigatorLayer, routerHandlersLayer)),
  ),
);
```

### Client Hydration

The client auto-discovers dehydrated state from the `<script id="__fibrae-state__">` tag. No manual state passing is needed:

```tsx
import { render } from "fibrae";

render(<App />, document.getElementById("root")!, { layer: routerLayer });
```

If the container has existing child elements (from SSR), fibrae uses hydration mode: it walks the existing DOM and attaches event handlers without replacing nodes.

### SSR + Routing

Use `Router.serverLayer()` on the server and `Router.browserLayer()` on the client:

```tsx
// Server
const serverLayer = Router.serverLayer({
  router: appRouter,
  pathname: "/posts/42",
  search: "?sort=date",
  basePath: "/app",
});

// Provides CurrentRouteElement, History, Navigator
// Requires RouterHandlers + AtomRegistry

// Client
const browserLayer = Router.browserLayer({
  router: appRouter,
  basePath: "/app",
});

render(<App />, root, { layer: browserLayer });
```

### Atom.serializable

Only atoms marked with `Atom.serializable` are included in dehydrated state. The schema handles encoding/decoding:

```tsx
const userAtom = Atom.make<User | null>(null).pipe(
  Atom.serializable({ key: "current-user", schema: Schema.NullOr(UserSchema) }),
);
```

## Live System

The live system (`fibrae/live`) provides real-time server-to-client data sync over Server-Sent Events (SSE).

### Creating Live Atoms

`live(event, { schema })` creates an atom backed by an SSE source. The atom's type is `Result<A>`:

- `Result.initial()` before SSE connects
- `Result.success(value)` on each event

Live atoms are automatically serializable for SSR hydration.

```tsx
import * as Schema from "effect/Schema";
import { live } from "fibrae/live";
import { Result } from "fibrae";

const ClockAtom = live("clock", { schema: Schema.String });

// In a component
const LiveClock = () =>
  Effect.gen(function* () {
    const clock = yield* Atom.get(ClockAtom);
    return Result.match(clock, {
      onInitial: () => <span>Connecting...</span>,
      onSuccess: (time) => <span>Server time: {time}</span>,
    });
  });
```

### Server-Side SSE Endpoints

`serve()` creates an SSE endpoint for a single live atom. `serveGroup()` multiplexes multiple atoms over one connection.

```tsx
import { serve, serveGroup } from "fibrae/live";
import { HttpRouter } from "@effect/platform";

// Single channel
const clockHandler = serve(ClockAtom, {
  source: Effect.sync(() => new Date().toISOString()),
  interval: "1 second",
});

// Multiple channels over one connection
const groupHandler = serveGroup({
  channels: [
    {
      channel: ClockAtom,
      source: Effect.sync(() => new Date().toISOString()),
      interval: "1 second",
    },
    { channel: StatsAtom, source: fetchStats, interval: "5 seconds" },
  ],
  heartbeatInterval: "30 seconds",
});

// Wire into your HTTP router
HttpRouter.get("/api/live", clockHandler);
```

`serve()` options:

| Option              | Default        | Description                                   |
| ------------------- | -------------- | --------------------------------------------- |
| `source`            | required       | Effect that fetches current state             |
| `interval`          | `"2 seconds"`  | Polling interval                              |
| `equals`            | `Equal.equals` | Deduplication function, or `false` to disable |
| `heartbeatInterval` | `"30 seconds"` | SSE keepalive interval, or `false` to disable |
| `retryInterval`     | --             | SSE retry hint sent to client                 |

### LiveConfig

Provide `LiveConfig` in your render layer to tell the client where to connect. Live atoms auto-connect when detected during render:

```tsx
import { LiveConfig } from "fibrae/live";
import * as Layer from "effect/Layer";

const liveLayer = Layer.succeed(
  LiveConfig,
  LiveConfig.make({
    baseUrl: "/api/live",
    channels: {
      clock: "/api/live/clock", // override per event name
    },
  }),
);

render(<App />, root, { layer: Layer.merge(routerLayer, liveLayer) });
```

## Services (like React Context)

Use Effect services for dependency injection across the component tree. Define a service, provide it via a Layer to `render()`, and yield it in any component or event handler.

```tsx
import * as Effect from "effect/Effect";
import { Atom, AtomRegistry } from "fibrae";

const themeAtom = Atom.make<"light" | "dark">("dark");

class ThemeService extends Effect.Service<ThemeService>()("ThemeService", {
  accessors: true,
  effect: Effect.gen(function* () {
    const registry = yield* AtomRegistry.AtomRegistry;
    return {
      getTheme: () => Atom.get(themeAtom),
      toggleTheme: () =>
        Effect.sync(() => registry.update(themeAtom, (t) => (t === "light" ? "dark" : "light"))),
    };
  }),
}) {}

// Components yield services -- Suspense shows fallback during async resolution
const ThemedPanel = () =>
  Effect.gen(function* () {
    const theme = yield* ThemeService.getTheme();
    return <div class={theme === "dark" ? "dark-panel" : "light-panel"}>Content</div>;
  });

// Provide via Layer
render(<App />, root, { layer: ThemeService.Default });
```

Key points:

- Services are Effect programs -- they can yield other services and access atoms
- `accessors: true` generates static methods (`ThemeService.getTheme()`) for convenience
- Atom changes in services trigger re-renders in all subscribing components
- Services are available in components, event handlers, and loaders

## Per-Route Head Metadata

Each route handler can define a `head()` function that returns metadata for the document `<head>`:

```tsx
handlers.handle("post", {
  loader: ({ path }) => fetchPost(path.id),
  component: ({ loaderData }) => <PostPage post={loaderData} />,
  head: ({ loaderData }) => ({
    title: loaderData.title,
    meta: [
      { name: "description", content: loaderData.summary },
      { property: "og:title", content: loaderData.title },
    ],
    links: [{ rel: "canonical", href: `https://example.com/posts/${loaderData.id}` }],
  }),
});
```

`HeadData` fields:

| Field     | Type                          | Description                                                                    |
| --------- | ----------------------------- | ------------------------------------------------------------------------------ |
| `title`   | `string`                      | Document title                                                                 |
| `meta`    | `MetaDescriptor[]`            | Meta tags (name/content, property/content, charset, httpEquiv, script:ld+json) |
| `links`   | `Record<string, string>[]`    | Link tags                                                                      |
| `scripts` | `{ src?, content?, type? }[]` | Script tags                                                                    |

Head data is rendered during SSR and updated on client-side navigation.

## Complete Example

```tsx
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { pipe } from "effect/Function";
import { render, Atom, AtomRegistry, Suspense, ErrorBoundary } from "fibrae";
import {
  Route,
  Router,
  RouterBuilder,
  Link,
  RouterOutlet,
  NavigatorLive,
  BrowserHistoryLive,
  Navigator,
} from "fibrae/router";

// --- Atoms ---
const countAtom = Atom.make(0);

// --- Routes ---
const homeRoute = Route.get("home", "/");
const postRoute = Route.get("post", "/posts/:id", { id: Schema.NumberFromString });

const appRouter = Router.make("app").add(Router.group("main").add(homeRoute).add(postRoute));

// Register router for type-safe Link href
declare module "fibrae/router" {
  interface RegisteredRouter {
    appRouter: typeof appRouter;
  }
}

// --- Components ---
const Nav = () => (
  <nav>
    <Link href="/">Home</Link>
    <Link href="/posts/1">Post 1</Link>
  </nav>
);

const Counter = () =>
  Effect.gen(function* () {
    const registry = yield* AtomRegistry.AtomRegistry;
    const count = yield* Atom.get(countAtom);
    return <button onClick={() => registry.update(countAtom, (n) => n + 1)}>Count: {count}</button>;
  });

const Clock = () =>
  Stream.fromSchedule(Schedule.spaced("1 second")).pipe(
    Stream.scan(0, (n) => n + 1),
    Stream.map((seconds) => <span>Uptime: {seconds}s</span>),
  );

// --- Route Handlers ---
const AppRoutesLive = RouterBuilder.group(appRouter, "main", (handlers) =>
  handlers
    .handle("home", {
      component: () => (
        <div>
          <h1>Home</h1>
          <Counter />
          <Clock />
        </div>
      ),
    })
    .handle("post", {
      loader: ({ path }) => fetchPost(path.id),
      component: ({ loaderData }) => <PostPage post={loaderData} />,
      head: ({ loaderData }) => ({ title: loaderData.title }),
    }),
);

// --- Error Boundary + Suspense ---
const App = () => (
  <>
    <Nav />
    <ErrorBoundary fallback={(e) => <div>Error: {e._tag}</div>}>
      <Suspense fallback={<div>Loading...</div>} threshold={100}>
        <RouterOutlet />
      </Suspense>
    </ErrorBoundary>
  </>
);

// --- Render ---
const routerLayer = pipe(
  NavigatorLive(appRouter),
  Layer.provideMerge(BrowserHistoryLive),
  Layer.provideMerge(AppRoutesLive),
);

render(<App />, document.getElementById("root")!, { layer: routerLayer });
```

## API Quick Reference

### Core Exports (`fibrae`)

| Export                                              | Description                                                             |
| --------------------------------------------------- | ----------------------------------------------------------------------- |
| `render(element, container, options?)`              | Mount a VElement tree to the DOM                                        |
| `Atom`                                              | Atom creation and utilities (from `@effect-atom/atom`)                  |
| `AtomRegistry`                                      | Registry service for reading/writing atoms                              |
| `Result`                                            | `Result.initial()` / `Result.success(a)` for async value states         |
| `Suspense`                                          | Threshold-based loading boundary                                        |
| `ErrorBoundary`                                     | Catches errors in subtree, shows fallback, supports navigation recovery |
| `ComponentScope`                                    | Service providing `{ scope, mounted }` for lifecycle management         |
| `HydrationState`                                    | Service for dehydrated state (auto-discovered from DOM)                 |
| `RenderError` / `StreamError` / `EventHandlerError` | Tagged error types                                                      |

### Server Exports (`fibrae/server`)

| Export                        | Description                                          |
| ----------------------------- | ---------------------------------------------------- |
| `renderToString(element)`     | Render to HTML + dehydrated state (self-contained)   |
| `renderToStringWith(element)` | Render to HTML, requiring `AtomRegistry` from caller |
| `SSRAtomRegistryLayer`        | Synchronous registry layer for SSR                   |

### Router Exports (`fibrae/router`)

| Export                                        | Description                                                  |
| --------------------------------------------- | ------------------------------------------------------------ |
| `Route.get(name, path)`                       | Declare a route with static path                             |
| `Route.get(name)\`/path/${param}\``           | Declare a route with template literal path                   |
| `Route.param(name, schema)`                   | Schema-validated path parameter                              |
| `Router.make(name)`                           | Create a router                                              |
| `Router.group(name)`                          | Create a route group                                         |
| `Router.layout(name, basePath)`               | Create a layout group                                        |
| `Router.serverLayer(options)`                 | SSR layer (provides History, Navigator, CurrentRouteElement) |
| `Router.browserLayer(options)`                | Client hydration layer                                       |
| `RouterBuilder.group(router, name, fn)`       | Implement handlers for a route group                         |
| `RouterBuilder.layoutGroup(router, name, fn)` | Implement handlers for a layout group                        |
| `Link`                                        | Path-based link component (type-safe via `RegisteredRouter`) |
| `RouterOutlet`                                | Renders matched route component                              |
| `OutletDepth`                                 | Context tag for nested outlet depth                          |
| `Navigator` / `NavigatorLive(router)`         | Programmatic navigation service                              |
| `BrowserHistoryLive`                          | Browser history layer                                        |
| `MemoryHistoryLive(options?)`                 | In-memory history layer                                      |

### Live Exports (`fibrae/live`)

| Export                     | Description                                 |
| -------------------------- | ------------------------------------------- |
| `live(event, { schema })`  | Create a live atom backed by SSE            |
| `serve(atom, options)`     | SSE endpoint for a single live atom         |
| `serveGroup({ channels })` | Multiplexed SSE endpoint for multiple atoms |
| `LiveConfig`               | Client-side SSE connection configuration    |
