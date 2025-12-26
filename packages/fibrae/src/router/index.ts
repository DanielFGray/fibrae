/**
 * Router module exports.
 *
 * Provides Effect-first routing with the HttpApi pattern:
 * - Route declarations with schema-validated params
 * - RouterBuilder for handler implementation
 * - History service for navigation
 * - Type-safe navigation
 */

// Route declaration
export * as Route from "./Route.js";

// Router and groups
export * as Router from "./Router.js";

// Handler implementation
export * as RouterBuilder from "./RouterBuilder.js";

// History service
export * as History from "./History.js";

// Navigator service
export * as Navigator from "./Navigator.js";

// Router state (unified serializable state)
export * as RouterState from "./RouterState.js";

// Re-export types
export type {
  LoaderContext,
  ComponentProps,
  HandlerConfig,
  RouteHandler,
  GroupHandlers,
} from "./RouterBuilder.js";

export { RouterHandlers } from "./RouterBuilder.js";

// Re-export History types and service tag
export type { HistoryLocation, HistoryService } from "./History.js";
export { History as HistoryTag, BrowserHistoryLive, MemoryHistoryLive } from "./History.js";

// Re-export Navigator types and service tag
export type { CurrentRoute, NavigateOptions, NavigatorService } from "./Navigator.js";
export { Navigator as NavigatorTag, NavigatorLive } from "./Navigator.js";

// Re-export Link component factory
export type { LinkProps } from "./Link.js";
export { createLink } from "./Link.js";

// Re-export RouterOutlet component
export type { RouterOutletProps } from "./RouterOutlet.js";
export { RouterOutlet } from "./RouterOutlet.js";

// Re-export SSR integration types and functions
export type {
  ServerLayerOptions,
  BrowserLayerOptions,
  DehydratedRouterState,
  SSRRouteResult,
} from "./Router.js";
export { CurrentRouteElement } from "./Router.js";

// Re-export RouterState utilities for convenience
// (RouterState type is accessible via RouterState.RouterState namespace)
export {
  RouterStateAtom,
  RouterStateService,
  RouterStateSchema,
  getRouterState,
  getLoaderData,
  getRouteParams,
} from "./RouterState.js";
