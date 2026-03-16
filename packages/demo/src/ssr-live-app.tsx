import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Atom } from "fibrae";
import * as LiveSync from "fibrae/live";

// =============================================================================
// Shared: Channel definition (used by both server and client)
// =============================================================================

export const ClockAtom = Atom.make("");

export const ClockChannel = LiveSync.channel({
  name: "clock",
  schema: Schema.String,
  atom: ClockAtom,
});

// =============================================================================
// Component
// =============================================================================

export const LiveClock = () =>
  Effect.gen(function* () {
    yield* LiveSync.connect(ClockChannel, { url: "/api/live/clock" });
    const time = yield* Atom.get(ClockAtom);

    return (
      <div data-cy="live-clock">
        <h1>LiveSync Clock</h1>
        <p data-cy="live-time">{time || "Connecting..."}</p>
      </div>
    );
  });

export const LiveApp = () => (
  <div>
    <LiveClock />
  </div>
);
