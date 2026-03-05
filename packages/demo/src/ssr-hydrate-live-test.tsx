import * as Effect from "effect/Effect"
import { Layer } from "effect"
import * as BrowserPlatform from "@effect/platform-browser"
import { render } from "fibrae"
import { LiveConfig } from "fibrae/live"
import { LiveTestApp } from "./ssr-live-test-app.js"

const container = document.getElementById("root") as HTMLElement

const liveLayer = Layer.succeed(
  LiveConfig,
  LiveConfig.make({
    baseUrl: "/api/live/test-multi",
    channels: {
      "single-clock": "/api/live/test-clock",
    },
  }),
)

render(<LiveTestApp />, container, { layer: liveLayer }).pipe(
  Effect.catchAllDefect((e) => Effect.log("Hydration error:", e)),
  BrowserPlatform.BrowserRuntime.runMain,
)
