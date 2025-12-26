/**
 * History service - browser history abstraction.
 *
 * Effect service wrapping browser history API:
 * - push(path, state?), replace(path, state?)
 * - back, forward, go(n)
 * - location Atom with { pathname, search, hash }
 * - Memory history for SSR (static location from request URL)
 *
 * Design: History is a service, not global state.
 * Browser layer uses real history API. Server layer uses memory history.
 */

import * as Effect from "effect/Effect";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { Atom, Registry as AtomRegistry } from "@effect-atom/atom";

// =============================================================================
// Types
// =============================================================================

/**
 * Parsed location object representing current URL state.
 */
export interface HistoryLocation {
  readonly pathname: string;
  readonly search: string;
  readonly hash: string;
  readonly href: string;
  readonly state: unknown;
}

/**
 * History service interface.
 * Provides reactive location Atom and navigation Effects.
 */
export interface HistoryService {
  /**
   * Reactive location Atom - updates on navigation.
   */
  readonly location: Atom.Writable<HistoryLocation, HistoryLocation>;

  /**
   * Navigate to a new URL, adding to history stack.
   */
  readonly push: (path: string, state?: unknown) => Effect.Effect<void>;

  /**
   * Navigate to a new URL, replacing current history entry.
   */
  readonly replace: (path: string, state?: unknown) => Effect.Effect<void>;

  /**
   * Go back one entry in history.
   */
  readonly back: Effect.Effect<void>;

  /**
   * Go forward one entry in history.
   */
  readonly forward: Effect.Effect<void>;

  /**
   * Go n entries in history (negative = back, positive = forward).
   */
  readonly go: (n: number) => Effect.Effect<void>;

  /**
   * Check if back navigation is possible.
   */
  readonly canGoBack: Effect.Effect<boolean>;
}

// =============================================================================
// Service Tag
// =============================================================================

/**
 * History service tag for Effect dependency injection.
 */
export class History extends Context.Tag("@didact/router/History")<
  History,
  HistoryService
>() {}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Parse a URL/path into HistoryLocation.
 */
export function parseLocation(
  href: string,
  state: unknown = null
): HistoryLocation {
  // Handle relative paths
  const url = href.startsWith("/")
    ? new URL(href, "http://localhost")
    : new URL(href);

  return {
    pathname: url.pathname,
    search: url.search,
    hash: url.hash,
    href: `${url.pathname}${url.search}${url.hash}`,
    state,
  };
}

/**
 * Get current browser location.
 */
function getBrowserLocation(): HistoryLocation {
  return {
    pathname: window.location.pathname,
    search: window.location.search,
    hash: window.location.hash,
    href: `${window.location.pathname}${window.location.search}${window.location.hash}`,
    state: window.history.state,
  };
}

// =============================================================================
// Browser History Layer
// =============================================================================

/**
 * Browser history layer - uses real window.history API.
 *
 * Features:
 * - Subscribes to popstate for back/forward detection
 * - Updates location Atom on all navigation
 * - Properly cleans up event listeners on scope close
 */
export const BrowserHistoryLive: Layer.Layer<History, never, AtomRegistry.AtomRegistry> =
  Layer.scoped(
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
            window.history.pushState(state, "", location.href);
            historyIndex++;
            registry.set(locationAtom, {
              ...location,
              state,
            });
          }),

        replace: (path, state) =>
          Effect.sync(() => {
            const location = parseLocation(path, state);
            window.history.replaceState(state, "", location.href);
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
// Memory History Layer
// =============================================================================

/**
 * Options for creating memory history.
 */
export interface MemoryHistoryOptions {
  readonly initialEntries?: readonly string[];
  readonly initialIndex?: number;
}

/**
 * Create a memory history layer - for SSR and testing.
 *
 * Features:
 * - In-memory history stack
 * - No browser dependencies
 * - Controllable initial state
 */
export function MemoryHistoryLive(
  options: MemoryHistoryOptions = {}
): Layer.Layer<History, never, AtomRegistry.AtomRegistry> {
  const initialEntries = options.initialEntries ?? ["/"];
  const initialIndex = Option.getOrElse(
    Option.fromNullable(options.initialIndex),
    () => initialEntries.length - 1
  );

  return Layer.effect(
    History,
    Effect.gen(function* () {
      const registry = yield* AtomRegistry.AtomRegistry;

      // History stack and current index
      const entries: Array<{ href: string; state: unknown }> = initialEntries.map(
        (href) => ({ href, state: null })
      );
      let index = Math.min(Math.max(initialIndex, 0), entries.length - 1);

      // Create location atom with initial entry
      const currentEntry = entries[index];
      const locationAtom = Atom.make(
        currentEntry
          ? parseLocation(currentEntry.href, currentEntry.state)
          : parseLocation("/")
      );

      const updateLocation = () => {
        const entry = entries[index];
        if (entry) {
          registry.set(locationAtom, parseLocation(entry.href, entry.state));
        }
      };

      const service: HistoryService = {
        location: locationAtom,

        push: (path, state) =>
          Effect.sync(() => {
            // Remove forward history when pushing
            entries.splice(index + 1);
            entries.push({ href: path, state });
            index = entries.length - 1;
            updateLocation();
          }),

        replace: (path, state) =>
          Effect.sync(() => {
            entries[index] = { href: path, state };
            updateLocation();
          }),

        back: Effect.sync(() => {
          if (index > 0) {
            index--;
            updateLocation();
          }
        }),

        forward: Effect.sync(() => {
          if (index < entries.length - 1) {
            index++;
            updateLocation();
          }
        }),

        go: (n) =>
          Effect.sync(() => {
            const newIndex = index + n;
            if (newIndex >= 0 && newIndex < entries.length) {
              index = newIndex;
              updateLocation();
            }
          }),

        canGoBack: Effect.sync(() => index > 0),
      };

      return service;
    })
  );
}

// =============================================================================
// Convenience Accessors
// =============================================================================

/**
 * Get the current location.
 */
export const getLocation: Effect.Effect<HistoryLocation, never, History | AtomRegistry.AtomRegistry> =
  Effect.gen(function* () {
    const history = yield* History;
    return yield* Atom.get(history.location);
  });

/**
 * Push a new location onto the history stack.
 */
export const push = (
  path: string,
  state?: unknown
): Effect.Effect<void, never, History> =>
  Effect.gen(function* () {
    const history = yield* History;
    yield* history.push(path, state);
  });

/**
 * Replace the current location.
 */
export const replace = (
  path: string,
  state?: unknown
): Effect.Effect<void, never, History> =>
  Effect.gen(function* () {
    const history = yield* History;
    yield* history.replace(path, state);
  });

/**
 * Go back in history.
 */
export const back: Effect.Effect<void, never, History> = Effect.gen(function* () {
  const history = yield* History;
  yield* history.back;
});

/**
 * Go forward in history.
 */
export const forward: Effect.Effect<void, never, History> = Effect.gen(
  function* () {
    const history = yield* History;
    yield* history.forward;
  }
);

/**
 * Go n entries in history.
 */
export const go = (n: number): Effect.Effect<void, never, History> =>
  Effect.gen(function* () {
    const history = yield* History;
    yield* history.go(n);
  });
