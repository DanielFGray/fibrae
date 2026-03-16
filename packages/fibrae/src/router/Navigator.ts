/**
 * Navigator service - path-based navigation.
 *
 * Provides navigation on top of History:
 * - nav.go("/posts/42") — push to history
 * - nav.go("/posts/42", { replace: true, search: { sort: "date" } })
 * - nav.back, nav.forward
 * - currentRoute Atom reflects matched route info
 * - currentPathname for active link detection
 *
 * Design: Navigator uses History internally but provides a higher-level API.
 * Route matching is reactive via History location subscription.
 */

import * as Effect from "effect/Effect";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { Atom, Registry as AtomRegistry } from "@effect-atom/atom";
import { History, type HistoryLocation } from "./History.js";
import type { Router } from "./Router.js";
import { parseSearchParams, buildSearchString, stripBasePath } from "./utils.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Current route info - what route is currently matched.
 */
export interface CurrentRoute {
  readonly routeName: string;
  readonly params: Record<string, unknown>;
  readonly searchParams: Record<string, string>;
  /** Layout names wrapping this route, from outermost to innermost */
  readonly layouts: readonly string[];
}

/**
 * Navigation options for go().
 */
export interface NavigateOptions {
  readonly search?: Record<string, unknown>;
  readonly replace?: boolean;
  /** Enable View Transitions API for this navigation (CSS-driven animations) */
  readonly viewTransition?: boolean;
}

/**
 * Navigator service interface.
 * Provides path-based navigation.
 */
export interface NavigatorService {
  /**
   * The router instance used for route matching.
   */
  readonly router: Router;

  /**
   * Base path prefix for all routes (e.g., "/ssr/router").
   * Used for apps mounted at non-root paths.
   */
  readonly basePath: string;

  /**
   * Current pathname (without basePath). Updated on navigation.
   */
  readonly currentPathname: string;

  /**
   * Current matched route info - updates on navigation.
   */
  readonly currentRoute: Atom.Writable<Option.Option<CurrentRoute>, Option.Option<CurrentRoute>>;

  /**
   * Navigate to a path.
   */
  readonly go: (
    href: string,
    options?: NavigateOptions,
  ) => Effect.Effect<void, never, AtomRegistry.AtomRegistry>;

  /**
   * Go back in history.
   */
  readonly back: Effect.Effect<void, never, AtomRegistry.AtomRegistry>;

  /**
   * Go forward in history.
   */
  readonly forward: Effect.Effect<void, never, AtomRegistry.AtomRegistry>;

  /**
   * Check if a path is currently active.
   */
  readonly isActive: (href: string) => Effect.Effect<boolean, never, AtomRegistry.AtomRegistry>;
}

// =============================================================================
// Service Tag
// =============================================================================

/**
 * Navigator service tag for Effect dependency injection.
 */
export class Navigator extends Context.Tag("fibrae/Navigator")<Navigator, NavigatorService>() {}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Match current location against router and return CurrentRoute.
 * Returns Effect since route matching uses Schema.decodeUnknown.
 */
function matchLocation(
  router: Router,
  location: HistoryLocation,
  basePath: string = "",
): Effect.Effect<Option.Option<CurrentRoute>> {
  return router.matchRoute(stripBasePath(location.pathname, basePath)).pipe(
    Effect.map((matchResult) =>
      Option.map(matchResult, ({ route, params, layouts }) => ({
        routeName: route.name,
        params,
        searchParams: parseSearchParams(location.search),
        layouts: layouts.map((l) => l.name),
      })),
    ),
  );
}

// =============================================================================
// View Transitions
// =============================================================================

// =============================================================================
// Navigator Layer
// =============================================================================

/**
 * Options for creating a Navigator layer.
 */
export interface NavigatorOptions {
  /** Base path prefix for all routes (e.g., "/ssr/router") */
  readonly basePath?: string;
}

/**
 * Create a Navigator layer for the given router.
 *
 * Features:
 * - Path-based navigation
 * - Tracks current matched route in an Atom
 * - Delegates to History for actual navigation
 * - Supports basePath for apps mounted at non-root paths
 */
export function NavigatorLive(
  router: Router,
  navigatorOptions: NavigatorOptions = {},
): Layer.Layer<Navigator, never, History | AtomRegistry.AtomRegistry> {
  const basePath = navigatorOptions.basePath ?? "";

  return Layer.scoped(
    Navigator,
    Effect.gen(function* () {
      const history = yield* History;
      const registry = yield* AtomRegistry.AtomRegistry;

      // Get initial location and create currentRoute atom
      const initialLocation = registry.get(history.location);
      const initialRoute = yield* matchLocation(router, initialLocation, basePath);
      const currentRouteAtom = Atom.make(initialRoute);

      // Track current pathname (mutable for synchronous access from Link)
      let currentPathname = stripBasePath(initialLocation.pathname, basePath);

      // Subscribe to location changes to update currentRoute.
      // Effect.runSync is safe here: matchPath is pure computation with no requirements.
      const unsubscribe = registry.subscribe(history.location, (location) => {
        const matched = Effect.runSync(matchLocation(router, location, basePath));
        registry.set(currentRouteAtom, matched);
        currentPathname = stripBasePath(location.pathname, basePath);
      });

      // Cleanup subscription when scope closes
      yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));

      const service: NavigatorService = {
        router,
        basePath,
        get currentPathname() {
          return currentPathname;
        },
        currentRoute: currentRouteAtom,

        go: (href, options = {}) =>
          Effect.gen(function* () {
            // Validate route exists before navigating
            const matched = yield* router.matchRoute(href);
            if (Option.isNone(matched)) {
              yield* Effect.logWarning(`No route matches path: ${href}`);
            }

            const searchString = options.search ? buildSearchString(options.search) : "";
            const url = `${basePath}${href}${searchString}`;
            const nav = options.replace ? history.replace(url) : history.push(url);

            if (options.viewTransition && typeof document.startViewTransition === "function") {
              Effect.runSync(nav);
              Effect.sync(() => {
                document.startViewTransition(async () => {
                  await new Promise<void>((r) =>
                    requestAnimationFrame(() => requestAnimationFrame(() => r())),
                  );
                });
              });
            } else {
              yield* nav;
            }
          }),

        // Back/forward - currentRoute updates automatically when history.location
        // changes (popstate handler updates locationAtom, subscription recomputes)
        back: history.back,

        forward: history.forward,

        isActive: (href) => Effect.succeed(currentPathname === href),
      };

      return service;
    }),
  );
}
