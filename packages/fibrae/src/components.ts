import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

import { type ComponentError, type VChild, type VElement } from "./shared.js";

// =============================================================================
// Error Boundary Channel
// =============================================================================

/**
 * Error boundary channel - used by ErrorBoundary for async error reporting.
 * Created by ErrorBoundary and provided via context to children.
 * Children (event handlers, stream subscriptions) can report errors to this channel.
 *
 * The channel includes:
 * - reportError: for async errors (event handlers, streams)
 * - boundaryId: optional unique identifier for this boundary (for debugging)
 */
export class ErrorBoundaryChannel extends Context.Tag("ErrorBoundaryChannel")<
  ErrorBoundaryChannel,
  {
    /** Report an error to this boundary. Used by event handlers and stream subscriptions. */
    readonly reportError: (error: unknown) => Effect.Effect<void, never, never>;
    /** Optional unique identifier for this boundary (for debugging/logging) */
    readonly boundaryId?: string;
  }
>() {}

// =============================================================================
// Built-in Components
// =============================================================================

/**
 * Suspense component - shows fallback while waiting for children to emit.
 * Returns a special VElement that renderVElementToDOM handles specially.
 *
 * Uses a threshold-based strategy:
 * - If children complete rendering within `threshold` ms, skip fallback entirely
 * - If children take longer, show fallback immediately, then swap to children when ready
 *
 * @param fallback - VElement to show while waiting (only if children are slow)
 * @param threshold - Milliseconds to wait before showing fallback (default: 100ms)
 * @param children - Child components (may be async Effects or Streams)
 */
export const Suspense = (props: {
  fallback: VElement;
  threshold?: number;
  children?: VChild | VChild[];
}): VElement => {
  const childrenArray = Array.isArray(props.children)
    ? props.children
    : props.children
      ? [props.children]
      : [];

  if (childrenArray.length === 0) {
    throw new Error("Suspense requires at least one child");
  }

  // Return a special marker element that renderVElementToDOM will handle
  // Cast: VChild[] → VElement[] at the type-erasure boundary;
  // the fiber renderer resolves Effects/Streams during reconciliation.
  return {
    type: "SUSPENSE" as const,
    props: {
      fallback: props.fallback,
      threshold: props.threshold ?? 100,
      children: childrenArray as VElement[],
    },
  };
};

// =============================================================================
// Error Boundary
// =============================================================================

// Counter for generating unique boundary IDs
let boundaryIdCounter = 0;

/**
 * Normalize children to an array of VElements.
 */
const normalizeChildren = (children: VChild | VChild[]): VElement[] =>
  (Array.isArray(children) ? children : [children]) as VElement[];

/**
 * Error boundary component — catches errors in its subtree and shows a fallback.
 *
 * Supports recovery: when children re-emit (e.g. route change), the boundary
 * resets and shows the new content. Children are "parked" during error state
 * (subscriptions stay alive), similar to how Suspense works.
 *
 * @example
 * ```tsx
 * <ErrorBoundary fallback={(error) => <div>Error: {error._tag}</div>}>
 *   <RouterOutlet />
 * </ErrorBoundary>
 * ```
 *
 * The `error` parameter is a `ComponentError` union — match on `_tag` for
 * per-type handling:
 *
 * ```tsx
 * const fallback = (error: ComponentError) => {
 *   switch (error._tag) {
 *     case "RenderError": return <div>Render failed: {error.componentName}</div>
 *     case "StreamError": return <div>Stream failed in {error.phase}</div>
 *     case "EventHandlerError": return <div>Event {error.eventType} failed</div>
 *   }
 * }
 * ```
 *
 * @param props.fallback - Function that receives the error and returns fallback UI
 * @param props.children - Child components to wrap in the error boundary
 */
export const ErrorBoundary = (props: {
  fallback: (error: ComponentError) => VElement;
  children?: VChild | VChild[];
}): VElement => {
  const childrenArray = props.children ? normalizeChildren(props.children) : [];

  if (childrenArray.length === 0) {
    throw new Error("ErrorBoundary requires at least one child");
  }

  return {
    type: "BOUNDARY" as const,
    props: {
      children: childrenArray,
      boundaryId: `boundary-${++boundaryIdCounter}`,
      fallback: props.fallback,
    },
  };
};
