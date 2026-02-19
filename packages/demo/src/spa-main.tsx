/**
 * SPA Entry Point for Fibrae Notes Demo
 *
 * This is the main SPA entry that:
 * 1. Sets up router with BrowserHistoryLive and NavigatorLive
 * 2. Provides ApiClientLive for API calls
 * 3. Provides AtomRegistry for reactive state
 * 4. Renders the app shell with RouterOutlet
 */

import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as BrowserPlatform from "@effect/platform-browser";
import { pipe } from "effect/Function";
import { render, Suspense, ErrorBoundary } from "fibrae";
import {
  BrowserHistoryLive,
  NavigatorLive,
  RouterOutlet,
} from "fibrae/router";

import { AppRouter, AppHandlersClientLive, Link } from "./app/index.js";
import { ApiClientLive } from "./api/index.js";

// =============================================================================
// Navigation Bar (uses router Link)
// =============================================================================

const NavBar = () =>
  Effect.gen(function* () {
    return (
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
  });

// =============================================================================
// Error Fallback Component
// =============================================================================

const AppErrorFallback = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div class="error-fallback" data-cy="app-error">
      <h2 data-cy="error-title">Something went wrong</h2>
      <p data-cy="error-message">{message}</p>
      <button data-cy="error-reload" onclick={() => window.location.reload()}>
        Reload Page
      </button>
    </div>
  );
};

// =============================================================================
// App Shell with Error Boundary
// =============================================================================

// Wrap RouterOutlet with ErrorBoundary and catchAll for error handling
const RouteContent = () =>
  ErrorBoundary(
    <Suspense fallback={<div data-cy="route-loading">Loading...</div>} threshold={50}>
      <RouterOutlet />
    </Suspense>,
  ).pipe(Stream.catchAll((error) => Stream.succeed(AppErrorFallback(error))));

const App = () =>
  Effect.gen(function* () {
    return (
      <div class="app-container" data-cy="spa-app">
        <header>
          <h1>Fibrae Notes</h1>
        </header>
        <NavBar />
        <main data-cy="main-content">
          <RouteContent />
        </main>
      </div>
    );
  });

// =============================================================================
// Layer Composition
// =============================================================================

// Router layers: History -> Navigator -> Handlers
const routerLayer = pipe(
  NavigatorLive(AppRouter),
  Layer.provideMerge(BrowserHistoryLive),
  Layer.provideMerge(AppHandlersClientLive),
);

// Combined layer with API client
const appLayer = pipe(
  routerLayer,
  Layer.provideMerge(ApiClientLive),
);

// =============================================================================
// Bootstrap
// =============================================================================

// Redirect to home if at the HTML entry point
if (window.location.pathname === "/notes.html") {
  window.history.replaceState(null, "", "/");
}

Effect.gen(function* () {
  const root = pipe(document.getElementById("root"), Option.fromNullable, Option.getOrThrow);

  return yield* render(<App />, root, { layer: appLayer });
}).pipe(
  Effect.catchAllDefect((e) => Effect.log(e)),
  BrowserPlatform.BrowserRuntime.runMain,
);
