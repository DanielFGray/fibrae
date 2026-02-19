/**
 * Client-side hydration entry for Slow Suspense SSR scenario
 * Tests the fallback marker flow: SSR renders fallback, client swaps to real content
 */
import * as Effect from "effect/Effect";
import * as BrowserPlatform from "@effect/platform-browser";
import { Hydration } from "@effect-atom/atom";
import { render } from "fibrae";
import { SlowSuspenseApp } from "./ssr-app.js";

declare global {
  interface Window {
    __FIBRAE_STATE__?: ReadonlyArray<Hydration.DehydratedAtom>;
  }
}

const container = document.getElementById("root") as HTMLElement;
const initialState = window.__FIBRAE_STATE__;

// Run the hydration
render(<SlowSuspenseApp />, container, {
  initialState,
}).pipe(
  Effect.catchAllDefect((e) => Effect.log("Hydration defect:", e)),
  BrowserPlatform.BrowserRuntime.runMain,
);
