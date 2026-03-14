# fibrae-cli

Static site generation for fibrae apps. Pre-render routes to HTML at build time with optional client hydration.

## Install

```sh
bun add fibrae-cli
```

Peer dependencies: `fibrae`, `effect`, `vite` (rolldown-vite).

## Quick Start

### 1. Create your app entry

The entry module exports three things the build needs:

```tsx
// src/app.tsx
import { h } from "fibrae";
import { Router, RouterBuilder, Route } from "fibrae/router";
import type { VElement } from "fibrae/shared";

// Define routes
export const router = Router.make("app")
  .add(Router.group("pages")
    .add(Route.get("home", "/"))
    .add(Route.get("about", "/about"))
    .add(Route.get("post")`/posts/${Route.param("id", Schema.NumberFromString)}`)
  );

// Implement handlers — mark routes with prerender: true
export const handlersLayer = RouterBuilder.group(router, "pages", (h) =>
  h
    .handle("home", {
      prerender: true,
      component: () => <h1>Home</h1>,
    })
    .handle("about", {
      prerender: true,
      component: () => <h1>About</h1>,
    })
    .handle("post", {
      prerender: true,
      getStaticPaths: () => [{ id: 1 }, { id: 2 }, { id: 3 }],
      loader: ({ path }) => fetchPost(path.id),
      component: ({ loaderData }) => <article>{loaderData.title}</article>,
    })
);

// App shell wraps each route's rendered element
export const appShell = (element: VElement) =>
  <div class="app">
    <nav>
      <a href="/">Home</a>
      <a href="/about">About</a>
    </nav>
    <main>{element}</main>
  </div>;
```

### 2. Create a client entry

The client entry hydrates the pre-rendered HTML:

```tsx
// src/client.tsx
import { render } from "fibrae";
import { Router } from "fibrae/router";
import { router, handlersLayer, appShell } from "./app.js";

const browserLayer = Router.browserLayer({ router });

const app = /* your root component */;
render(app, document.getElementById("root")!, { layer: browserLayer });
```

### 3. Add the Vite plugin

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { fibrae } from "fibrae-cli/vite";

export default defineConfig({
  plugins: [
    fibrae({
      entry: "./src/app.tsx",
      client: "./src/client.tsx",
    }),
  ],
});
```

### 4. Run it

```sh
# Development — on-demand SSR for all routes
bunx fibrae dev

# Production build — pre-renders static routes, bundles client JS
bunx fibrae build

# Preview the built output
bunx fibrae preview
```

## How It Works

**Build pipeline:**

1. Vite builds the client JS bundle
2. The plugin loads your entry module and discovers all routes with `prerender: true`
3. For parameterized routes, `getStaticPaths()` enumerates all param combinations
4. Each route is rendered to HTML via `renderToString()` with full Effect context
5. HTML files are written to `dist/` with dehydrated atom state and client script tags

**Output structure:**

```
dist/
  index.html          ← /
  about/
    index.html        ← /about
  posts/
    1/index.html      ← /posts/1
    2/index.html      ← /posts/2
    3/index.html      ← /posts/3
  assets/
    client-[hash].js  ← hydration bundle
```

## Route Modes

| Declaration | Behavior |
|---|---|
| `prerender: true` | Rendered to static HTML at build time |
| `prerender: true` + `getStaticPaths` | One HTML file per param set |
| _(default)_ | Server-rendered per request |

All pre-rendered pages include the client JS bundle for hydration. Pages with interactive elements (event handlers, streams, live atoms) become fully interactive after the client loads.

## Configuration

```ts
fibrae({
  // Required: module exporting { router, handlersLayer, appShell }
  entry: "./src/app.tsx",

  // Required: client hydration entry point
  client: "./src/client.tsx",

  // Optional
  outDir: "dist",       // output directory (default: Vite's build.outDir)
  basePath: "/app",     // prefix stripped before route matching
  title: "My Site",     // default <title> for generated pages
})
```

## Programmatic API

Use `build()` directly without the Vite plugin:

```ts
import { build } from "fibrae-cli";
import * as Effect from "effect/Effect";
import { router, handlersLayer, appShell } from "./app.js";

await Effect.runPromise(
  build({
    router,
    handlersLayer,
    appShell,
    outDir: "dist",
    clientScript: "/assets/client.js",
  })
);
```
