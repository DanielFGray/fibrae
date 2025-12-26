/**
 * Minimal reproduction: ErrorBoundary + Stream that fails before first emission
 */
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Option from "effect/Option";
import * as Logger from "effect/Logger";
import * as LogLevel from "effect/LogLevel";
import { pipe } from "effect/Function";
import { render, ErrorBoundary } from "lumon";

// Stream that fails immediately before emitting anything
const StreamFailerImmediate = () => {
  console.log("StreamFailerImmediate: creating stream that fails immediately");
  return Stream.fromEffect(Effect.fail(new Error("stream-crash-immediate")));
};

const App = () => (
  <div>
    <h2>Test: Stream fails before first emission</h2>
    <ErrorBoundary fallback={<div data-cy="fallback">Error caught! Fallback rendered.</div>}>
      <StreamFailerImmediate />
    </ErrorBoundary>
  </div>
);

Effect.gen(function*() {
  const root = pipe(
    document.getElementById("root"),
    Option.fromNullable,
    Option.getOrThrow
  );

  console.log("Starting render...");
  yield* render(<App />, root);
  console.log("Render returned (should wait on Effect.never internally)");

  return yield* Effect.never;
}).pipe(
  Effect.catchAllDefect((e) => {
    console.error("Defect caught:", e);
    return Effect.never;
  }),
  Effect.provide(Logger.minimumLogLevel(LogLevel.Debug)),
  Effect.runFork
);
