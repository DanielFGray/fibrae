import * as Effect from "effect/Effect"
import * as BrowserPlatform from "@effect/platform-browser"
import { render } from "fibrae"
import { LiveApp } from "./ssr-live-app.js"

const container = document.getElementById("root") as HTMLElement

render(<LiveApp />, container).pipe(
  Effect.catchAllDefect((e) => Effect.log("Hydration error:", e)),
  BrowserPlatform.BrowserRuntime.runMain,
)
