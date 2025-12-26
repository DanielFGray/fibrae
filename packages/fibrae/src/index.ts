// =============================================================================
// Public API
// =============================================================================

// Main render function
export { render } from "./core.js";

// Runtime
export { FibraeRuntime, CustomAtomRegistryLayer } from "./runtime.js";

// Built-in components
export { Suspense, ErrorBoundary } from "./components.js";

// Element creation (JSX factory)
export { h, createTextElement } from "./h.js";

// Types
export type { VElement, ElementType, Primitive } from "./shared.js";
export type { VElement as VNode } from "./shared.js";

// Re-export upstream Effect Atom APIs for consumers
export { Atom, Registry as AtomRegistry } from "@effect-atom/atom";

// Router
export * as Route from "./router/Route.js";
export * as Router from "./router/Router.js";
export * as RouterBuilder from "./router/RouterBuilder.js";
export * as History from "./router/History.js";
export * as Navigator from "./router/Navigator.js";
export * as RouterState from "./router/RouterState.js";

export type {
  LoaderContext,
  ComponentProps,
  HandlerConfig,
  RouteHandler,
  GroupHandlers,
} from "./router/RouterBuilder.js";

export { RouterHandlers } from "./router/RouterBuilder.js";

export type { HistoryLocation, HistoryService } from "./router/History.js";
export { History as HistoryTag, BrowserHistoryLive, MemoryHistoryLive } from "./router/History.js";

export type { CurrentRoute, NavigateOptions, NavigatorService } from "./router/Navigator.js";
export { Navigator as NavigatorTag, NavigatorLive } from "./router/Navigator.js";

export type { LinkProps } from "./router/Link.js";
export { createLink } from "./router/Link.js";

export type { RouterOutletProps } from "./router/RouterOutlet.js";
export { RouterOutlet } from "./router/RouterOutlet.js";

export type {
  ServerLayerOptions,
  BrowserLayerOptions,
  DehydratedRouterState,
  SSRRouteResult,
} from "./router/Router.js";
export { CurrentRouteElement } from "./router/Router.js";

export {
  RouterStateAtom,
  RouterStateService,
  RouterStateSchema,
  getRouterState,
  getLoaderData,
  getRouteParams,
} from "./router/RouterState.js";
