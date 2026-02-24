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
  HttpApiBuilder,
} from "@effect/platform";
import { BunRuntime, BunHttpServer, BunFileSystem, BunPath } from "@effect/platform-bun";
import { h } from "fibrae";
import { renderToString, renderToStringWith, SSRAtomRegistryLayer } from "fibrae/server";
import { Router } from "fibrae/router";
import {
  CounterApp,
  TodoApp,
  SuspenseApp,
  SlowSuspenseApp,
  setInitialTodos,
} from "../src/ssr-app.js";
import { SSRRouter, App, createSSRRouterHandlers } from "../src/ssr-router-app.js";
import { AppRouter, AppHandlersServerLive } from "../src/app/index.js";
import { Api, ApiClientLive } from "../src/api/index.js";
import { PostsHandlersLive, AuthHandlersLive } from "./handlers/index.js";

// =============================================================================
// Configuration
// =============================================================================

const TODOS_FILE = new URL("./todos.json", import.meta.url).pathname;
const VITE_DEV_URL = "http://localhost:5173";
const SERVER_PORT = 3001;

// =============================================================================
// Schemas
// =============================================================================

/**
 * Standard JSON API response for mutations
 */
class ApiResponse extends Schema.Class<ApiResponse>("ApiResponse")({
  success: Schema.Boolean,
  error: Schema.optional(Schema.String),
}) {}

/**
 * Request body for saving todos
 */
class SaveTodosRequest extends Schema.Class<SaveTodosRequest>("SaveTodosRequest")({
  todos: Schema.Array(Schema.String),
}) {}

// =============================================================================
// HTML Page Builders
// =============================================================================

const buildPage = (
  html: string,
  dehydratedState: unknown[],
  hydrationScript: string,
) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Fibrae SSR</title>
</head>
<body>
<div id="root">${html}</div>
<script type="application/json" id="__fibrae-state__">${JSON.stringify(dehydratedState)}</script>
<script type="module" src="${VITE_DEV_URL}/src/${hydrationScript}"></script>
</body>
</html>`;

// =============================================================================
// File System Operations
// =============================================================================

const loadTodos = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const exists = yield* fs.exists(TODOS_FILE);
  if (!exists) {
    return [];
  }
  const content = yield* fs.readFileString(TODOS_FILE);
  return JSON.parse(content) as string[];
});

const saveTodos = (todos: readonly string[]) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.writeFileString(TODOS_FILE, JSON.stringify(todos, null, 2));
  });

// =============================================================================
// SSR Page Handlers
// =============================================================================

const counterHandler = Effect.gen(function* () {
  const { html, dehydratedState } = yield* renderToString(h(CounterApp));
  return HttpServerResponse.html(buildPage(html, dehydratedState, "ssr-hydrate-counter.tsx"));
});

const todoHandler = Effect.gen(function* () {
  const todos = yield* loadTodos;
  setInitialTodos(todos);
  const { html, dehydratedState } = yield* renderToString(h(TodoApp));
  return HttpServerResponse.html(buildPage(html, dehydratedState, "ssr-hydrate-todo.tsx"));
});

const suspenseHandler = Effect.gen(function* () {
  const { html, dehydratedState } = yield* renderToString(h(SuspenseApp));
  return HttpServerResponse.html(buildPage(html, dehydratedState, "ssr-hydrate-suspense.tsx"));
});

const slowSuspenseHandler = Effect.gen(function* () {
  const { html, dehydratedState } = yield* renderToString(h(SlowSuspenseApp));
  return HttpServerResponse.html(buildPage(html, dehydratedState, "ssr-hydrate-suspense-slow.tsx"));
});

// =============================================================================
// SSR Router Handler
// =============================================================================

const ssrRouterHandlersLayer = createSSRRouterHandlers(true);

const ssrRouterHandler = (ssrPathname: string) =>
  Effect.gen(function* () {
    const serverLayer = Router.serverLayer({
      router: SSRRouter,
      pathname: ssrPathname,
      search: "",
      basePath: "/ssr/router",
    });

    const fullLayer = Layer.provideMerge(
      serverLayer,
      Layer.merge(ssrRouterHandlersLayer, SSRAtomRegistryLayer),
    );

    // RouterStateAtom is set by serverLayer and included in dehydratedState
    const { html, dehydratedState } = yield* Effect.gen(function* () {
      const { element } = yield* Router.CurrentRouteElement;
      const app = h(App, {}, [element]);
      return yield* renderToStringWith(app);
    }).pipe(Effect.provide(fullLayer));

    // Use unified buildPage - RouterStateAtom is in dehydratedState
    return HttpServerResponse.html(buildPage(html, dehydratedState, "ssr-hydrate-router.tsx"));
  }).pipe(
    Effect.catchAll((e: unknown) => {
      console.error("SSR Router error:", e);
      return HttpServerResponse.text(`SSR Error: ${String(e)}`, { status: 500 });
    }),
  );

// =============================================================================
// SSR Notes Handler (new demo app)
// =============================================================================

const ssrNotesHandler = (ssrPathname: string) =>
  Effect.gen(function* () {
    const serverLayer = Router.serverLayer({
      router: AppRouter,
      pathname: ssrPathname,
      search: "",
      basePath: "/ssr/notes",
    });

    const fullLayer = Layer.provideMerge(
      serverLayer,
      Layer.merge(
        Layer.merge(AppHandlersServerLive, SSRAtomRegistryLayer),
        ApiClientLive,
      ),
    );

    // RouterStateAtom is set by serverLayer and included in dehydratedState
    const { html, dehydratedState } = yield* Effect.gen(function* () {
      const { element } = yield* Router.CurrentRouteElement;
      const app = h("div", { class: "app-container", "data-cy": "ssr-notes-app" }, [
        h("header", {}, [h("h1", {}, ["Fibrae Notes"])]),
        h("nav", { "data-cy": "main-nav" }, [
          h("a", { href: "/ssr/notes", "data-cy": "nav-home" }, ["Home"]),
          " | ",
          h("a", { href: "/ssr/notes/posts", "data-cy": "nav-posts" }, ["Posts"]),
          " | ",
          h("a", { href: "/ssr/notes/posts/new", "data-cy": "nav-new-post" }, ["New Post"]),
        ]),
        h("main", { "data-cy": "main-content" }, [element]),
      ]);
      return yield* renderToStringWith(app);
    }).pipe(Effect.provide(fullLayer));

    return HttpServerResponse.html(buildPage(html, dehydratedState, "ssr-notes-hydrate.tsx"));
  }).pipe(
    Effect.catchAll((e: unknown) => {
      console.error("SSR Notes error:", e);
      return HttpServerResponse.text(`SSR Error: ${String(e)}`, { status: 500 });
    }),
  );

// =============================================================================
// Todo API Handlers (with Schema validation)
// =============================================================================

/**
 * Reset todos endpoint - clears all todos
 * POST /ssr/todo/reset
 */
const todoResetHandler = Effect.gen(function* () {
  yield* saveTodos([]);
  return yield* HttpServerResponse.json(new ApiResponse({ success: true }));
}).pipe(
  Effect.catchAllDefect((defect) => {
    console.error("Reset defect:", defect);
    return HttpServerResponse.json(new ApiResponse({ success: false, error: String(defect) }));
  }),
  Effect.catchAll((e: { readonly _tag: string } | Error) => {
    console.error("Reset error:", e);
    const message = e instanceof Error ? e.message : e._tag;
    return HttpServerResponse.json(new ApiResponse({ success: false, error: message }));
  }),
);

/**
 * Save todos endpoint - persists client-side todos to file
 * POST /ssr/todo/save
 * Body: { todos: string[] }
 */
const todoSaveHandler = Effect.gen(function* () {
  const body = yield* HttpServerRequest.schemaBodyJson(SaveTodosRequest);
  yield* saveTodos(body.todos);
  return yield* HttpServerResponse.json(new ApiResponse({ success: true }));
}).pipe(
  Effect.catchAllDefect((defect) => {
    console.error("Save defect:", defect);
    return HttpServerResponse.json(new ApiResponse({ success: false, error: String(defect) }));
  }),
  Effect.catchAll(() =>
    HttpServerResponse.json(new ApiResponse({ success: false, error: "Failed to save" })),
  ),
);

// =============================================================================
// Router
// =============================================================================

// API routes using HttpApiBuilder (type-safe endpoints)
const ApiLive = HttpApiBuilder.api(Api).pipe(
  Layer.provide(PostsHandlersLive),
  Layer.provide(AuthHandlersLive),
  Layer.provide(BunFileSystem.layer),
);

// Convert HttpApi to a web handler with all required layers
const { handler: apiHandler } = HttpApiBuilder.toWebHandler(
  Layer.mergeAll(ApiLive, BunHttpServer.layerContext),
  { middleware: HttpMiddleware.logger },
);

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
  HttpRouter.get(
    "/ssr/router/posts/:id",
    HttpRouter.params.pipe(Effect.flatMap(({ id }) => ssrRouterHandler(`/posts/${id}`))),
  ),
  // SSR Notes scenarios - new demo app at /ssr/notes/*
  HttpRouter.get("/ssr/notes", ssrNotesHandler("/")),
  HttpRouter.get("/ssr/notes/posts", ssrNotesHandler("/posts")),
  HttpRouter.get("/ssr/notes/posts/new", ssrNotesHandler("/posts/new")),
  HttpRouter.get(
    "/ssr/notes/posts/:id/edit",
    HttpRouter.params.pipe(Effect.flatMap(({ id }) => ssrNotesHandler(`/posts/${id}/edit`))),
  ),
  HttpRouter.get(
    "/ssr/notes/posts/:id",
    HttpRouter.params.pipe(Effect.flatMap(({ id }) => ssrNotesHandler(`/posts/${id}`))),
  ),
  // API routes - mount all /api/* paths
  HttpRouter.all(
    "/api/*",
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const response = yield* Effect.promise(() => apiHandler(request.source as Request));
      // Forward the response body and status
      const body = yield* Effect.promise(() => response.text());
      return HttpServerResponse.text(body, {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        contentType: response.headers.get("content-type") ?? "application/json",
      });
    }),
  ),
);

// =============================================================================
// Server Setup
// =============================================================================

const app = router.pipe(
  HttpRouter.use(HttpMiddleware.logger),
  HttpServer.serve(),
  HttpServer.withLogAddress,
);

const ServerLive = Layer.mergeAll(
  BunHttpServer.layer({ port: SERVER_PORT }),
  BunFileSystem.layer,
  BunPath.layer,
);

BunRuntime.runMain(Layer.launch(Layer.provide(app, ServerLive)), {
  disableErrorReporting: false,
});
