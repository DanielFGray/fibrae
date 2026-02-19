/**
 * Minimal reproduction: ErrorBoundary + Stream that fails before first emission
 */
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Option from "effect/Option";
import * as Logger from "effect/Logger";
import * as LogLevel from "effect/LogLevel";
import * as Schema from "effect/Schema";
import { pipe } from "effect/Function";
import { render, ErrorBoundary } from "fibrae";

// Test error for simulating failures in error handling tests
class TestFailure extends Schema.TaggedError<TestFailure>()("TestFailure", {
  message: Schema.String,
}) {}

// Stream that fails immediately before emitting anything
const StreamFailerImmediate = () => {
  console.log("StreamFailerImmediate: creating stream that fails immediately");
  return Stream.fromEffect(Effect.fail(new TestFailure({ message: "stream-crash-immediate" })));
};

// Wrap with ErrorBoundary and catch errors with Stream.catchTags
const SafeStreamFailer = () => ErrorBoundary(<StreamFailerImmediate />).pipe(
  Stream.catchTags({
    RenderError: () => Stream.succeed(<div data-cy="fallback">Error caught! Fallback rendered.</div>),
    StreamError: () => Stream.succeed(<div data-cy="fallback">Error caught! Fallback rendered.</div>),
    EventHandlerError: () => Stream.succeed(<div data-cy="fallback">Error caught! Fallback rendered.</div>),
  }),
);

const App = () => (
   <div>
     <h2>Test: Stream fails before first emission</h2>
     <SafeStreamFailer />
   </div>
);

Effect.gen(function* () {
  const root = pipe(document.getElementById("root"), Option.fromNullable, Option.getOrThrow);

  console.log("Starting render...");
  return yield* render(<App />, root);
}).pipe(
  Effect.catchAllDefect((e) => {
    console.error("Defect caught:", e);
    return Effect.never;
  }),
  Effect.provide(Logger.minimumLogLevel(LogLevel.Debug)),
  Effect.runFork,
);
