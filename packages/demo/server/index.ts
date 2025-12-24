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
import { renderToString } from "@didact/core/server";
import { CounterApp, TodoApp, SuspenseApp, setInitialTodos } from "../src/ssr-app.js";

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
  HttpRouter.get("/ssr/suspense", suspenseHandler)
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
