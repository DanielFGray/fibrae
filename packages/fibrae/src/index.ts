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
export {
  RenderError,
  StreamError,
  EventHandlerError,
  type ComponentError,
} from "./shared.js";

// Component lifecycle
export { ComponentScope } from "./shared.js";

// Re-export upstream Effect Atom APIs for consumers
export { Atom, Registry as AtomRegistry } from "@effect-atom/atom";

// Router available via "fibrae/router" import
