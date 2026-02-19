/**
 * Client-side hydration entry for Suspense SSR scenario
 */
import * as Effect from "effect/Effect";
import * as BrowserPlatform from "@effect/platform-browser";
import { Hydration } from "@effect-atom/atom";
import { render } from "fibrae";
import { SuspenseApp } from "./ssr-app.js";

declare global {
  interface Window {
    __FIBRAE_STATE__?: ReadonlyArray<Hydration.DehydratedAtom>;
  }
}

const container = document.getElementById("root") as HTMLElement;
const initialState = window.__FIBRAE_STATE__;

// Run the hydration
render(<SuspenseApp />, container, {
  initialState,
}).pipe(
  Effect.catchAllDefect((e) => Effect.log("Hydration defect:", e)),
  BrowserPlatform.BrowserRuntime.runMain,
);
