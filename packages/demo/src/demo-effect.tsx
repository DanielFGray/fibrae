import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as BrowserPlatform from "@effect/platform-browser";
import { pipe } from "effect/Function";
import { render, Suspense, ErrorBoundary } from "@didact/core";
import {
  StaticHeader,
  StreamCounter,
  StreamCounterFallback,
  Counter,
  TodoList,
} from "./components.js";

// Simple error fallback component
const ErrorFallback = (props: { section: string }) => (
  <div style="padding: 1rem; background: #ff4444; color: white; border-radius: 4px; margin: 0.5rem 0;">
    Error in {props.section}
  </div>
);

Effect.gen(function*() {
  const root = pipe(document.getElementById("root"), Option.fromNullable, Option.getOrThrow);

  // Create containers for each section
  const staticContainer = document.createElement("div");
  staticContainer.setAttribute('id', "static-container");
  root.appendChild(staticContainer);

  const counterContainer = document.createElement("div");
  counterContainer.setAttribute('id', "counter-container");
  root.appendChild(counterContainer);

  const todoContainer = document.createElement("div");
  todoContainer.setAttribute('id', "todo-container");
  root.appendChild(todoContainer);

  const streamContainer = document.createElement("div");
  streamContainer.setAttribute('id', "stream-container");
  root.appendChild(streamContainer);

  // Fork each render independently for parallel execution
  // Each section wrapped in ErrorBoundary so errors don't crash sibling sections
  yield* Effect.fork(render(
    <ErrorBoundary fallback={<ErrorFallback section="Static Header" />}>
      <StaticHeader />
    </ErrorBoundary>,
    staticContainer
  ));
  
  yield* Effect.fork(render(
    <ErrorBoundary fallback={<ErrorFallback section="Stream Counter" />}>
      <Suspense fallback={<StreamCounterFallback />}>
        <StreamCounter />
      </Suspense>
    </ErrorBoundary>,
    streamContainer
  ));
  
  yield* Effect.fork(render(
    <ErrorBoundary fallback={<ErrorFallback section="Counters" />}>
      <Counter label="Counter A" />
      <Counter label="Counter B" />
    </ErrorBoundary>,
    counterContainer
  ));
  
  yield* Effect.fork(render(
    <ErrorBoundary fallback={<ErrorFallback section="Todo List" />}>
      <TodoList />
    </ErrorBoundary>,
    todoContainer
  ));

  return yield* Effect.never;
}).pipe(
  Effect.catchAllDefect((e) => Effect.log(e)),
  BrowserPlatform.BrowserRuntime.runMain,
);
