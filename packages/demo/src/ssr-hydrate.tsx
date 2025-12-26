import * as Effect from "effect/Effect";
import * as BrowserPlatform from "@effect/platform-browser";
import { render } from "lumon";
import { App } from "./ssr-app.js";

declare global {
  interface Window {
    __LUMON_STATE__?: ReadonlyArray<unknown>;
  }
}

const container = document.getElementById("root") as HTMLElement;
const initialState = window.__LUMON_STATE__;

// Run the hydration
render(<App />, container, { initialState: initialState as Parameters<typeof render>[2]["initialState"] }).pipe(
  Effect.catchAllDefect((e) => Effect.log("Hydration error:", e)),
  BrowserPlatform.BrowserRuntime.runMain,
);
