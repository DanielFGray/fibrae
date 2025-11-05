import { h } from "@didact/core";
import { renderToStringPromise } from "@didact/core/server";
import { App } from "./components-ssr.js";

const appElement = h(App);
const body = await renderToStringPromise(appElement);

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

// SSR output to stdout (not Effect-based, intentional for pipe redirection)
process.stdout.write(html);
