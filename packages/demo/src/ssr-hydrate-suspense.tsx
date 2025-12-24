/**
 * Client-side hydration entry for Suspense SSR scenario
 */
import * as Effect from "effect/Effect";
import * as BrowserPlatform from "@effect/platform-browser";
import { render } from "@didact/core";
import { SuspenseApp } from "./ssr-app.js";

declare global {
  interface Window {
    __DIDACT_STATE__?: ReadonlyArray<unknown>;
  }
}

const container = document.getElementById("root") as HTMLElement;
const initialState = window.__DIDACT_STATE__;

// Run the hydration - render() sets data-hydrated when complete
render(<SuspenseApp />, container, { 
  initialState: initialState as Parameters<typeof render>[2]["initialState"] 
}).pipe(
  Effect.catchAllDefect((e) => Effect.log("Hydration defect:", e)),
  BrowserPlatform.BrowserRuntime.runMain,
);
