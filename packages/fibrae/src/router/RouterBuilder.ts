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
import type { Router, RouteGroup, LayoutGroup, AnyGroup } from "./Router.js";
import { RouterError } from "./Router.js";
import type { Route } from "./Route.js";
import type { VElement } from "../shared.js";
import type * as Schema from "effect/Schema";

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
 * Submission state for a form action.
 * Transitions: idle → pending → success/failure → idle (on next navigation).
 */
export type SubmissionState =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Pending" }
  | { readonly _tag: "Success"; readonly data: unknown }
  | { readonly _tag: "Failure"; readonly error: unknown };

/**
 * Component props including loader data, route parameters, and action context.
 */
export interface ComponentProps<
  LoaderData = unknown,
  PathParams extends Record<string, unknown> = Record<string, unknown>,
  SearchParams extends Record<string, unknown> = Record<string, unknown>,
> {
  readonly loaderData: LoaderData;
  readonly path: PathParams;
  readonly searchParams: SearchParams;
  /** Result of the last action invocation (Option.None until an action completes). */
  readonly actionData: Option.Option<unknown>;
  /** Invoke the route's action with a payload record. Returns an Effect. */
  readonly formAction: (payload: Record<string, unknown>) => Effect.Effect<unknown, unknown>;
  /** Current submission state (idle/pending/success/failure). */
  readonly submissionState: SubmissionState;
}

/**
 * Loader return type - can be a plain value or an Effect.
 * Plain values are automatically wrapped in Effect.succeed.
 */
export type LoaderResult<T, E = never, R = never> = T | Effect.Effect<T, E, R>;

/** Normalize a LoaderResult (value or Effect) into an Effect. No type erasure. */
const liftLoader = <A, E, R>(value: LoaderResult<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.isEffect(value) ? value : Effect.succeed(value);

/** Normalize an ActionResult (value or Effect) into an Effect. No type erasure. */
const liftAction = <A, E, R>(value: ActionResult<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.isEffect(value) ? value : Effect.succeed(value);

/**
 * Build a type-erased RouteAction from an ActionConfig.
 * Type-erasure boundary: the action handler's R is captured by the Layer,
 * so we store it with R = never.
 */
const buildRouteAction = (config: ActionConfig): RouteAction => ({
  schema: config.schema,
  handler: (ctx: ActionContext): Effect.Effect<unknown, unknown> =>
    liftAction(config.handler(ctx)) as Effect.Effect<unknown, unknown>,
});

/**
 * Per-route metadata for the document `<head>`.
 * Rendered during SSR/SSG, updated on client navigation.
 */
export type MetaDescriptor =
  | { readonly charset: "utf-8" }
  | { readonly title: string }
  | { readonly name: string; readonly content: string }
  | { readonly property: string; readonly content: string }
  | { readonly httpEquiv: string; readonly content: string }
  | { readonly "script:ld+json": Record<string, unknown> }
  | { readonly tagName: "meta" | "link"; readonly [key: string]: string };

export interface HeadData {
  readonly title?: string;
  readonly meta?: ReadonlyArray<MetaDescriptor>;
  readonly links?: ReadonlyArray<Record<string, string>>;
  readonly scripts?: ReadonlyArray<{
    readonly src?: string;
    readonly content?: string;
    readonly type?: string;
  }>;
}

/**
 * Context provided to the head() function.
 */
export interface HeadContext<
  LoaderData = unknown,
  PathParams extends Record<string, unknown> = Record<string, unknown>,
  SearchParams extends Record<string, unknown> = Record<string, unknown>,
> {
  readonly loaderData: LoaderData;
  readonly params: PathParams;
  readonly searchParams: SearchParams;
}

/**
 * Context for action execution.
 * Provides the decoded payload from form submission.
 */
export interface ActionContext<Payload = unknown> {
  readonly payload: Payload;
}

/**
 * Action return type - can be a plain value or an Effect.
 * Plain values are automatically wrapped in Effect.succeed.
 */
export type ActionResult<T, E = never, R = never> = T | Effect.Effect<T, E, R>;

/**
 * Configuration for a route action (mutation handler).
 * The schema decodes FormData into a typed payload before the action runs.
 */
export interface ActionConfig<Payload = unknown, ActionData = unknown, E = never, R = never> {
  /** Schema to decode FormData into typed payload. */
  readonly schema: Schema.Schema<Payload>;
  /** The action Effect that processes the decoded payload. */
  readonly handler: (ctx: ActionContext<Payload>) => ActionResult<ActionData, E, R>;
}

/**
 * Handler configuration for a route.
 * Loader fetches data, component renders with that data.
 *
 * - loader is optional - defaults to returning null
 * - loader can return a plain value or an Effect (plain values auto-wrapped)
 * - action is optional - handles form mutations with schema-decoded payloads
 */
export interface HandlerConfig<
  LoaderData = unknown,
  PathParams extends Record<string, unknown> = Record<string, unknown>,
  SearchParams extends Record<string, unknown> = Record<string, unknown>,
  R = never,
  E = never,
  ActionData = unknown,
  ActionR = never,
  ActionE = never,
> {
  readonly loader?: (
    ctx: LoaderContext<PathParams, SearchParams>,
  ) => LoaderResult<LoaderData, E, R>;

  readonly component: (props: ComponentProps<LoaderData, PathParams, SearchParams>) => VElement;

  /**
   * Per-route `<head>` metadata. Receives loader data and route params.
   * Can return plain HeadData or an Effect<HeadData>.
   */
  readonly head?: (
    ctx: HeadContext<LoaderData, PathParams, SearchParams>,
  ) => HeadData | Effect.Effect<HeadData>;

  /**
   * Route action for mutations (form submissions).
   * Receives schema-decoded payload, returns action result.
   * Action data is passed to the component via `actionData` prop.
   */
  readonly action?: ActionConfig<unknown, ActionData, ActionE, ActionR>;

  /** When true, this route will be pre-rendered to static HTML at build time. */
  readonly prerender?: boolean;

  /**
   * For parameterized prerender routes, return all possible param combinations.
   * Each entry generates a separate static HTML page.
   */
  readonly getStaticPaths?: () =>
    | ReadonlyArray<PathParams>
    | Effect.Effect<ReadonlyArray<PathParams>>;
}

/**
 * Type-erased action handler stored in RouteHandler.
 * Schema and handler are stored separately so Form can decode then invoke.
 */
export interface RouteAction {
  /** Schema to decode FormData record into typed payload. */
  readonly schema: Schema.Schema.Any;
  /** Type-erased action handler. R = never because requirements are captured by the Layer. */
  readonly handler: (ctx: ActionContext) => Effect.Effect<unknown, unknown>;
}

/**
 * A registered route handler (type-erased for storage).
 * Use executeRoute for type-safe execution.
 */
export interface RouteHandler {
  readonly routeName: string;
  readonly route: Route;
  /** Type-erased loader. R = never because requirements are captured by the Layer. */
  readonly loader: (ctx: LoaderContext) => Effect.Effect<unknown, unknown>;
  readonly component: (props: ComponentProps) => VElement;
  readonly head: Option.Option<(ctx: HeadContext) => Effect.Effect<HeadData, unknown>>;
  /** Type-erased action for form mutations. */
  readonly action: Option.Option<RouteAction>;
  readonly prerender: boolean;
  readonly getStaticPaths: Option.Option<
    () => Effect.Effect<ReadonlyArray<Record<string, unknown>>, unknown>
  >;
}

/**
 * A registered layout handler.
 * The layout component should render <RouterOutlet /> for children.
 */
export interface LayoutHandler {
  readonly layoutName: string;
  readonly component: () => VElement;
}

/**
 * Handlers builder for a route group.
 * Accumulates handler registrations and their service requirements (R).
 *
 * Each handle() call unions the loader's R into the group's accumulated R,
 * ensuring the final Layer type declares all required services.
 *
 * RouteNames constrains handle() to only accept valid route names from the group.
 */
export interface GroupHandlers<
  GroupName extends string = string,
  RouteNames extends string = string,
  R = never,
> {
  readonly groupName: GroupName;
  readonly handlers: readonly RouteHandler[];

  /**
   * Register a handler for a route in this group.
   * RouteName is constrained to the group's valid route names.
   * Accumulates the loader's and action's service requirements into the group's R.
   */
  readonly handle: <
    RouteName extends RouteNames,
    LoaderData = unknown,
    PathParams extends Record<string, unknown> = Record<string, unknown>,
    SearchParams extends Record<string, unknown> = Record<string, unknown>,
    R2 = never,
    E = never,
    ActionData = unknown,
    ActionR = never,
    ActionE = never,
  >(
    routeName: RouteName,
    config: HandlerConfig<
      LoaderData,
      PathParams,
      SearchParams,
      R2,
      E,
      ActionData,
      ActionR,
      ActionE
    >,
  ) => GroupHandlers<GroupName, RouteNames, R | R2 | ActionR>;
}

/**
 * Handlers builder for a layout group.
 * Includes layout component registration plus child route handlers.
 * Accumulates loader service requirements (R) like GroupHandlers.
 *
 * RouteNames constrains handle() to only accept valid route names from the group.
 */
export interface LayoutGroupHandlers<
  GroupName extends string = string,
  RouteNames extends string = string,
  R = never,
> {
  readonly groupName: GroupName;
  readonly handlers: readonly RouteHandler[];
  readonly layoutHandler: LayoutHandler | null;

  /**
   * Register the layout component for this layout group.
   * The layout component should render <RouterOutlet /> for children.
   */
  readonly layout: (component: () => VElement) => LayoutGroupHandlers<GroupName, RouteNames, R>;

  /**
   * Register a handler for a route in this layout group.
   * RouteName is constrained to the group's valid route names.
   * Accumulates the loader's and action's service requirements into the group's R.
   */
  readonly handle: <
    RouteName extends RouteNames,
    LoaderData = unknown,
    PathParams extends Record<string, unknown> = Record<string, unknown>,
    SearchParams extends Record<string, unknown> = Record<string, unknown>,
    R2 = never,
    E = never,
    ActionData = unknown,
    ActionR = never,
    ActionE = never,
  >(
    routeName: RouteName,
    config: HandlerConfig<
      LoaderData,
      PathParams,
      SearchParams,
      R2,
      E,
      ActionData,
      ActionR,
      ActionE
    >,
  ) => LayoutGroupHandlers<GroupName, RouteNames, R | R2 | ActionR>;
}

/**
 * Tag for the RouterHandlers service.
 * Provides access to all registered handlers.
 */
export class RouterHandlers extends Context.Tag("fibrae/RouterHandlers")<
  RouterHandlers,
  {
    readonly handlers: ReadonlyMap<string, RouteHandler>;
    readonly layoutHandlers: ReadonlyMap<string, LayoutHandler>;
    readonly getHandler: (routeName: string) => Option.Option<RouteHandler>;
    readonly getLayoutHandler: (layoutName: string) => Option.Option<LayoutHandler>;
  }
>() {}

/**
 * Create handlers builder for a route group.
 * RouteNames is threaded through to constrain handle() calls.
 */
function makeGroupHandlers<GroupName extends string, RouteNames extends string>(
  groupName: GroupName,
  grp: RouteGroup<GroupName, RouteNames>,
): GroupHandlers<GroupName, RouteNames> {
  const routesByName = new Map<string, Route>(grp.routes.map((r) => [r.name, r]));

  const buildHandlers = (
    handlers: readonly RouteHandler[],
  ): GroupHandlers<GroupName, RouteNames> => ({
    groupName,
    handlers,
    handle<
      RouteName extends RouteNames,
      LoaderData,
      PathParams extends Record<string, unknown>,
      SearchParams extends Record<string, unknown>,
      R2,
      E,
      ActionData,
      ActionR,
      ActionE,
    >(
      routeName: RouteName,
      config: HandlerConfig<
        LoaderData,
        PathParams,
        SearchParams,
        R2,
        E,
        ActionData,
        ActionR,
        ActionE
      >,
    ) {
      const maybeRoute = Option.fromNullable(routesByName.get(routeName));
      if (Option.isNone(maybeRoute)) {
        throw new RouterError({
          message: `Route "${routeName}" not found in group "${groupName}"`,
        });
      }
      const route = maybeRoute.value;

      // Type-erasure boundary: loader/head/getStaticPaths are stored with R = never
      // because their actual requirements (R2) are captured by the Layer's R type parameter.
      // Casts to LoaderContext<PathParams, SearchParams> are safe — RouterOutlet always
      // passes correctly-typed params decoded from the route schema.
      const loader = (ctx: LoaderContext): Effect.Effect<unknown, unknown> =>
        (config.loader
          ? liftLoader(config.loader(ctx as LoaderContext<PathParams, SearchParams>))
          : Effect.succeed(null)) as Effect.Effect<unknown, unknown>;

      const head = Option.fromNullable(config.head).pipe(
        Option.map((fn) => (ctx: HeadContext): Effect.Effect<HeadData, unknown> => {
          const result = fn(ctx as HeadContext<LoaderData, PathParams, SearchParams>);
          return (Effect.isEffect(result) ? result : Effect.succeed(result)) as Effect.Effect<
            HeadData,
            unknown
          >;
        }),
      );

      const getStaticPaths = Option.fromNullable(config.getStaticPaths).pipe(
        Option.map((fn) => (): Effect.Effect<ReadonlyArray<Record<string, unknown>>, unknown> => {
          const result = fn();
          return (Effect.isEffect(result) ? result : Effect.succeed(result)) as Effect.Effect<
            ReadonlyArray<Record<string, unknown>>,
            unknown
          >;
        }),
      );

      // Type-erasure boundary for action: ActionR/ActionE are captured by the Layer's R type.
      // Cast to base ActionConfig to erase generic parameters, same pattern as loader/head.
      const action = Option.fromNullable(config.action as ActionConfig | undefined).pipe(
        Option.map(buildRouteAction),
      );

      const handler: RouteHandler = {
        routeName,
        route,
        loader,
        component: config.component as (props: ComponentProps) => VElement,
        head,
        action,
        prerender: config.prerender ?? false,
        getStaticPaths,
      };

      return buildHandlers([...handlers, handler]) as GroupHandlers<GroupName, RouteNames, any>;
    },
  });

  return buildHandlers([]);
}

/**
 * Create handlers builder for a layout group.
 * RouteNames is threaded through to constrain handle() calls.
 */
function makeLayoutGroupHandlers<GroupName extends string, RouteNames extends string>(
  groupName: GroupName,
  layoutGrp: LayoutGroup<GroupName, RouteNames>,
): LayoutGroupHandlers<GroupName, RouteNames> {
  const routesByName = new Map<string, Route>(layoutGrp.routes.map((r) => [r.name, r]));

  const buildHandlers = (
    handlers: readonly RouteHandler[],
    layoutHandler: LayoutHandler | null,
  ): LayoutGroupHandlers<GroupName, RouteNames> => ({
    groupName,
    handlers,
    layoutHandler,

    layout(component: () => VElement) {
      return buildHandlers(handlers, {
        layoutName: groupName,
        component,
      });
    },

    handle<
      RouteName extends RouteNames,
      LoaderData,
      PathParams extends Record<string, unknown>,
      SearchParams extends Record<string, unknown>,
      R2,
      E,
      ActionData,
      ActionR,
      ActionE,
    >(
      routeName: RouteName,
      config: HandlerConfig<
        LoaderData,
        PathParams,
        SearchParams,
        R2,
        E,
        ActionData,
        ActionR,
        ActionE
      >,
    ) {
      const maybeRoute = Option.fromNullable(routesByName.get(routeName));
      if (Option.isNone(maybeRoute)) {
        throw new RouterError({
          message: `Route "${routeName}" not found in layout group "${groupName}"`,
        });
      }
      const route = maybeRoute.value;

      // Type-erasure boundary: loader/head/getStaticPaths are stored with R = never
      // because their actual requirements (R2) are captured by the Layer's R type parameter.
      // Casts to LoaderContext<PathParams, SearchParams> are safe — RouterOutlet always
      // passes correctly-typed params decoded from the route schema.
      const loader = (ctx: LoaderContext): Effect.Effect<unknown, unknown> =>
        (config.loader
          ? liftLoader(config.loader(ctx as LoaderContext<PathParams, SearchParams>))
          : Effect.succeed(null)) as Effect.Effect<unknown, unknown>;

      const head = Option.fromNullable(config.head).pipe(
        Option.map((fn) => (ctx: HeadContext): Effect.Effect<HeadData, unknown> => {
          const result = fn(ctx as HeadContext<LoaderData, PathParams, SearchParams>);
          return (Effect.isEffect(result) ? result : Effect.succeed(result)) as Effect.Effect<
            HeadData,
            unknown
          >;
        }),
      );

      const getStaticPaths = Option.fromNullable(config.getStaticPaths).pipe(
        Option.map((fn) => (): Effect.Effect<ReadonlyArray<Record<string, unknown>>, unknown> => {
          const result = fn();
          return (Effect.isEffect(result) ? result : Effect.succeed(result)) as Effect.Effect<
            ReadonlyArray<Record<string, unknown>>,
            unknown
          >;
        }),
      );

      // Type-erasure boundary for action: ActionR/ActionE are captured by the Layer's R type.
      // Cast to base ActionConfig to erase generic parameters, same pattern as loader/head.
      const action = Option.fromNullable(config.action as ActionConfig | undefined).pipe(
        Option.map(buildRouteAction),
      );

      const handler: RouteHandler = {
        routeName,
        route,
        loader,
        component: config.component as (props: ComponentProps) => VElement,
        head,
        action,
        prerender: config.prerender ?? false,
        getStaticPaths,
      };

      return buildHandlers([...handlers, handler], layoutHandler) as LayoutGroupHandlers<
        GroupName,
        RouteNames,
        any
      >;
    },
  });

  return buildHandlers([], null);
}

/**
 * Create a Layer that provides handlers for a route group.
 *
 * Accepts the RouteGroup directly (not a string name) so that handle()
 * is constrained to valid route names at compile time.
 *
 * The build callback can return either:
 * - GroupHandlers directly (simple case)
 * - Effect<GroupHandlers> (when you need Effect context in handlers)
 *
 * Usage:
 * ```typescript
 * // Simple - no Effect wrapper needed
 * const AppRoutesLive = RouterBuilder.group(
 *   AppRouter,
 *   AppRoutes,   // pass the RouteGroup for type-safe handle()
 *   (handlers) => handlers
 *     .handle("home", { component: () => <HomePage /> })    // constrained
 *     .handle("posts", { loader: () => fetchPosts(), component: ... })
 * )
 * ```
 */
export function group<GroupName extends string, RouteNames extends string, R>(
  _appRouter: Router,
  routeGroup: RouteGroup<GroupName, RouteNames>,
  build: (
    handlers: GroupHandlers<GroupName, RouteNames>,
  ) => GroupHandlers<GroupName, RouteNames, R>,
): Layer.Layer<RouterHandlers, never, R>;
export function group<GroupName extends string, RouteNames extends string, R, R2>(
  _appRouter: Router,
  routeGroup: RouteGroup<GroupName, RouteNames>,
  build: (
    handlers: GroupHandlers<GroupName, RouteNames>,
  ) => Effect.Effect<GroupHandlers<GroupName, RouteNames, R>, never, R2>,
): Layer.Layer<RouterHandlers, never, R | R2>;
export function group<GroupName extends string, RouteNames extends string, R, R2>(
  _appRouter: Router,
  routeGroup: RouteGroup<GroupName, RouteNames>,
  build: (
    handlers: GroupHandlers<GroupName, RouteNames>,
  ) =>
    | GroupHandlers<GroupName, RouteNames, R>
    | Effect.Effect<GroupHandlers<GroupName, RouteNames, R>, never, R2>,
): Layer.Layer<RouterHandlers, never, R | R2> {
  // Validate it's not a layout group (runtime safety net — types should prevent this)
  if ((routeGroup as AnyGroup)._tag === "LayoutGroup") {
    return Layer.effect(
      RouterHandlers,
      Effect.die(
        new RouterError({
          message: `Group "${routeGroup.name}" is a LayoutGroup. Use RouterBuilder.layoutGroup() instead.`,
        }),
      ),
    ) as Layer.Layer<RouterHandlers, never, R | R2>;
  }

  const initialHandlers = makeGroupHandlers(routeGroup.name, routeGroup);

  // The Layer construction only needs the build callback's R2. The loader requirements (R)
  // are needed at execution time (when serverLayer/browserLayer call handler.loader).
  // We widen the type to include R so consumers must provide loader dependencies.
  return Layer.effect(
    RouterHandlers,
    Effect.gen(function* () {
      const result = build(initialHandlers);
      const builtHandlers = Effect.isEffect(result) ? yield* result : result;

      const handlersMap = new Map<string, RouteHandler>(
        builtHandlers.handlers.map((h) => [h.routeName, h]),
      );

      return {
        handlers: handlersMap,
        layoutHandlers: new Map(),
        getHandler(routeName: string): Option.Option<RouteHandler> {
          const handler = handlersMap.get(routeName);
          return handler ? Option.some(handler) : Option.none();
        },
        getLayoutHandler(_layoutName: string): Option.Option<LayoutHandler> {
          return Option.none();
        },
      };
    }),
  ) as Layer.Layer<RouterHandlers, never, R | R2>;
}

/**
 * Create a Layer that provides handlers for a layout group.
 *
 * Accepts the LayoutGroup directly for type-safe handle() calls.
 *
 * Usage:
 * ```typescript
 * const DashboardRoutesLive = RouterBuilder.layoutGroup(
 *   AppRouter,
 *   DashboardRoutes,
 *   (handlers) => handlers
 *     .layout(DashboardLayout)
 *     .handle("overview", { component: () => <Overview /> })
 *     .handle("settings", { component: () => <Settings /> })
 * )
 * ```
 */
export function layoutGroup<GroupName extends string, RouteNames extends string, R>(
  _appRouter: Router,
  layoutGrp: LayoutGroup<GroupName, RouteNames>,
  build: (
    handlers: LayoutGroupHandlers<GroupName, RouteNames>,
  ) => LayoutGroupHandlers<GroupName, RouteNames, R>,
): Layer.Layer<RouterHandlers, never, R>;
export function layoutGroup<GroupName extends string, RouteNames extends string, R, R2>(
  _appRouter: Router,
  layoutGrp: LayoutGroup<GroupName, RouteNames>,
  build: (
    handlers: LayoutGroupHandlers<GroupName, RouteNames>,
  ) => Effect.Effect<LayoutGroupHandlers<GroupName, RouteNames, R>, never, R2>,
): Layer.Layer<RouterHandlers, never, R | R2>;
export function layoutGroup<GroupName extends string, RouteNames extends string, R, R2>(
  _appRouter: Router,
  layoutGrp: LayoutGroup<GroupName, RouteNames>,
  build: (
    handlers: LayoutGroupHandlers<GroupName, RouteNames>,
  ) =>
    | LayoutGroupHandlers<GroupName, RouteNames, R>
    | Effect.Effect<LayoutGroupHandlers<GroupName, RouteNames, R>, never, R2>,
): Layer.Layer<RouterHandlers, never, R | R2> {
  // Runtime safety net — types should prevent this
  if ((layoutGrp as AnyGroup)._tag !== "LayoutGroup") {
    return Layer.effect(
      RouterHandlers,
      Effect.die(
        new RouterError({
          message: `Group "${layoutGrp.name}" is not a LayoutGroup. Use RouterBuilder.group() instead.`,
        }),
      ),
    ) as Layer.Layer<RouterHandlers, never, R | R2>;
  }

  const initialHandlers = makeLayoutGroupHandlers(layoutGrp.name, layoutGrp);

  return Layer.effect(
    RouterHandlers,
    Effect.gen(function* () {
      const result = build(initialHandlers);
      const builtHandlers = Effect.isEffect(result) ? yield* result : result;

      const handlersMap = new Map<string, RouteHandler>(
        builtHandlers.handlers.map((h) => [h.routeName, h]),
      );

      const layoutHandlersMap = new Map<string, LayoutHandler>();
      if (builtHandlers.layoutHandler) {
        layoutHandlersMap.set(builtHandlers.layoutHandler.layoutName, builtHandlers.layoutHandler);
      }

      return {
        handlers: handlersMap,
        layoutHandlers: layoutHandlersMap,
        getHandler(routeName: string): Option.Option<RouteHandler> {
          const handler = handlersMap.get(routeName);
          return handler ? Option.some(handler) : Option.none();
        },
        getLayoutHandler(layoutName: string): Option.Option<LayoutHandler> {
          const handler = layoutHandlersMap.get(layoutName);
          return handler ? Option.some(handler) : Option.none();
        },
      };
    }),
  ) as Layer.Layer<RouterHandlers, never, R | R2>;
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
    layoutHandlers: new Map(),
    getHandler(_routeName: string): Option.Option<RouteHandler> {
      return Option.none();
    },
    getLayoutHandler(_layoutName: string): Option.Option<LayoutHandler> {
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
  ctx: LoaderContext,
): Effect.Effect<VElement, unknown> {
  return Effect.gen(function* () {
    const loaderData = yield* handler.loader(ctx);
    const noopFormAction = () =>
      Effect.fail({ _tag: "ActionError", message: "Actions not available in executeRoute" });
    return handler.component({
      loaderData,
      path: ctx.path,
      searchParams: ctx.searchParams,
      actionData: Option.none(),
      formAction: noopFormAction,
      submissionState: { _tag: "Idle" },
    });
  });
}

/**
 * A prerender route paired with its enumerated param sets.
 */
export interface PrerenderRoute {
  readonly handler: RouteHandler;
  readonly paramSets: ReadonlyArray<Record<string, unknown>>;
}

/**
 * Extract all prerender routes with their static path parameters.
 *
 * For each route with `prerender: true`:
 * - If `getStaticPaths` is defined, calls it to enumerate all param sets
 * - Otherwise, defaults to `[{}]` (a single page with no params)
 */
export const getPrerenderRoutes = (handlers: {
  readonly handlers: ReadonlyMap<string, RouteHandler>;
}): Effect.Effect<ReadonlyArray<PrerenderRoute>, unknown> =>
  Effect.all(
    Array.from(handlers.handlers.values())
      .filter((h) => h.prerender)
      .map((handler) =>
        Option.match(handler.getStaticPaths, {
          onNone: () => Effect.succeed([{}] as ReadonlyArray<Record<string, unknown>>),
          onSome: (fn) => fn(),
        }).pipe(Effect.map((paramSets): PrerenderRoute => ({ handler, paramSets }))),
      ),
  );
