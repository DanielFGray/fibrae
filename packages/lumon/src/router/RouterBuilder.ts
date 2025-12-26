/**
 * RouterBuilder module for implementing route handlers.
 * 
 * Mirrors Effect HttpApiBuilder patterns:
 * - RouterBuilder.group(router, "groupName", (handlers) => Effect.gen(...))
 * - handlers.handle("routeName", { loader, component })
 * - RouterBuilder.router(Router) builds the final Layer
 */

import * as Effect from "effect/Effect";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type { Router, RouteGroup } from "./Router.js";
import type { Route } from "./Route.js";
import type { VElement } from "../shared.js";

/**
 * Context for loader/component execution.
 * Provides decoded path and search parameters.
 */
export interface LoaderContext<
  PathParams extends Record<string, unknown> = Record<string, unknown>,
  SearchParams extends Record<string, unknown> = Record<string, unknown>,
> {
  readonly path: PathParams;
  readonly searchParams: SearchParams;
}

/**
 * Component props including loader data and route parameters.
 */
export interface ComponentProps<
  LoaderData = unknown,
  PathParams extends Record<string, unknown> = Record<string, unknown>,
  SearchParams extends Record<string, unknown> = Record<string, unknown>,
> {
  readonly loaderData: LoaderData;
  readonly path: PathParams;
  readonly searchParams: SearchParams;
}

/**
 * Handler configuration for a route.
 * Loader fetches data, component renders with that data.
 */
export interface HandlerConfig<
  LoaderData = unknown,
  PathParams extends Record<string, unknown> = Record<string, unknown>,
  SearchParams extends Record<string, unknown> = Record<string, unknown>,
  R = never,
  E = never,
> {
  readonly loader: (
    ctx: LoaderContext<PathParams, SearchParams>
  ) => Effect.Effect<LoaderData, E, R>;

  readonly component: (
    props: ComponentProps<LoaderData, PathParams, SearchParams>
  ) => VElement;
}

/**
 * A registered route handler (type-erased for storage).
 * Use executeRoute for type-safe execution.
 */
export interface RouteHandler {
  readonly routeName: string;
  readonly route: Route;
  readonly loader: (
    ctx: LoaderContext
  ) => Effect.Effect<unknown>;
  readonly component: (
    props: ComponentProps
  ) => VElement;
}

/**
 * Handlers builder for a route group.
 * Accumulates handler registrations for routes in the group.
 */
export interface GroupHandlers<GroupName extends string = string> {
  readonly groupName: GroupName;
  readonly handlers: readonly RouteHandler[];

  /**
   * Register a handler for a route in this group.
   */
  readonly handle: <
    RouteName extends string,
    LoaderData,
    PathParams extends Record<string, unknown>,
    SearchParams extends Record<string, unknown>,
    R,
    E,
  >(
    routeName: RouteName,
    config: HandlerConfig<LoaderData, PathParams, SearchParams, R, E>
  ) => GroupHandlers<GroupName>;
}

/**
 * Tag for the RouterHandlers service.
 * Provides access to all registered handlers.
 */
export class RouterHandlers extends Context.Tag("lumon/RouterHandlers")<
  RouterHandlers,
  {
    readonly handlers: ReadonlyMap<string, RouteHandler>;
    readonly getHandler: (routeName: string) => Option.Option<RouteHandler>;
  }
>() {}

/**
 * Create handlers builder for a route group.
 */
function makeGroupHandlers<GroupName extends string>(
  groupName: GroupName,
  group: RouteGroup<GroupName>
): GroupHandlers<GroupName> {
  const routesByName = new Map<string, Route>(
    group.routes.map((r) => [r.name, r])
  );

  const buildHandlers = (
    handlers: readonly RouteHandler[]
  ): GroupHandlers<GroupName> => ({
    groupName,
    handlers,
    handle<
      RouteName extends string,
      LoaderData,
      PathParams extends Record<string, unknown>,
      SearchParams extends Record<string, unknown>,
      R,
      E,
    >(
      routeName: RouteName,
      config: HandlerConfig<LoaderData, PathParams, SearchParams, R, E>
    ): GroupHandlers<GroupName> {
      const maybeRoute = Option.fromNullable(routesByName.get(routeName));
      if (Option.isNone(maybeRoute)) {
        throw new Error(
          `Route "${routeName}" not found in group "${groupName}"`
        );
      }
      const route = maybeRoute.value;

      const handler: RouteHandler = {
        routeName,
        route,
        loader: config.loader as (ctx: LoaderContext) => Effect.Effect<unknown>,
        component: config.component as (props: ComponentProps) => VElement,
      };

      return buildHandlers([...handlers, handler]);
    },
  });

  return buildHandlers([]);
}

/**
 * Find a route group by name in a router.
 */
function findGroup<GroupName extends string>(
  router: Router,
  groupName: GroupName
): RouteGroup<GroupName> {
  const maybeGroup = Option.fromNullable(
    router.groups.find((g) => g.name === groupName)
  );
  if (Option.isNone(maybeGroup)) {
    throw new Error(`Group "${groupName}" not found in router "${router.name}"`);
  }
  return maybeGroup.value as RouteGroup<GroupName>;
}

/**
 * Create a Layer that provides handlers for a route group.
 * 
 * Usage:
 * ```typescript
 * const AppRoutesLive = RouterBuilder.group(
 *   AppRouter,
 *   "app",
 *   (handlers) => Effect.gen(function* () {
 *     return handlers
 *       .handle("home", { loader: () => Effect.succeed(...), component: ... })
 *       .handle("posts", { loader: () => Effect.succeed(...), component: ... })
 *   })
 * )
 * ```
 */
export function group<GroupName extends string, R>(
  router: Router,
  groupName: GroupName,
  build: (handlers: GroupHandlers<GroupName>) => Effect.Effect<GroupHandlers<GroupName>, never, R>
): Layer.Layer<RouterHandlers, never, R> {
  const routeGroup = findGroup(router, groupName);
  const initialHandlers = makeGroupHandlers(groupName, routeGroup);

  return Layer.effect(
    RouterHandlers,
    Effect.gen(function* () {
      const builtHandlers = yield* build(initialHandlers);

      const handlersMap = new Map<string, RouteHandler>(
        builtHandlers.handlers.map((h) => [h.routeName, h])
      );

      return {
        handlers: handlersMap,
        getHandler(routeName: string): Option.Option<RouteHandler> {
          const handler = handlersMap.get(routeName);
          return handler ? Option.some(handler) : Option.none();
        },
      };
    })
  );
}

/**
 * Merge multiple group handler layers into a single RouterHandlers layer.
 * 
 * Usage:
 * ```typescript
 * const AppRouterLive = RouterBuilder.router(AppRouter).pipe(
 *   Layer.provide(AppRoutesLive),
 *   Layer.provide(ApiRoutesLive)
 * )
 * ```
 */
export function router(_router: Router): Layer.Layer<RouterHandlers> {
  // Start with an empty handlers layer
  return Layer.succeed(RouterHandlers, {
    handlers: new Map(),
    getHandler(_routeName: string): Option.Option<RouteHandler> {
      return Option.none();
    },
  });
}

/**
 * Execute a route's loader and render its component.
 * Returns the rendered VElement.
 */
export function executeRoute(
  handler: RouteHandler,
  ctx: LoaderContext
): Effect.Effect<VElement> {
  return Effect.gen(function* () {
    const loaderData = yield* handler.loader(ctx);
    return handler.component({
      loaderData,
      path: ctx.path,
      searchParams: ctx.searchParams,
    });
  });
}
