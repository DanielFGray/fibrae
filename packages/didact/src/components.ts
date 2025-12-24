import * as Effect from "effect/Effect";
import * as Context from "effect/Context";

import { type VElement } from "./shared.js";

// =============================================================================
// Error Boundary Channel
// =============================================================================

/**
 * Error boundary channel - a Deferred that async errors can fail to trigger fallback.
 * Created by ErrorBoundary and provided via context to children.
 * Children (event handlers, stream subscriptions) can fail this to report errors.
 */
export class ErrorBoundaryChannel extends Context.Tag("ErrorBoundaryChannel")<
  ErrorBoundaryChannel,
  {
    readonly reportError: (error: unknown) => Effect.Effect<void, never, never>;
  }
>() { }

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
  children?: VElement | VElement[];
}): VElement => {
  const childrenArray = Array.isArray(props.children) ? props.children : props.children ? [props.children] : [];

  if (childrenArray.length === 0) {
    throw new Error("Suspense requires at least one child");
  }

  // Return a special marker element that renderVElementToDOM will handle
  return {
    type: "SUSPENSE" as const,
    props: {
      fallback: props.fallback,
      threshold: props.threshold ?? 100,
      children: childrenArray,
    },
  };
};

/**
 * ErrorBoundary - catches errors from children and renders fallback.
 * Returns a special VElement that renderVElementToDOM handles specially.
 */
export const ErrorBoundary = (props: {
  fallback: VElement;
  onError?: (cause: unknown) => void;
  children?: VElement | VElement[];
}): VElement => {
  const childrenArray = Array.isArray(props.children) ? props.children : props.children ? [props.children] : [];

  if (childrenArray.length === 0) {
    throw new Error("ErrorBoundary requires at least one child");
  }

  // Return a special marker element that renderVElementToDOM will handle
  return {
    type: "ERROR_BOUNDARY" as const,
    props: {
      fallback: props.fallback,
      onError: props.onError,
      children: childrenArray,
    },
  };
};
