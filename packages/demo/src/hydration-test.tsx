import * as Effect from "effect/Effect";
import * as BrowserPlatform from "@effect/platform-browser";
import { Atom, AtomRegistry, render } from "@didact/core";

// Define the counter atom
const countAtom = Atom.make(0);

// Counter component - same structure as pre-rendered HTML
const Counter = () => {
  return Effect.gen(function* () {
    const registry = yield* AtomRegistry.AtomRegistry;
    const count = registry.get(countAtom);

    return (
      <div>
        <p data-cy="hydration-count">{String(count)}</p>
        <button
          data-cy="hydration-button"
          onClick={() => registry.update(countAtom, (c: number) => c + 1)}
        >
          Click me
        </button>
      </div>
    );
  });
};

const container = document.getElementById("root") as HTMLElement;

// Run the hydration
Effect.gen(function* () {
  // Fork the render (it never returns, so we fork it)
  yield* Effect.fork(render(<Counter />, container));
  
  // Give render a moment to complete initial DOM work
  yield* Effect.sleep("10 millis");
  
  // Mark hydration complete
  container.setAttribute("data-hydrated", "true");
  
  // Keep running forever
  return yield* Effect.never;
}).pipe(
  Effect.catchAllDefect((e) => Effect.log("Hydration error:", e)),
  BrowserPlatform.BrowserRuntime.runMain,
);
