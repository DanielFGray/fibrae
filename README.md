# fibrae

Effect-first JSX renderer with automatic reactivity and type-safe routing.

## Features

- **Effect-based components** - Components are Effect programs
- **Fine-grained reactivity** - Atom-based state with automatic re-rendering
- **Type-safe routing** - Schema-validated routes with loaders
- **SSR** - Server-side rendering with hydration

## Installation

```bash
npm install fibrae @effect-atom/atom effect
```

```json
// tsconfig.json
{ "compilerOptions": { "jsx": "react-jsx", "jsxImportSource": "fibrae" } }
```

## Complete Example

```tsx
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Schedule from "effect/Schedule";
import * as Layer from "effect/Layer";
import { pipe } from "effect/Function";
import { render, Atom, AtomRegistry, Suspense, ErrorBoundary } from "fibrae";
import {
  Route, Router, RouterBuilder, createLink, RouterOutlet,
  Navigator, BrowserHistoryLive, NavigatorLive
} from "fibrae/router";

// --- State ---
const countAtom = Atom.make(0);

// --- Routes ---
const homeRoute = Route.get("home", "/");
const postRoute = Route.get("post")`/posts/${Route.param("id", Schema.NumberFromString)}`;
const appRouter = Router.make("app")
  .add(Router.group("main").add(homeRoute).add(postRoute));

const Link = createLink(appRouter);

// --- Components ---

// Static component
const Nav = () => (
  <nav>
    <Link to="home">Home</Link>
    <Link to="post" params={{ id: 1 }}>Post 1</Link>
  </nav>
);

// Effect component with state
const Counter = () =>
  Effect.gen(function* () {
    const registry = yield* AtomRegistry.AtomRegistry;
    const count = yield* Atom.get(countAtom);
    return (
      <button onClick={() => registry.update(countAtom, (n) => n + 1)}>
        Count: {count}
      </button>
    );
  });

// Stream component (real-time updates)
const Clock = () =>
  Stream.fromSchedule(Schedule.spaced("1 second")).pipe(
    Stream.scan(0, (n) => n + 1),
    Stream.map((seconds) => <span>Uptime: {seconds}s</span>)
  );

// Programmatic navigation
const GoHomeButton = () =>
  Effect.gen(function* () {
    const navigator = yield* Navigator;
    return <button onClick={() => navigator.go("home")}>Go Home</button>;
  });

// Event handlers can return Effects
const LogButton = () => (
  <button onClick={() => Effect.log("Clicked!")}>Log</button>
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
      )
    })
    .handle("post", {
      loader: ({ path }) => fetchPost(path.id),  // plain value or Effect
      component: ({ loaderData }) => <PostPage post={loaderData} />
    })
);

// --- App with Suspense + ErrorBoundary ---
const SafeRouterOutlet = () => ErrorBoundary(<RouterOutlet />).pipe(
  Stream.catchTags({
    RenderError: (e) => Stream.succeed(<div>Render failed: {e.componentName}</div>),
    StreamError: (e) => Stream.succeed(<div>Stream failed ({e.phase})</div>),
    EventHandlerError: (e) => Stream.succeed(<div>Event {e.eventType} failed</div>),
  })
);

const App = () => (
  <>
    <Nav />
    <Suspense fallback={<div>Loading...</div>} threshold={100}>
      <SafeRouterOutlet />
    </Suspense>
  </>
);

// --- Render ---
const routerLayer = pipe(
  NavigatorLive(appRouter),
  Layer.provideMerge(BrowserHistoryLive),
  Layer.provideMerge(AppRoutesLive)
);

render(<App />, document.getElementById("root")!, { layer: routerLayer });
```

## API Reference

### Components

Components return `VElement`, `Effect<VElement>`, or `Stream<VElement>`.

### State (Atoms)

| API                         | Description                   |
| --------------------------- | ----------------------------- |
| `Atom.make(initial)`        | Create atom                   |
| `Atom.get(atom)`            | Read value (yields in Effect) |
| `Atom.family(fn)`           | Parameterized atoms           |
| `registry.set(atom, value)` | Set value                     |
| `registry.update(atom, fn)` | Update with function          |

### Services (like React Context)

Use `Effect.Service` to share state and behavior across components:

```tsx
import { Atom, AtomRegistry } from "fibrae";

// Define a service with shared atoms
const themeAtom = Atom.make<"light" | "dark">("dark");

class ThemeService extends Effect.Service<ThemeService>()("ThemeService", {
  accessors: true,
  effect: Effect.gen(function* () {
    const registry = yield* AtomRegistry.AtomRegistry;
    return {
      getTheme: () => Atom.get(themeAtom),
      toggleTheme: () => Effect.sync(() =>
        registry.update(themeAtom, (t) => t === "light" ? "dark" : "light")
      ),
    };
  }),
}) {}

// Async service with Effect.sleep
class UserService extends Effect.Service<UserService>()("UserService", {
  accessors: true,
  sync: () => ({
    getCurrentUser: () =>
      Effect.sleep("1 second").pipe(
        Effect.map(() => ({ name: "Alice", role: "admin" }))
      ),
  }),
}) {}

// Components yield from services - Suspense shows fallback during async
const UserCard = () =>
  Effect.gen(function* () {
    const theme = yield* ThemeService.getTheme();
    const user = yield* UserService.getCurrentUser();
    return (
      <div style={{ background: theme === "dark" ? "#2a2a2a" : "#f0f0f0" }}>
        <p>{user.name} ({user.role})</p>
        <button onClick={() => ThemeService.toggleTheme()}>Toggle Theme</button>
      </div>
    );
  });
```

Key points:
- Services are Effect programs that yield dependencies
- Use `accessors: true` for static method access (`ThemeService.getTheme()`)
- Async services (with `Effect.sleep`, fetches) work with `Suspense`
- Atom changes trigger re-renders across all components using that atom

### Routing

Router features are available via `fibrae/router`:

```tsx
import { Route, Router, RouterBuilder, createLink, RouterOutlet } from "fibrae/router";
```

| API                                     | Description                     |
| --------------------------------------- | ------------------------------- |
| `Route.get(name, path)`                 | Define route                    |
| `Route.param(name, schema)`             | Path parameter                  |
| `.setSearchParams(schema)`              | Query parameters                |
| `Router.make(name).add(...)`            | Create router                   |
| `RouterBuilder.group(router, name, fn)` | Define handlers                 |
| `createLink(router)`                    | Create Link component           |
| `RouterOutlet`                          | Render matched route            |
| `Navigator`                             | Programmatic navigation service |

### Built-in Components

| Component       | Description                                                    |
| --------------- | -------------------------------------------------------------- |
| `Suspense`      | Shows `fallback` while children load (`threshold` ms, default 100) |
| `ErrorBoundary` | Returns `Stream<VElement, ComponentError>` for `Stream.catchTags` |

### Error Handling

`ErrorBoundary(children)` returns a `Stream` that can catch typed errors:

```tsx
const SafeApp = () => ErrorBoundary(<App />).pipe(
  Stream.catchTags({
    RenderError: (e) => Stream.succeed(<div>Render failed: {e.componentName}</div>),
    StreamError: (e) => Stream.succeed(<div>Stream failed: {e.phase}</div>),
    EventHandlerError: (e) => Stream.succeed(<div>Event {e.eventType} failed</div>),
  })
);
```

Error types:
- `RenderError` - Component threw during render (`cause`, `componentName?`)
- `StreamError` - Stream component failed (`cause`, `phase: "before-first-emission" | "after-first-emission"`)
- `EventHandlerError` - Event handler Effect failed (`cause`, `eventType`)

### SSR

```tsx
// Server
import { renderToString } from "fibrae/server";
const { html, dehydratedState } = yield* renderToString(<App />);
// Embed: <script type="application/json" id="__fibrae-state__">${JSON.stringify(dehydratedState)}</script>

// Client — hydration state is auto-discovered from the DOM
render(<App />, root, { layer });
```
