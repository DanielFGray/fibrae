/**
 * SSR Notes Hydration Entry Point
 *
 * This file is loaded by the browser after SSR.
 * It hydrates the server-rendered content and enables client-side navigation.
 */

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as BrowserPlatform from "@effect/platform-browser";
import { h, render } from "fibrae";
import { Hydration } from "@effect-atom/atom";
import { Router, RouterOutlet } from "fibrae/router";

import { AppRouter, AppHandlersClientLive, Link } from "./app/index.js";
import { ApiClientLive } from "./api/index.js";

// Declare global for TypeScript
declare global {
  interface Window {
    __FIBRAE_STATE__?: ReadonlyArray<Hydration.DehydratedAtom>;
  }
}

// =============================================================================
// App Shell (same as SPA but for hydration)
// =============================================================================

const NavBar = () => (
  <nav data-cy="main-nav">
    <Link data-cy="nav-home" to="home">
      Home
    </Link>
    {" | "}
    <Link data-cy="nav-posts" to="posts">
      Posts
    </Link>
    {" | "}
    <Link data-cy="nav-new-post" to="postNew">
      New Post
    </Link>
  </nav>
);

// =============================================================================
// Hydration Bootstrap
// =============================================================================

// Get initial atom state from SSR (includes router state via RouterStateAtom)
const initialState = window.__FIBRAE_STATE__;

// Create browser layer - reads from hydrated RouterStateAtom
// basePath matches the server mount point (/ssr/notes)
const browserLayer = Router.browserLayer({
  router: AppRouter,
  basePath: "/ssr/notes",
});

// Combined layer: RouterHandlers -> browserLayer -> ApiClient
const routerLayer = Layer.provideMerge(
  Layer.provideMerge(browserLayer, AppHandlersClientLive),
  ApiClientLive,
);

// Get container
const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element not found");
}

// Run hydration
console.log("[ssr-notes-hydrate] Starting hydration");
Effect.gen(function* () {
  // Create RouterOutlet - it will read from hydrated RouterStateAtom
  const outlet = h(RouterOutlet, {});

  // Wrap in App shell
  const app = (
    <div class="app-container" data-cy="ssr-notes-app">
      <header>
        <h1>Fibrae Notes</h1>
      </header>
      <NavBar />
      <main data-cy="main-content">{outlet}</main>
    </div>
  );

  // Render (hydrate) the app with router layer
  yield* Effect.log("Hydrating SSR Notes app");
  return yield* render(app, container, {
    layer: routerLayer,
    initialState,
  });
}).pipe(
  Effect.catchAllDefect((e) => {
    console.error("Hydration error:", e);
    return Effect.log(e);
  }),
  BrowserPlatform.BrowserRuntime.runMain,
);
