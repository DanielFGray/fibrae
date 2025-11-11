import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as BrowserPlatform from "@effect/platform-browser";
import { pipe } from "effect/Function";
import { render, Suspense } from "@didact/core";
import {
  StaticHeader,
  StreamCounter,
  StreamCounterFallback,
  Counter,
  TodoList,
} from "./components.js";

console.log("demo-effect.tsx: Starting Effect.gen");

Effect.gen(function*() {
  console.log("demo-effect.tsx: Inside gen function");
  const root = pipe(document.getElementById("root"), Option.fromNullable, Option.getOrThrow)
  console.log("demo-effect.tsx: Found root element", root)

  // for testing purposes we are doing independent renderers to avoid crashing the whole app for one broken part
  // TODO: add error boundaries so we dont need this

  const staticContainer = document.createElement("div");
  staticContainer.setAttribute('id', "static-container");
  root.appendChild(staticContainer)

  const counterContainer = document.createElement("div");
  counterContainer.setAttribute('id', "counter-container");
  root.appendChild(counterContainer)

  const todoContainer = document.createElement("div");
  todoContainer.setAttribute('id', "todo-container");
  root.appendChild(todoContainer)

  const streamContainer = document.createElement("div");
  streamContainer.setAttribute('id', "stream-container");
  root.appendChild(streamContainer);

  const tsxContainer = document.createElement("div");
  tsxContainer.setAttribute('id', "tsx-container");
  root.appendChild(tsxContainer);

  // Fork each render independently since render() returns Effect.never
  console.log("demo-effect.tsx: About to fork renders");
  yield* Effect.fork(render(<StaticHeader />, staticContainer));
  console.log("demo-effect.tsx: Forked StaticHeader");
  yield* Effect.fork(render(<Suspense fallback={<StreamCounterFallback />}><StreamCounter /></Suspense>, streamContainer));
  console.log("demo-effect.tsx: Forked StreamCounter");
  yield* Effect.fork(render(<><Counter label={"Counter A"} /><Counter label={"Counter B"} /></>, counterContainer));
  console.log("demo-effect.tsx: Forked Counter");
  yield* Effect.fork(render(<TodoList />, todoContainer));
  console.log("demo-effect.tsx: Forked TodoList");

  return yield* Effect.never;
}).pipe(
  Effect.catchAllDefect((e) => Effect.log(e)),
  BrowserPlatform.BrowserRuntime.runMain,
);
