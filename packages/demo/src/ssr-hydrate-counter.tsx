import * as Effect from "effect/Effect";
import * as BrowserPlatform from "@effect/platform-browser";
import { render } from "fibrae";
import { CounterApp } from "./ssr-app.js";

const container = document.getElementById("root") as HTMLElement;

render(<CounterApp />, container).pipe(
  Effect.catchAllDefect((e) => Effect.log("Hydration error:", e)),
  BrowserPlatform.BrowserRuntime.runMain,
);
