import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Layer } from "effect";
import * as FileSystem from "@effect/platform/FileSystem";
import {
  HttpMiddleware,
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from "@effect/platform";
import {
  BunRuntime,
  BunHttpServer,
  BunFileSystem,
  BunPath,
} from "@effect/platform-bun";
import { h } from "@didact/core";
import { renderToStringWith, SSRAtomRegistryLayer } from "@didact/core/server";
import { Router } from "@didact/core/router";
import { CounterApp, TodoApp, SuspenseApp, SlowSuspenseApp, setInitialTodos } from "../src/ssr-app.js";
import { SSRRouter, App, createSSRRouterHandlers } from "../src/ssr-router-app.js";

// Path to todos JSON file (relative to server directory)
const TODOS_FILE = new URL("./todos.json", import.meta.url).pathname;

/**
 * Helper to build SSR HTML page
 */
const buildPage = (html: string, dehydratedState: unknown[], hydrationScript: string) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Didact SSR</title>
</head>
<body>
<div id="root">${html}</div>
<script>window.__DIDACT_STATE__ = ${JSON.stringify(dehydratedState)};</script>
<script type="module" src="http://localhost:5173/src/${hydrationScript}"></script>
</body>
</html>`;

/**
 * Helper to build SSR router HTML page (includes router state)
 */
const buildRouterPage = (
  html: string, 
  atomState: unknown[], 
  routerState: unknown,
  hydrationScript: string
) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Didact SSR Router</title>
</head>
<body>
<div id="root">${html}</div>
<script>window.__DIDACT_STATE__ = ${JSON.stringify(atomState)};
window.__DIDACT_ROUTER__ = ${JSON.stringify(routerState)};</script>
<script type="module" src="http://localhost:5173/src/${hydrationScript}"></script>
</body>
</html>`;

/**
 * Counter SSR handler
 */
const counterHandler = Effect.gen(function* () {
  const { html, dehydratedState } = yield* renderToString(h(CounterApp));
  return HttpServerResponse.html(buildPage(html, dehydratedState, "ssr-hydrate-counter.tsx"));
});

/**
 * Load todos from JSON file
 */
const loadTodos = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const exists = yield* fs.exists(TODOS_FILE);
  if (!exists) {
    return [];
  }
  const content = yield* fs.readFileString(TODOS_FILE);
  return JSON.parse(content) as string[];
});

/**
 * Save todos to JSON file
 */
const saveTodos = (todos: string[]) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.writeFileString(TODOS_FILE, JSON.stringify(todos, null, 2));
  });

/**
 * Todo SSR handler - loads todos from file and renders
 */
const todoHandler = Effect.gen(function* () {
  const todos = yield* loadTodos;
  // Set initial todos for SSR render
  setInitialTodos(todos);
  const { html, dehydratedState } = yield* renderToString(h(TodoApp));
  return HttpServerResponse.html(buildPage(html, dehydratedState, "ssr-hydrate-todo.tsx"));
});

/**
 * Reset todos (for testing)
 */
const todoResetHandler = Effect.gen(function* () {
  yield* saveTodos([]);
  return yield* HttpServerResponse.json({ success: true });
}).pipe(
  Effect.catchAllDefect((defect) => {
    console.error("Reset defect:", defect);
    return HttpServerResponse.json({ success: false, error: String(defect) });
  }),
  Effect.catchAll((e) => {
    console.error("Reset error:", e);
    return HttpServerResponse.json({ success: false, error: String(e) });
  })
);

// Schema for save request body
const SaveTodosBody = Schema.Struct({
  todos: Schema.Array(Schema.String)
});

/**
 * Save todos API endpoint - persists client-side todos to file
 */
const todoSaveHandler = Effect.gen(function* () {
  const body = yield* HttpServerRequest.schemaBodyJson(SaveTodosBody);
  yield* saveTodos(body.todos);
  return yield* HttpServerResponse.json({ success: true });
}).pipe(
  Effect.catchAllDefect((defect) => {
    console.error("Save defect:", defect);
    return HttpServerResponse.json({ success: false, error: String(defect) });
  }),
  Effect.catchAll(() => HttpServerResponse.json({ success: false, error: "Failed to save" }))
);

/**
 * Suspense SSR handler - renders Suspense boundary with resolved content
 */
const suspenseHandler = Effect.gen(function* () {
  const { html, dehydratedState } = yield* renderToString(h(SuspenseApp));
  return HttpServerResponse.html(buildPage(html, dehydratedState, "ssr-hydrate-suspense.tsx"));
});

/**
 * Slow Suspense SSR handler - renders Suspense boundary with fallback (content too slow)
 */
const slowSuspenseHandler = Effect.gen(function* () {
  const { html, dehydratedState } = yield* renderToString(h(SlowSuspenseApp));
  return HttpServerResponse.html(buildPage(html, dehydratedState, "ssr-hydrate-suspense-slow.tsx"));
});

// =============================================================================
// SSR Router Handlers
// =============================================================================

/**
 * Create the SSR router handlers layer (server-side loaders)
 */
const ssrRouterHandlersLayer = createSSRRouterHandlers(true);

/**
 * SSR Router handler - matches request pathname and renders route
 * 
 * This handler:
 * 1. Creates serverLayer to match route and run loader
 * 2. Renders the route component wrapped in App shell in the same context
 * 3. Returns HTML with dehydrated atom and router state
 */
const ssrRouterHandler = (ssrPathname: string) =>
  Effect.gen(function* () {
    // Create server layer for this request
    // basePath is the mount point of this SSR app (/ssr/router)
    const serverLayer = Router.serverLayer({
      router: SSRRouter,
      pathname: ssrPathname,
      search: "",
      basePath: "/ssr/router",
    });
    
    // Combined layer: SSRAtomRegistryLayer + RouterHandlers -> serverLayer -> provides History, Navigator, CurrentRouteElement
    const fullLayer = Layer.provideMerge(
      serverLayer,
      Layer.merge(ssrRouterHandlersLayer, SSRAtomRegistryLayer)
    );
    
    // Get the rendered element and state, then render in the same context
    const { html, atomState, state } = yield* Effect.gen(function* () {
      const { element, state } = yield* Router.CurrentRouteElement;
      
      // Wrap in App shell - pass element as child via third argument
      const app = h(App, {}, [element]);
      
      // Render to string - uses same AtomRegistry/Navigator context
      const { html, dehydratedState: atomState } = yield* renderToStringWith(app);
      
      return { html, atomState, state };
    }).pipe(Effect.provide(fullLayer));
    
    // Build page with both atom and router state
    return HttpServerResponse.html(
      buildRouterPage(html, atomState, state, "ssr-hydrate-router.tsx")
    );
  }).pipe(
    Effect.catchAll((e) => {
      console.error("SSR Router error:", e);
      return HttpServerResponse.text(`SSR Error: ${e}`, { status: 500 });
    })
  );

/**
 * Router with SSR routes
 */
const router = HttpRouter.empty.pipe(
  // Legacy route (redirect to /ssr/counter)
  HttpRouter.get("/ssr", counterHandler),
  // Counter scenario
  HttpRouter.get("/ssr/counter", counterHandler),
  // Todo scenario
  HttpRouter.get("/ssr/todo", todoHandler),
  HttpRouter.post("/ssr/todo/reset", todoResetHandler),
  HttpRouter.post("/ssr/todo/save", todoSaveHandler),
  // Suspense scenario
  HttpRouter.get("/ssr/suspense", suspenseHandler),
  // Slow Suspense scenario (fallback)
  HttpRouter.get("/ssr/suspense-slow", slowSuspenseHandler),
  // SSR Router scenarios - match all /ssr/router/* paths
  HttpRouter.get("/ssr/router", ssrRouterHandler("/")),
  HttpRouter.get("/ssr/router/posts", ssrRouterHandler("/posts")),
  HttpRouter.get("/ssr/router/posts/:id", 
    HttpRouter.params.pipe(
      Effect.flatMap(({ id }) => ssrRouterHandler(`/posts/${id}`))
    )
  )
);

/**
 * Server - serves on port 3001
 */
const app = router.pipe(
  HttpRouter.use(HttpMiddleware.logger),
  HttpServer.serve(),
  HttpServer.withLogAddress
);

const ServerLive = Layer.mergeAll(
  BunHttpServer.layer({ port: 3001 }),
  BunFileSystem.layer,
  BunPath.layer
);

BunRuntime.runMain(Layer.launch(Layer.provide(app, ServerLive)), {
  disableErrorReporting: false,
});
