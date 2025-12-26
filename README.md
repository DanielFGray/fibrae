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
import {
  render, Atom, AtomRegistry, Route, Router, RouterBuilder,
  createLink, RouterOutlet, Navigator, Suspense, ErrorBoundary,
  BrowserHistoryLive, NavigatorLive
} from "fibrae";

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
const App = () => (
  <ErrorBoundary fallback={<div>Something went wrong</div>}>
    <Nav />
    <Suspense fallback={<div>Loading...</div>} threshold={100}>
      <RouterOutlet />
    </Suspense>
  </ErrorBoundary>
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

### Routing

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

| Component       | Props                                     |
| --------------- | ----------------------------------------- |
| `Suspense`      | `fallback`, `threshold` (ms, default 100) |
| `ErrorBoundary` | `fallback`, `onError`                     |

### SSR

```tsx
// Server
import { Router } from "fibrae/server";
const { html, dehydratedState } = yield* Router.renderToString(<App />, { layer });

// Client
render(<App />, root, { layer, initialState: window.__FIBRAE_STATE__ });
```
