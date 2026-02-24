/**
 * Client-side hydration entry for Slow Suspense SSR scenario
 * Tests the fallback marker flow: SSR renders fallback, client swaps to real content
 */
import * as Effect from "effect/Effect";
import * as BrowserPlatform from "@effect/platform-browser";
import { render } from "fibrae";
import { SlowSuspenseApp } from "./ssr-app.js";

const container = document.getElementById("root") as HTMLElement;

render(<SlowSuspenseApp />, container).pipe(
  Effect.catchAllDefect((e) => Effect.log("Hydration defect:", e)),
  BrowserPlatform.BrowserRuntime.runMain,
);
