/**
 * Navigator service - type-safe route-aware navigation.
 *
 * Provides route-aware navigation on top of History:
 * - nav.go("routeName", { path: {...}, searchParams: {...} })
 * - nav.back, nav.forward
 * - nav.isActive("routeName", params) for active link detection
 * - currentRoute Atom reflects matched route info
 *
 * Design: Navigator uses History internally but provides route-aware API.
 * It knows about routes and can build URLs from route names.
 */

import * as Effect from "effect/Effect";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { Atom, Registry as AtomRegistry } from "@effect-atom/atom";
import { History, type HistoryLocation } from "./History.js";
import type { Route } from "./Route.js";
import type { Router } from "./Router.js";

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
export interface NavigateOptions<
  PathParams extends Record<string, unknown> = Record<string, unknown>,
  SearchParams extends Record<string, unknown> = Record<string, unknown>,
> {
  readonly path?: PathParams;
  readonly searchParams?: SearchParams;
  readonly replace?: boolean;
}

/**
 * Navigator service interface.
 * Provides type-safe navigation by route name.
 */
export interface NavigatorService {
  /**
   * Base path prefix for all routes (e.g., "/ssr/router").
   * Used for apps mounted at non-root paths.
   */
  readonly basePath: string;

  /**
   * Current matched route info - updates on navigation.
   */
  readonly currentRoute: Atom.Writable<Option.Option<CurrentRoute>, Option.Option<CurrentRoute>>;

  /**
   * Navigate to a route by name with optional params.
   */
  readonly go: (
    routeName: string,
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
   * Check if a route is currently active.
   * Optionally match specific params.
   */
  readonly isActive: (
    routeName: string,
    params?: Record<string, unknown>,
  ) => Effect.Effect<boolean, never, AtomRegistry.AtomRegistry>;
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
 * Parse search params from URL search string.
 */
function parseSearchParams(search: string): Record<string, string> {
  const params: Record<string, string> = {};
  const searchParams = new URLSearchParams(search);
  searchParams.forEach((value, key) => {
    params[key] = value;
  });
  return params;
}

/**
 * Build search string from params object.
 */
function buildSearchString(params: Record<string, unknown>): string {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      searchParams.set(key, String(value));
    }
  }
  const str = searchParams.toString();
  return str ? `?${str}` : "";
}

/**
 * Strip basePath prefix from pathname for route matching.
 */
function stripBasePath(pathname: string, basePath: string): string {
  if (!basePath || basePath === "/") {
    return pathname;
  }
  // Normalize: remove trailing slash from basePath
  const normalizedBase = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;
  if (pathname.startsWith(normalizedBase)) {
    const stripped = pathname.slice(normalizedBase.length);
    // Ensure we return "/" not "" for root
    return stripped || "/";
  }
  return pathname;
}

/**
 * Match current location against router and return CurrentRoute.
 */
function matchLocation(
  router: Router,
  location: HistoryLocation,
  basePath: string = "",
): Option.Option<CurrentRoute> {
  const pathname = stripBasePath(location.pathname, basePath);
  const match = router.matchRoute(pathname);
  if (Option.isNone(match)) {
    return Option.none();
  }

  return Option.some({
    routeName: match.value.route.name,
    params: match.value.params,
    searchParams: parseSearchParams(location.search),
    layouts: match.value.layouts.map((l) => l.name),
  });
}

/**
 * Find a route by name in the router.
 * Also checks routes inside layout groups.
 */
function findRouteByName(router: Router, name: string): Option.Option<{ route: Route; basePath: string }> {
  for (const group of router.groups) {
    for (const route of group.routes) {
      if (route.name === name) {
        // For layout groups, include the basePath for URL building
        const basePath = group._tag === "LayoutGroup" ? (group as any).basePath : "";
        return Option.some({ route, basePath });
      }
    }
  }
  return Option.none();
}

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
 * - Type-safe navigation by route name
 * - Automatic URL building via route.interpolate
 * - Tracks current matched route in an Atom
 * - Delegates to History for actual navigation
 * - Supports basePath for apps mounted at non-root paths
 */
export function NavigatorLive(
  router: Router,
  options: NavigatorOptions = {},
): Layer.Layer<Navigator, never, History | AtomRegistry.AtomRegistry> {
  const basePath = options.basePath ?? "";

  return Layer.scoped(
    Navigator,
    Effect.gen(function* () {
      const history = yield* History;
      const registry = yield* AtomRegistry.AtomRegistry;

      // Get initial location and create currentRoute atom
      const initialLocation = registry.get(history.location);
      const initialRoute = matchLocation(router, initialLocation, basePath);
      const currentRouteAtom = Atom.make(initialRoute);

      // Subscribe to location changes to update currentRoute.
      // This handles popstate events (browser back/forward) automatically.
      const unsubscribe = registry.subscribe(history.location, (location) => {
        const matched = matchLocation(router, location, basePath);
        registry.set(currentRouteAtom, matched);
      });

      // Cleanup subscription when scope closes
      yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));

      const service: NavigatorService = {
        basePath,
        currentRoute: currentRouteAtom,

        go: (routeName, options = {}) =>
          Effect.gen(function* () {
            const found = findRouteByName(router, routeName);
            if (Option.isNone(found)) {
              yield* Effect.logWarning(`Route not found: ${routeName}`);
              return;
            }

            const { route, basePath: routeBasePath } = found.value;

            // Build URL from route and params
            const pathParams = options.path ?? ({} as Record<string, unknown>);
            const routePathname = route.interpolate(pathParams);
            // Prepend navigator basePath AND route's layout basePath
            const pathname = basePath + routeBasePath + routePathname;
            const search = options.searchParams ? buildSearchString(options.searchParams) : "";
            const url = `${pathname}${search}`;

            // Navigate - currentRoute updates automatically via derived atom
            if (options.replace) {
              yield* history.replace(url);
            } else {
              yield* history.push(url);
            }
          }),

        // Back/forward - currentRoute updates automatically when history.location
        // changes (popstate handler updates locationAtom, derived atom recomputes)
        back: history.back,

        forward: history.forward,

        isActive: (routeName, params) =>
          Effect.gen(function* () {
            const current = yield* Atom.get(currentRouteAtom);
            if (Option.isNone(current)) {
              return false;
            }

            if (current.value.routeName !== routeName) {
              return false;
            }

            // If params provided, check they match
            if (params) {
              for (const [key, value] of Object.entries(params)) {
                if (current.value.params[key] !== value) {
                  return false;
                }
              }
            }

            return true;
          }),
      };

      return service;
    }),
  );
}

// =============================================================================
// Convenience Accessors
// =============================================================================

/**
 * Navigate to a route by name.
 */
export const go = (
  routeName: string,
  options?: NavigateOptions,
): Effect.Effect<void, never, Navigator | AtomRegistry.AtomRegistry> =>
  Effect.gen(function* () {
    const nav = yield* Navigator;
    yield* nav.go(routeName, options);
  });

/**
 * Go back in history.
 */
/* is-tree-shakable-suppress */
export const back: Effect.Effect<void, never, Navigator | AtomRegistry.AtomRegistry> = Effect.gen(
  function* () {
    const nav = yield* Navigator;
    yield* nav.back;
  },
);

/**
 * Go forward in history.
 */
/* is-tree-shakable-suppress */
export const forward: Effect.Effect<void, never, Navigator | AtomRegistry.AtomRegistry> =
  Effect.gen(function* () {
    const nav = yield* Navigator;
    yield* nav.forward;
  });

/**
 * Get current route info.
 */
/* is-tree-shakable-suppress */
export const getCurrentRoute: Effect.Effect<
  Option.Option<CurrentRoute>,
  never,
  Navigator | AtomRegistry.AtomRegistry
> = Effect.gen(function* () {
  const nav = yield* Navigator;
  return yield* Atom.get(nav.currentRoute);
});
