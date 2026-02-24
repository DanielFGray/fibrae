/**
 * Client-side hydration entry for Suspense SSR scenario
 */
import * as Effect from "effect/Effect";
import * as BrowserPlatform from "@effect/platform-browser";
import { render } from "fibrae";
import { SuspenseApp } from "./ssr-app.js";

const container = document.getElementById("root") as HTMLElement;

render(<SuspenseApp />, container).pipe(
  Effect.catchAllDefect((e) => Effect.log("Hydration defect:", e)),
  BrowserPlatform.BrowserRuntime.runMain,
);
