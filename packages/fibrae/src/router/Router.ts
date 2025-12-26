/**
 * Router module for organizing and matching routes.
 *
 * Mirrors Effect HttpApiGroup/HttpApi patterns:
 * - Router.group("name") creates a group for organizing routes
 * - Router.make("name") creates the top-level router
 * - Routes are added via .add(route)
 * - Router holds the complete route tree for efficient matching
 *
 * SSR Integration:
 * - Router.serverLayer() - For SSR rendering with loaders
 * - Router.browserLayer() - For client hydration with initial state
 */

import type { Route } from "./Route.js";
import * as Option from "effect/Option";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Context from "effect/Context";
import { Registry as AtomRegistry } from "@effect-atom/atom";
import { History, MemoryHistoryLive, type HistoryLocation } from "./History.js";
import { Navigator, NavigatorLive } from "./Navigator.js";
import { RouterHandlers } from "./RouterBuilder.js";
import { RouterStateAtom } from "./RouterState.js";
import type { VElement } from "../shared.js";

/**
 * A group of routes for organizational purposes.
 * Groups provide namespacing for handler implementation.
 */
export interface RouteGroup<Name extends string = string> {
  readonly name: Name;
  readonly routes: readonly Route[];
  readonly add: (route: Route) => RouteGroup<Name>;
}

/**
 * The complete router holding all route groups and enabling route matching.
 */
export interface Router<Name extends string = string> {
  readonly name: Name;
  readonly groups: readonly RouteGroup[];
  readonly add: (group: RouteGroup) => Router<Name>;

  /**
   * Match a pathname against all routes in the router.
   * Returns the matched route, group name, and decoded path parameters.
   */
  readonly matchRoute: (pathname: string) => Option.Option<{
    readonly groupName: string;
    readonly route: Route;
    readonly params: Record<string, unknown>;
  }>;
}

/**
 * Create a route group with the given name.
 * Routes are added via group.add(route).
 */
export function group<const Name extends string>(name: Name): RouteGroup<Name> {
  return {
    name,
    routes: [],
    add(route: Route): RouteGroup<Name> {
      return {
        ...this,
        routes: [...this.routes, route],
      };
    },
  };
}

/**
 * Create a router with the given name.
 * Groups are added via router.add(group).
 */
export function make<const Name extends string>(name: Name): Router<Name> {
  return {
    name,
    groups: [],
    add(g: RouteGroup): Router<Name> {
      return {
        ...this,
        groups: [...this.groups, g],
      };
    },
    matchRoute(pathname: string): Option.Option<{
      readonly groupName: string;
      readonly route: Route;
      readonly params: Record<string, unknown>;
    }> {
      // Try to match against each route in each group
      for (const g of this.groups) {
        for (const route of g.routes) {
          const match = route.match(pathname);
          if (Option.isSome(match)) {
            return Option.some({
              groupName: g.name,
              route,
              params: match.value,
            });
          }
        }
      }
      return Option.none();
    },
  };
}

// =============================================================================
// SSR Integration
// =============================================================================

/**
 * Options for server-side rendering layer.
 */
export interface ServerLayerOptions {
  /** The router instance */
  readonly router: Router;
  /** Current request pathname */
  readonly pathname: string;
  /** Current request search string (with or without leading ?) */
  readonly search?: string;
  /** Base path prefix for the app (e.g., "/ssr/router") */
  readonly basePath?: string;
}

/**
 * Options for browser/client hydration layer.
 */
export interface BrowserLayerOptions {
  /** The router instance */
  readonly router: Router;
  /**
   * @deprecated Use atom hydration instead. RouterStateAtom is automatically
   * hydrated from __FIBRAE_STATE__ and used by RouterOutlet.
   */
  readonly initialState?: DehydratedRouterState;
  /** Base path prefix for the app (e.g., "/ssr/router") */
  readonly basePath?: string;
}

/**
 * Dehydrated state from SSR for hydration.
 * Contains matched route info and loader data.
 */
export interface DehydratedRouterState {
  /** Name of the matched route */
  readonly routeName: string;
  /** Decoded path parameters */
  readonly params: Record<string, unknown>;
  /** Search parameters */
  readonly searchParams: Record<string, string>;
  /** Data returned by the loader */
  readonly loaderData: unknown;
}

/**
 * Result of SSR rendering a route.
 */
export interface SSRRouteResult {
  /** The rendered VElement */
  readonly element: VElement;
  /** Dehydrated state for client hydration */
  readonly dehydratedState: DehydratedRouterState;
}

/**
 * Service tag for the current route's rendered element.
 * Used by SSR to provide the matched route's component.
 */
export class CurrentRouteElement extends Context.Tag("fibrae/CurrentRouteElement")<
  CurrentRouteElement,
  { readonly element: VElement; readonly state: DehydratedRouterState }
>() {}

/**
 * Parse search params from URL search string.
 */
function parseSearchParams(search: string): Record<string, string> {
  const params: Record<string, string> = {};
  const searchString = search.startsWith("?") ? search.slice(1) : search;
  if (!searchString) return params;

  const searchParams = new URLSearchParams(searchString);
  searchParams.forEach((value, key) => {
    params[key] = value;
  });
  return params;
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
 * Create a server-side layer for SSR rendering.
 *
 * This layer:
 * 1. Matches the pathname against the router
 * 2. Runs the matched route's loader
 * 3. Renders the component with loader data
 * 4. Provides the rendered element and dehydrated state
 *
 * Usage in SSR:
 * ```typescript
 * const serverLayer = Router.serverLayer({
 *   router: AppRouter,
 *   pathname: "/posts/42",
 *   search: "?sort=date",
 *   basePath: "/ssr/router"
 * });
 *
 * const { element, dehydratedState } = yield* Router.CurrentRouteElement;
 * ```
 */
export function serverLayer(
  options: ServerLayerOptions,
): Layer.Layer<
  CurrentRouteElement | History | Navigator,
  unknown,
  RouterHandlers | AtomRegistry.AtomRegistry
> {
  const { router, pathname, search = "", basePath = "" } = options;
  const searchParams = parseSearchParams(search);

  // Strip basePath from pathname for route matching
  const matchPathname = stripBasePath(pathname, basePath);

  // Create memory history for SSR (static, no navigation)
  const historyLayer = MemoryHistoryLive({
    initialPathname: pathname,
    initialSearch: search ? `?${search.replace(/^\?/, "")}` : "",
  });

  // Create navigator layer with basePath - needs History and AtomRegistry
  // We provide History here, AtomRegistry comes from outside
  const navigatorLayer = Layer.provideMerge(NavigatorLive(router, { basePath }), historyLayer);

  // Create route element layer
  const routeElementLayer = Layer.effect(
    CurrentRouteElement,
    Effect.gen(function* () {
      const routerHandlers = yield* RouterHandlers;
      const registry = yield* AtomRegistry.AtomRegistry;

      // Match route using stripped pathname
      const match = router.matchRoute(matchPathname);
      if (Option.isNone(match)) {
        return yield* Effect.fail(new Error(`No route matched pathname: ${matchPathname}`));
      }

      const { route, params } = match.value;

      // Get handler for this route
      const handler = routerHandlers.getHandler(route.name);
      if (Option.isNone(handler)) {
        return yield* Effect.fail(new Error(`No handler found for route: ${route.name}`));
      }

      // Execute loader and render component
      const loaderCtx = { path: params, searchParams };
      const loaderData = yield* handler.value.loader(loaderCtx);

      const element = handler.value.component({
        loaderData,
        path: params,
        searchParams,
      });

      const state: DehydratedRouterState = {
        routeName: route.name,
        params,
        searchParams,
        loaderData,
      };

      // Set RouterStateAtom so it gets included in dehydrated state
      registry.set(RouterStateAtom, Option.some(state));

      return { element, state };
    }),
  );

  return Layer.mergeAll(historyLayer, navigatorLayer, routeElementLayer);
}

/**
 * Create a browser layer for client-side hydration.
 *
 * This layer:
 * 1. Sets up browser history with popstate listener
 * 2. Checks RouterStateAtom for hydrated SSR state
 * 3. If hydrated, uses that for initial render (skips loader)
 * 4. Provides Navigator for subsequent navigation
 *
 * SSR hydration works automatically via atom hydration - no need to
 * pass initialState manually. The RouterStateAtom is hydrated from
 * __FIBRAE_STATE__ before this layer is created.
 *
 * Usage in client:
 * ```typescript
 * // Hydrate atoms first (includes RouterStateAtom)
 * hydrate(container, app, window.__FIBRAE_STATE__);
 *
 * // Browser layer reads from hydrated RouterStateAtom
 * const browserLayer = Router.browserLayer({
 *   router: AppRouter,
 *   basePath: "/ssr/router"
 * });
 * ```
 */
export function browserLayer(
  options: BrowserLayerOptions,
): Layer.Layer<
  History | Navigator | CurrentRouteElement,
  unknown,
  AtomRegistry.AtomRegistry | RouterHandlers
> {
  const { router, basePath = "" } = options;

  // Import BrowserHistoryLive dynamically to avoid server-side issues
  // For now, we'll use a scoped effect to create it
  const historyLayer = Layer.scoped(
    History,
    Effect.gen(function* () {
      const registry = yield* AtomRegistry.AtomRegistry;
      const { Atom } = yield* Effect.promise(() => import("@effect-atom/atom"));

      // Create location atom with initial browser location
      const getBrowserLocation = (): HistoryLocation => ({
        pathname: window.location.pathname,
        search: window.location.search,
        hash: window.location.hash,
        state: window.history.state,
      });

      const locationAtom = Atom.make<HistoryLocation>(getBrowserLocation());

      // Subscribe to popstate for browser back/forward
      const handlePopState = () => {
        registry.set(locationAtom, getBrowserLocation());
      };

      window.addEventListener("popstate", handlePopState);

      // Cleanup on scope close
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          window.removeEventListener("popstate", handlePopState);
        }),
      );

      // Track history index for canGoBack
      let historyIndex = 0;

      const parseLocation = (href: string, state?: unknown): HistoryLocation => {
        const url = href.startsWith("/") ? new URL(href, "http://localhost") : new URL(href);
        return {
          pathname: url.pathname,
          search: url.search,
          hash: url.hash,
          state,
        };
      };

      return {
        location: locationAtom,

        push: (path: string, state?: unknown) =>
          Effect.sync(() => {
            const location = parseLocation(path, state);
            const fullPath = `${location.pathname}${location.search}${location.hash}`;
            window.history.pushState(state, "", fullPath);
            historyIndex++;
            registry.set(locationAtom, { ...location, state });
          }),

        replace: (path: string, state?: unknown) =>
          Effect.sync(() => {
            const location = parseLocation(path, state);
            const fullPath = `${location.pathname}${location.search}${location.hash}`;
            window.history.replaceState(state, "", fullPath);
            registry.set(locationAtom, { ...location, state });
          }),

        back: Effect.sync(() => {
          window.history.back();
        }),

        forward: Effect.sync(() => {
          window.history.forward();
        }),

        go: (n: number) =>
          Effect.sync(() => {
            window.history.go(n);
          }),

        canGoBack: Effect.sync(() => historyIndex > 0),
      };
    }),
  );

  const navigatorLayer = NavigatorLive(router, { basePath });

  // Create route element layer - checks RouterStateAtom for hydrated state
  // If hydrated, uses that; otherwise matches and runs loader
  const routeElementLayer = Layer.effect(
    CurrentRouteElement,
    Effect.gen(function* () {
      const routerHandlers = yield* RouterHandlers;
      const registry = yield* AtomRegistry.AtomRegistry;

      // Check if RouterStateAtom was hydrated from SSR
      const hydratedState = registry.get(RouterStateAtom);

      if (Option.isSome(hydratedState)) {
        // Hydration mode: reuse SSR data from RouterStateAtom
        const state = hydratedState.value;
        const handler = routerHandlers.getHandler(state.routeName);
        if (Option.isNone(handler)) {
          return yield* Effect.fail(new Error(`No handler found for route: ${state.routeName}`));
        }

        // Render component with SSR loader data (skip loader)
        const element = handler.value.component({
          loaderData: state.loaderData,
          path: state.params,
          searchParams: state.searchParams,
        });

        // Cast RouterState to DehydratedRouterState (same shape)
        const dehydratedState: DehydratedRouterState = {
          routeName: state.routeName,
          params: state.params,
          searchParams: state.searchParams,
          loaderData: state.loaderData,
        };

        return { element, state: dehydratedState };
      }

      // Non-hydration mode: match and run loader
      const pathname = window.location.pathname;
      const matchPathname = stripBasePath(pathname, basePath);
      const search = window.location.search;
      const searchParams = parseSearchParams(search);

      const match = router.matchRoute(matchPathname);
      if (Option.isNone(match)) {
        return yield* Effect.fail(new Error(`No route matched pathname: ${matchPathname}`));
      }

      const { route, params } = match.value;

      const handler = routerHandlers.getHandler(route.name);
      if (Option.isNone(handler)) {
        return yield* Effect.fail(new Error(`No handler found for route: ${route.name}`));
      }

      const loaderCtx = { path: params, searchParams };
      const loaderData = yield* handler.value.loader(loaderCtx);

      const element = handler.value.component({
        loaderData,
        path: params,
        searchParams,
      });

      const state: DehydratedRouterState = {
        routeName: route.name,
        params,
        searchParams,
        loaderData,
      };

      // Set RouterStateAtom for DI access
      registry.set(RouterStateAtom, Option.some(state));

      return { element, state };
    }),
  );

  return Layer.mergeAll(
    historyLayer,
    Layer.provideMerge(navigatorLayer, historyLayer),
    routeElementLayer,
  );
}
