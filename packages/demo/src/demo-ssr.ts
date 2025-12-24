import * as Effect from "effect/Effect";
import { BunRuntime } from "@effect/platform-bun";
import { h } from "@didact/core";
import { renderToString } from "@didact/core/server";
import { App } from "./components-ssr.js";

const program = Effect.gen(function* () {
  const appElement = h(App);
  const { html: body } = yield* renderToString(appElement);

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Didact SSR Demo</title>
</head>
<body>
  <div id="root">${body}</div>
</body>
</html>
`;

  // SSR output to stdout for pipe redirection
  process.stdout.write(html);
});

BunRuntime.runMain(program);
