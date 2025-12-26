/**
 * History service - track and manage browser navigation history.
 *
 * Features:
 * - Current location (pathname, search, hash, state)
 * - Navigation methods (push, replace, back, forward, go)
 * - BrowserHistoryLive - real browser history with popstate handling
 * - MemoryHistoryLive - in-memory history for testing/SSR
 * - Cleanly manages event listeners with Effect finalizers
 *
 * Design:
 * - Uses Atom for reactive location updates
 * - Browser history: listens to window.popstate for back/forward
 * - Memory history: in-memory stack, useful for SSR/testing
 * - All navigation returns Effects, integrates with Effect runtime
 */

import * as Effect from "effect/Effect";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import { Atom, Registry as AtomRegistry } from "@effect-atom/atom";

// =============================================================================
// Types
// =============================================================================

/**
 * Current location - pathname, search, hash, and state.
 */
export interface HistoryLocation {
  readonly pathname: string;
  readonly search: string;
  readonly hash: string;
  readonly state?: unknown;
}

/**
 * History service interface.
 * Provides location access and navigation methods.
 */
export interface HistoryService {
  /**
   * Current location atom - reactive and serializable.
   */
  readonly location: Atom.Writable<HistoryLocation, HistoryLocation>;

  /**
   * Navigate to a new location (push new entry).
   */
  readonly push: (path: string, state?: unknown) => Effect.Effect<void, never, AtomRegistry.AtomRegistry>;

  /**
   * Replace current location (same entry).
   */
  readonly replace: (path: string, state?: unknown) => Effect.Effect<void, never, AtomRegistry.AtomRegistry>;

  /**
   * Go back in history.
   */
  readonly back: Effect.Effect<void, never, never>;

  /**
   * Go forward in history.
   */
  readonly forward: Effect.Effect<void, never, never>;

  /**
   * Go n entries in history.
   */
  readonly go: (n: number) => Effect.Effect<void, never, never>;

  /**
   * Check if can go back (optional, simplified version).
   */
  readonly canGoBack: Effect.Effect<boolean, never, never>;
}

// =============================================================================
// Service Tag
// =============================================================================

/**
 * History service tag for Effect dependency injection.
 */
export class History extends Context.Tag("lumon/History")<History, HistoryService>() {}

// =============================================================================
// Browser History Implementation
// =============================================================================

/**
 * Get current browser location.
 */
function getBrowserLocation(): HistoryLocation {
  return {
    pathname: window.location.pathname,
    search: window.location.search,
    hash: window.location.hash,
    state: window.history.state,
  };
}

/**
 * Parse path into location object.
 */
function parseLocation(path: string, state?: unknown): HistoryLocation {
  try {
    const url = new URL(path, window.location.origin);
    return {
      pathname: url.pathname,
      search: url.search,
      hash: url.hash,
      state,
    };
  } catch {
    return {
      pathname: path,
      search: "",
      hash: "",
      state,
    };
  }
}

/**
 * Browser history layer - real browser history with popstate handling.
 *
 * Features:
 * - Tracks current location in an Atom
 * - Listens to popstate for back/forward
 * - Provides push/replace/go navigation methods
 * - Cleanly removes event listener on scope close
 * - Properly cleans up event listeners on scope close
 */
/* is-tree-shakable-suppress */
export const BrowserHistoryLive: Layer.Layer<History, never, AtomRegistry.AtomRegistry> = Layer.scoped(
  History,
  Effect.gen(function* () {
    const registry = yield* AtomRegistry.AtomRegistry;

    // Create location atom with initial browser location
    const locationAtom = Atom.make(getBrowserLocation());

    // Subscribe to popstate for browser back/forward
    const handlePopState = () => {
      registry.set(locationAtom, getBrowserLocation());
    };

    window.addEventListener("popstate", handlePopState);

    // Cleanup on scope close
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        window.removeEventListener("popstate", handlePopState);
      })
    );

    // Track history index for canGoBack (simplified approach)
    let historyIndex = 0;

    const service: HistoryService = {
      location: locationAtom,

      push: (path, state) =>
        Effect.sync(() => {
          const location = parseLocation(path, state);
          const href = `${location.pathname}${location.search}${location.hash}`;
          window.history.pushState(state, "", href);
          historyIndex++;
          registry.set(locationAtom, {
            ...location,
            state,
          });
        }),

      replace: (path, state) =>
        Effect.sync(() => {
          const location = parseLocation(path, state);
          const href = `${location.pathname}${location.search}${location.hash}`;
          window.history.replaceState(state, "", href);
          registry.set(locationAtom, {
            ...location,
            state,
          });
        }),

      back: Effect.sync(() => {
        window.history.back();
        // Note: popstate handler will update location
      }),

      forward: Effect.sync(() => {
        window.history.forward();
        // Note: popstate handler will update location
      }),

      go: (n) =>
        Effect.sync(() => {
          window.history.go(n);
          // Note: popstate handler will update location
        }),

      canGoBack: Effect.sync(() => historyIndex > 0),
    };

    return service;
  })
);

// =============================================================================
// Memory History Implementation
// =============================================================================

/**
 * Options for creating memory history.
 */
export interface MemoryHistoryOptions {
  /** Initial location (defaults to "/") */
  readonly initialPathname?: string;
  /** Initial search params (defaults to "") */
  readonly initialSearch?: string;
  /** Initial hash (defaults to "") */
  readonly initialHash?: string;
  /** Initial state (defaults to undefined) */
  readonly initialState?: unknown;
}

/**
 * Create a memory history layer - useful for testing/SSR.
 *
 * Features:
 * - In-memory navigation stack
 * - Tracks current location in an Atom
 * - No browser API usage (safe for SSR/testing)
 * - Supports push/replace/back/forward/go navigation
 * - Optional initial location/state configuration
 */
export function MemoryHistoryLive(
  options: MemoryHistoryOptions = {}
): Layer.Layer<History, never, AtomRegistry.AtomRegistry> {
  return Layer.scoped(
    History,
    Effect.gen(function* () {
      const registry = yield* AtomRegistry.AtomRegistry;

      // Create location atom with initial location
      const initialLocation: HistoryLocation = {
        pathname: options.initialPathname ?? "/",
        search: options.initialSearch ?? "",
        hash: options.initialHash ?? "",
        state: options.initialState,
      };
      const locationAtom = Atom.make(initialLocation);

      // Track history stack for back/forward
      const historyStack: HistoryLocation[] = [initialLocation];
      let historyIndex = 0;

      const service: HistoryService = {
        location: locationAtom,

        push: (path, state) =>
          Effect.sync(() => {
            const location = parseLocation(path, state);
            // Remove entries after current index
            historyStack.splice(historyIndex + 1);
            // Add new entry
            historyStack.push(location);
            historyIndex = historyStack.length - 1;
            registry.set(locationAtom, location);
          }),

        replace: (path, state) =>
          Effect.sync(() => {
            const location = parseLocation(path, state);
            // Replace current entry
            historyStack[historyIndex] = location;
            registry.set(locationAtom, location);
          }),

        back: Effect.sync(() => {
          if (historyIndex > 0) {
            historyIndex--;
            registry.set(locationAtom, historyStack[historyIndex]);
          }
        }),

        forward: Effect.sync(() => {
          if (historyIndex < historyStack.length - 1) {
            historyIndex++;
            registry.set(locationAtom, historyStack[historyIndex]);
          }
        }),

        go: (n) =>
          Effect.sync(() => {
            const newIndex = historyIndex + n;
            if (newIndex >= 0 && newIndex < historyStack.length) {
              historyIndex = newIndex;
              registry.set(locationAtom, historyStack[historyIndex]);
            }
          }),

        canGoBack: Effect.sync(() => historyIndex > 0),
      };

      return service;
    })
  );
}

// =============================================================================
// Convenience Accessors
// =============================================================================

/**
 * Get current location.
 */
/* is-tree-shakable-suppress */
export const getLocation: Effect.Effect<HistoryLocation, never, History | AtomRegistry.AtomRegistry> =
  Effect.gen(function* () {
    const history = yield* History;
    return yield* Atom.get(history.location);
  });

/**
 * Push a new location.
 */
export const push = (
  path: string,
  state?: unknown
): Effect.Effect<void, never, History | AtomRegistry.AtomRegistry> =>
  Effect.gen(function* () {
    const history = yield* History;
    yield* history.push(path, state);
  });

/**
 * Replace current location.
 */
export const replace = (
  path: string,
  state?: unknown
): Effect.Effect<void, never, History | AtomRegistry.AtomRegistry> =>
  Effect.gen(function* () {
    const history = yield* History;
    yield* history.replace(path, state);
  });

/**
 * Go back in history.
 */
/* is-tree-shakable-suppress */
export const back: Effect.Effect<void, never, History> = Effect.gen(function* () {
  const history = yield* History;
  yield* history.back;
});

/**
 * Go forward in history.
 */
/* is-tree-shakable-suppress */
export const forward: Effect.Effect<void, never, History> = Effect.gen(
  function* () {
    const history = yield* History;
    yield* history.forward;
  }
);

/**
 * Go n entries in history.
 */
export const go = (
  n: number
): Effect.Effect<void, never, History> =>
  Effect.gen(function* () {
    const history = yield* History;
    yield* history.go(n);
  });
