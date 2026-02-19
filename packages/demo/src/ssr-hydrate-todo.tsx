import * as Effect from "effect/Effect";
import * as BrowserPlatform from "@effect/platform-browser";
import { Hydration } from "@effect-atom/atom";
import { render } from "fibrae";
import { TodoApp } from "./ssr-app.js";

declare global {
  interface Window {
    __FIBRAE_STATE__?: ReadonlyArray<Hydration.DehydratedAtom>;
  }
}

const container = document.getElementById("root") as HTMLElement;
const initialState = window.__FIBRAE_STATE__;

// Run the hydration
render(<TodoApp />, container, {
  initialState,
}).pipe(
  Effect.catchAllDefect((e) => Effect.log("Hydration error:", e)),
  BrowserPlatform.BrowserRuntime.runMain,
);
