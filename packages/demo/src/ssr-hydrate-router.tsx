/**
 * SSR Router Hydration Entry Point
 * 
 * This file is loaded by the browser after SSR.
 * It hydrates the server-rendered content and enables client-side navigation.
 */

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as BrowserPlatform from "@effect/platform-browser";
import { h, render } from "@didact/core";
import { Hydration } from "@effect-atom/atom";
import { Router, type DehydratedRouterState } from "@didact/core/router";
import {
  SSRRouter,
  App,
  RouterOutlet,
  createSSRRouterHandlers,
} from "./ssr-router-app.js";

// Declare global for TypeScript
declare global {
  interface Window {
    __DIDACT_ROUTER__?: DehydratedRouterState;
    __DIDACT_STATE__?: ReadonlyArray<Hydration.DehydratedAtom>;
  }
}

// Get initial state from SSR
const initialRouterState = window.__DIDACT_ROUTER__;
const initialAtomState = window.__DIDACT_STATE__;

// Create handler layer (client-side loaders)
const handlersLayer = createSSRRouterHandlers(false);

// Create browser layer with initial state (skips initial loader)
// basePath matches the server mount point (/ssr/router)
const browserLayer = Router.browserLayer({
  router: SSRRouter,
  initialState: initialRouterState,
  basePath: "/ssr/router",
});

// Get container
const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element not found");
}

// Combined layer: RouterHandlers -> browserLayer
// Note: AtomRegistry is provided by render(), not here
const routerLayer = Layer.provideMerge(
  browserLayer,
  handlersLayer
);

// Run hydration
Effect.gen(function* () {
  // Create RouterOutlet with initial SSR data to skip first loader
  const outlet = h(RouterOutlet, {
    initialLoaderData: initialRouterState?.loaderData,
    initialRouteName: initialRouterState?.routeName,
  });
  
  // Wrap in App shell
  const app = h(App, {}, [outlet]);
  
  // Render (hydrate) the app with router layer
  // render() automatically provides DidactRuntime + AtomRegistry
  // We pass routerLayer which needs AtomRegistry (provided by render)
  yield* render(app, container, {
    layer: routerLayer,
    initialState: initialAtomState,
  });
  
  yield* Effect.log(`Hydrated with initial route: ${initialRouterState?.routeName}`);
  
  return yield* Effect.never;
}).pipe(
  Effect.catchAllDefect((e) => {
    console.error("Hydration error:", e);
    return Effect.log(e);
  }),
  BrowserPlatform.BrowserRuntime.runMain
);
