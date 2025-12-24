import * as Effect from "effect/Effect";
import * as BrowserPlatform from "@effect/platform-browser";
import { render } from "@didact/core";
import { TodoApp } from "./ssr-app.js";

declare global {
  interface Window {
    __DIDACT_STATE__?: ReadonlyArray<unknown>;
  }
}

const container = document.getElementById("root") as HTMLElement;
const initialState = window.__DIDACT_STATE__;

// Run the hydration
render(<TodoApp />, container, { initialState: initialState as Parameters<typeof render>[2]["initialState"] }).pipe(
  Effect.catchAllDefect((e) => Effect.log("Hydration error:", e)),
  BrowserPlatform.BrowserRuntime.runMain,
);
