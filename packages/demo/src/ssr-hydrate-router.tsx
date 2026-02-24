/**
 * SSR Router Hydration Entry Point
 *
 * This file is loaded by the browser after SSR.
 * It hydrates the server-rendered content and enables client-side navigation.
 *
 * The RouterStateAtom is automatically hydrated from the
 * <script type="application/json" id="__fibrae-state__"> tag via the HydrationState service.
 */

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as BrowserPlatform from "@effect/platform-browser";
import { h, render } from "fibrae";
import { Router } from "fibrae/router";
import { SSRRouter, App, RouterOutlet, createSSRRouterHandlers } from "./ssr-router-app.js";

// Create handler layer (client-side loaders)
const handlersLayer = createSSRRouterHandlers(false);

// Create browser layer - reads from hydrated RouterStateAtom
// basePath matches the server mount point (/ssr/router)
const browserLayer = Router.browserLayer({
  router: SSRRouter,
  basePath: "/ssr/router",
});

// Get container
const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element not found");
}

// Combined layer: RouterHandlers -> browserLayer
// Note: AtomRegistry is provided by render(), not here
const routerLayer = Layer.provideMerge(browserLayer, handlersLayer);

// Run hydration
console.log("[ssr-hydrate-router] Starting hydration");
Effect.gen(function* () {
  // Create RouterOutlet - it will read from hydrated RouterStateAtom
  const outlet = h(RouterOutlet, {});

  // Wrap in App shell
  const app = h(App, {}, [outlet]);

  // Render (hydrate) the app with router layer
  // render() automatically provides FibraeRuntime + AtomRegistry
  // HydrationState is auto-discovered from the script tag
  yield* Effect.log("Hydrating SSR router app");
  return yield* render(app, container, {
    layer: routerLayer,
  });
}).pipe(
  Effect.catchAllDefect((e) => {
    console.error("Hydration error:", e);
    return Effect.log(e);
  }),
  BrowserPlatform.BrowserRuntime.runMain,
);
