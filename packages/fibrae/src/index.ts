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

// Error types
export { RenderError, StreamError, EventHandlerError, type ComponentError } from "./shared.js";

// Component lifecycle
export { ComponentScope, createRef } from "./shared.js";
export type { Ref } from "./shared.js";

// Hydration state service
export { HydrationState, HydrationStateLive, HydrationStateEmpty } from "./hydration-state.js";

// Re-export upstream Effect Atom APIs for consumers
export {
  Atom,
  AtomHttpApi,
  AtomRef,
  AtomRpc,
  Hydration,
  Registry as AtomRegistry,
  Result,
} from "@effect-atom/atom";

// Component-scoped atom utilities
export { mountAtom, subscribeAtom } from "./atom-utils.js";

// Router available via "fibrae/router" import
