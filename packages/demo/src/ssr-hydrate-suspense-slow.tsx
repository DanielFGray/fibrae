/**
 * Client-side hydration entry for Slow Suspense SSR scenario
 * Tests the fallback marker flow: SSR renders fallback, client swaps to real content
 */
import * as Effect from "effect/Effect";
import * as BrowserPlatform from "@effect/platform-browser";
import { render } from "@didact/core";
import { SlowSuspenseApp } from "./ssr-app.js";

declare global {
  interface Window {
    __DIDACT_STATE__?: ReadonlyArray<unknown>;
  }
}

const container = document.getElementById("root") as HTMLElement;
const initialState = window.__DIDACT_STATE__;

// Run the hydration
render(<SlowSuspenseApp />, container, { 
  initialState: initialState as Parameters<typeof render>[2]["initialState"] 
}).pipe(
  Effect.catchAllDefect((e) => Effect.log("Hydration defect:", e)),
  BrowserPlatform.BrowserRuntime.runMain,
);
