/**
 * Transition E2E test page.
 *
 * Tests Transition.isPending behavior during navigation:
 * - isPending=true while a slow loader runs
 * - Old content stays visible (Suspense fallback suppressed)
 * - switchMap cancellation on rapid navigation
 */

import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Layer from "effect/Layer";
import * as BrowserPlatform from "@effect/platform-browser";
import { pipe } from "effect/Function";
import { render, Suspense, Atom, AtomRegistry } from "fibrae";
import type { VElement } from "fibrae";
import {
  Route,
  Router,
  RouterBuilder,
  RouterOutlet,
  Link,
  NavigatorLive,
  BrowserHistoryLive,
  Transition,
  TransitionLive,
} from "fibrae/router";

// =============================================================================
// Route Definitions
// =============================================================================

const AppRoutes = Router.group("transition-test")
  .add(Route.get("home", "/"))
  .add(Route.get("slow", "/slow"))
  .add(Route.get("fast", "/fast"));

const AppRouter = Router.make("TransitionTestRouter").add(AppRoutes);

// Register for type-safe Link
declare module "fibrae/router" {
  interface RegisteredRouter {
    TransitionTestRouter: typeof AppRouter;
  }
}

// =============================================================================
// Components
// =============================================================================

function HomePage(): VElement {
  return <div data-cy="page-content">Home Page</div>;
}

function SlowPage(): VElement {
  return <div data-cy="page-content">Slow Page</div>;
}

function FastPage(): VElement {
  return <div data-cy="page-content">Fast Page</div>;
}

// =============================================================================
// Route Handlers
// =============================================================================

const AppHandlersLive = RouterBuilder.group(AppRouter, AppRoutes, (handlers) =>
  handlers
    .handle("home", {
      loader: () => Effect.succeed({ title: "Home" }),
      component: () => <HomePage />,
    })
    .handle("slow", {
      loader: () =>
        Effect.sleep("500 millis").pipe(Effect.map(() => ({ title: "Slow" }))),
      component: () => <SlowPage />,
    })
    .handle("fast", {
      loader: () => Effect.succeed({ title: "Fast" }),
      component: () => <FastPage />,
    }),
);

// =============================================================================
// Nav Component — reads Transition.isPending
// =============================================================================

const Nav = (): Effect.Effect<VElement, never, AtomRegistry.AtomRegistry> =>
  Effect.gen(function* () {
    const transition = yield* Effect.serviceOption(Transition);
    const pending = Option.isSome(transition)
      ? yield* Atom.get(transition.value.isPending)
      : false;

    return (
      <nav data-cy="nav" data-pending={pending ? "true" : "false"}>
        <Link data-cy="nav-home" href="/">
          Home
        </Link>
        {" | "}
        <Link data-cy="nav-slow" href="/slow">
          Slow
        </Link>
        {" | "}
        <Link data-cy="nav-fast" href="/fast">
          Fast
        </Link>
        {pending && <span data-cy="nav-loading"> Loading...</span>}
      </nav>
    );
  });

// =============================================================================
// App Shell
// =============================================================================

const App = () => (
  <div data-cy="transition-app">
    <h1>Transition Test</h1>
    <Nav />
    <hr />
    <Suspense fallback={<div data-cy="suspense-fallback">Loading route...</div>}>
      <RouterOutlet />
    </Suspense>
  </div>
);

// =============================================================================
// Layer Composition
// =============================================================================

const routerLayer = pipe(
  NavigatorLive(AppRouter),
  Layer.provideMerge(BrowserHistoryLive),
  Layer.provideMerge(AppHandlersLive),
  Layer.provideMerge(TransitionLive),
);

// =============================================================================
// Bootstrap
// =============================================================================

// Redirect if landing on the HTML file path directly
if (window.location.pathname === "/transition-test.html") {
  window.history.replaceState(null, "", "/");
}

Effect.gen(function* () {
  const root = pipe(
    document.getElementById("root"),
    Option.fromNullable,
    Option.getOrThrow,
  );

  return yield* render(<App />, root, { layer: routerLayer });
}).pipe(
  Effect.catchAllDefect((e) => Effect.log(e)),
  BrowserPlatform.BrowserRuntime.runMain,
);
