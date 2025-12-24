import * as Effect from "effect/Effect";
import * as BrowserPlatform from "@effect/platform-browser";
import { render } from "@didact/core";
import { App } from "./ssr-app.js";

declare global {
  interface Window {
    __DIDACT_STATE__?: ReadonlyArray<unknown>;
  }
}

const container = document.getElementById("root") as HTMLElement;
const initialState = window.__DIDACT_STATE__;

// Run the hydration
Effect.gen(function* () {
  // Fork the render (it never returns, so we fork it)
  // Cast initialState to the expected type (it's serialized from the server)
  yield* Effect.fork(render(<App />, container, { initialState: initialState as Parameters<typeof render>[2]["initialState"] }));

  // Give render a moment to complete initial DOM work
  yield* Effect.sleep("10 millis");

  // Mark hydration complete for testing
  container.setAttribute("data-hydrated", "true");

  // Keep running forever
  return yield* Effect.never;
}).pipe(
  Effect.catchAllDefect((e) => Effect.log("Hydration error:", e)),
  BrowserPlatform.BrowserRuntime.runMain,
);
