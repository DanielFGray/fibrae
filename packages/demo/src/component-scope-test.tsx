import * as Effect from "effect/Effect";
import * as Scope from "effect/Scope";
import * as Deferred from "effect/Deferred";
import * as Option from "effect/Option";
import * as Logger from "effect/Logger";
import * as LogLevel from "effect/LogLevel";
import * as BrowserPlatform from "@effect/platform-browser";
import { pipe } from "effect/Function";
import { render, Atom, AtomRegistry, ComponentScope } from "fibrae";

// Expose cleanup tracking to window for Cypress
declare global {
  interface Window {
    cleanupLog: string[];
  }
}
window.cleanupLog = [];

// Atom to control whether the cleanup component is shown
const showCleanupAtom = Atom.make(true);

// Atom to control which child is shown (A or B)
const whichChildAtom = Atom.make<"A" | "B">("A");

// Atom to control showing the multi-finalizer component
const showMultiAtom = Atom.make(true);

// Atom to control showing the mounted component
const showMountedAtom = Atom.make(true);

// Component that registers a cleanup finalizer
const CleanupComponent = () =>
  Effect.gen(function* () {
    const { scope } = yield* ComponentScope;

    // Register cleanup that runs on unmount
    yield* Scope.addFinalizer(
      scope,
      Effect.sync(() => {
        window.cleanupLog.push("CleanupComponent unmounted");
      }),
    );

    return (
      <div data-cy="cleanup-component">
        <p>I have cleanup logic registered</p>
      </div>
    );
  });

// Child A with cleanup
const ChildA = () =>
  Effect.gen(function* () {
    const { scope } = yield* ComponentScope;
    yield* Scope.addFinalizer(
      scope,
      Effect.sync(() => {
        window.cleanupLog.push("ChildA cleanup");
      }),
    );
    return <span data-cy="child-a">Child A</span>;
  });

// Child B with cleanup
const ChildB = () =>
  Effect.gen(function* () {
    const { scope } = yield* ComponentScope;
    yield* Scope.addFinalizer(
      scope,
      Effect.sync(() => {
        window.cleanupLog.push("ChildB cleanup");
      }),
    );
    return <span data-cy="child-b">Child B</span>;
  });

// Component with multiple finalizers to test LIFO order
const MultiFinalizer = () =>
  Effect.gen(function* () {
    const { scope } = yield* ComponentScope;

    // Register multiple finalizers - they should run in reverse order (LIFO)
    yield* Scope.addFinalizer(
      scope,
      Effect.sync(() => window.cleanupLog.push("multi-1")),
    );
    yield* Scope.addFinalizer(
      scope,
      Effect.sync(() => window.cleanupLog.push("multi-2")),
    );
    yield* Scope.addFinalizer(
      scope,
      Effect.sync(() => window.cleanupLog.push("multi-3")),
    );

    return <div data-cy="multi-finalizer">Multiple finalizers registered</div>;
  });

// Component that uses mounted Deferred to run code after DOM commit
const MountedComponent = () =>
  Effect.gen(function* () {
    const { scope, mounted } = yield* ComponentScope;
    // Use object ref (fibrae doesn't support function refs)
    const containerRef: { current: HTMLDivElement | null } = { current: null };

    // Fork an effect that waits for mount, then checks DOM is available
    yield* pipe(
      Effect.gen(function* () {
        yield* Deferred.await(mounted);
        // DOM should be available now
        const domExists = containerRef.current !== null;
        window.cleanupLog.push(`mounted: DOM element ${domExists ? "exists" : "missing"}`);

        // Register cleanup in the mounted callback
        yield* Scope.addFinalizer(
          scope,
          Effect.sync(() => window.cleanupLog.push("mounted cleanup")),
        );
      }),
      Effect.forkScoped,
      Scope.extend(scope),
    );
    return (
      <div data-cy="mounted-component" ref={containerRef}>
        Component with mounted callback
      </div>
    );
  });

// Parent that conditionally renders CleanupComponent
const ConditionalCleanup = () =>
  Effect.gen(function* () {
    const registry = yield* AtomRegistry.AtomRegistry;
    const show = registry.get(showCleanupAtom);

    return (
      <div data-cy="conditional-container">
        {show ? (
          <CleanupComponent />
        ) : (
          <div data-cy="component-removed">Component was removed</div>
        )}
      </div>
    );
  });

// Parent that switches between ChildA and ChildB
const SwitchingParent = () =>
  Effect.gen(function* () {
    const registry = yield* AtomRegistry.AtomRegistry;
    const which = registry.get(whichChildAtom);

    return (
      <div data-cy="switching-container">
        {which === "A" ? <ChildA /> : <ChildB />}
      </div>
    );
  });

// Parent that conditionally shows MultiFinalizer
const ConditionalMulti = () =>
  Effect.gen(function* () {
    const registry = yield* AtomRegistry.AtomRegistry;
    const show = registry.get(showMultiAtom);

    return (
      <div data-cy="multi-container">
        {show ? (
          <MultiFinalizer />
        ) : (
          <div data-cy="multi-removed">Multi removed</div>
        )}
      </div>
    );
  });

// Parent that conditionally shows MountedComponent
const ConditionalMounted = () =>
  Effect.gen(function* () {
    const registry = yield* AtomRegistry.AtomRegistry;
    const show = registry.get(showMountedAtom);

    return (
      <div data-cy="mounted-container">
        {show ? (
          <MountedComponent />
        ) : (
          <div data-cy="mounted-removed">Mounted removed</div>
        )}
      </div>
    );
  });

// Control buttons
const Controls = () =>
  Effect.gen(function* () {
    const registry = yield* AtomRegistry.AtomRegistry;

    return (
      <div data-cy="controls" style="margin-bottom: 2rem; padding: 1rem; background: #333; border-radius: 8px;">
        <h3>Test Controls</h3>
        <div style="display: flex; gap: 1rem; flex-wrap: wrap;">
          <button
            data-cy="toggle-cleanup"
            onClick={() => registry.update(showCleanupAtom, (v: boolean) => !v)}
          >
            Toggle Cleanup Component
          </button>
          <button
            data-cy="switch-child"
            onClick={() =>
              registry.update(whichChildAtom, (v: "A" | "B") => (v === "A" ? "B" : "A"))
            }
          >
            Switch Child (A/B)
          </button>
          <button
            data-cy="toggle-multi"
            onClick={() => registry.update(showMultiAtom, (v: boolean) => !v)}
          >
            Toggle Multi-Finalizer
          </button>
          <button
            data-cy="toggle-mounted"
            onClick={() => registry.update(showMountedAtom, (v: boolean) => !v)}
          >
            Toggle Mounted
          </button>
          <button
            data-cy="clear-log"
            onClick={() => {
              window.cleanupLog = [];
            }}
          >
            Clear Log
          </button>
        </div>
      </div>
    );
  });

// Log display
const LogDisplay = () => {
  // Re-render periodically to show log updates
  // Using a simple stream that emits every 100ms
  return (
    <div data-cy="log-display" style="padding: 1rem; background: #222; border-radius: 8px;">
      <h3>Cleanup Log</h3>
      <p style="color: #999; font-size: 0.9em;">
        Check window.cleanupLog in console or via Cypress
      </p>
      <pre data-cy="log-content" style="background: #111; padding: 1rem; border-radius: 4px; overflow-x: auto;">
        {JSON.stringify(window.cleanupLog, null, 2)}
      </pre>
    </div>
  );
};

// Main App
const App = () => (
  <div style="max-width: 800px; margin: 0 auto; padding: 2rem;">
    <h1>ComponentScope Test</h1>
    <p style="color: #999; margin-bottom: 2rem;">
      Tests that ComponentScope allows components to register cleanup finalizers
      that run when the component unmounts.
    </p>

    <Controls />

    <div style="display: grid; gap: 1rem;">
      <section>
        <h2>Test 1: Conditional Render</h2>
        <p style="color: #999;">Toggle removes component, should log cleanup</p>
        <ConditionalCleanup />
      </section>

      <section>
        <h2>Test 2: Switching Children</h2>
        <p style="color: #999;">Switching replaces one child with another</p>
        <SwitchingParent />
      </section>

      <section>
        <h2>Test 3: Multiple Finalizers (LIFO)</h2>
        <p style="color: #999;">Multiple finalizers should run in reverse order</p>
        <ConditionalMulti />
      </section>

      <section>
        <h2>Test 4: Mounted Deferred</h2>
        <p style="color: #999;">Code awaiting mounted runs after DOM commit</p>
        <ConditionalMounted />
      </section>

      <LogDisplay />
    </div>
  </div>
);

// Main entry point
Effect.gen(function* () {
  const root = pipe(document.getElementById("root"), Option.fromNullable, Option.getOrThrow);

  return yield* render(<App />, root);
}).pipe(
  Effect.catchAllDefect((e) => Effect.flatMap(Effect.log(e), () => Effect.never)),
  Effect.provide(Logger.minimumLogLevel(LogLevel.Debug)),
  BrowserPlatform.BrowserRuntime.runMain,
);
