import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Atom, Result } from "fibrae";
import * as LiveSync from "fibrae/live";

// =============================================================================
// Live Atoms: single-channel test
// =============================================================================

export const SingleClockAtom = LiveSync.live("single-clock", {
  schema: Schema.String,
});

// =============================================================================
// Live Atoms: multi-channel test
// =============================================================================

export const MultiClockAtom = LiveSync.live("clock", {
  schema: Schema.String,
  key: "multi-clock",
});

export const MultiCounterAtom = LiveSync.live("counter", {
  schema: Schema.Number,
  key: "multi-counter",
});

// =============================================================================
// Components
// =============================================================================

const LiveSingle = () =>
  Effect.gen(function* () {
    const clock = yield* Atom.get(SingleClockAtom);

    return (
      <div data-cy="live-single">
        <h2>Single Channel (live atom)</h2>
        <p data-cy="single-clock">{Result.isSuccess(clock) ? clock.value : "Connecting..."}</p>
      </div>
    );
  });

const LiveMulti = () =>
  Effect.gen(function* () {
    const clock = yield* Atom.get(MultiClockAtom);
    const counter = yield* Atom.get(MultiCounterAtom);

    return (
      <div data-cy="live-multi">
        <h2>Multi Channel (live atoms)</h2>
        <p data-cy="multi-clock">{Result.isSuccess(clock) ? clock.value : "Connecting..."}</p>
        <p data-cy="multi-counter">{Result.isSuccess(counter) ? String(counter.value) : "0"}</p>
      </div>
    );
  });

export const LiveTestApp = () => (
  <div data-cy="live-test-app">
    <h1>LiveSync Integration Test</h1>
    <LiveSingle />
    <LiveMulti />
  </div>
);
