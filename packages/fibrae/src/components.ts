import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { type ComponentError, type VElement } from "./shared.js";

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
  children?: VElement | VElement[];
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
  return {
    type: "SUSPENSE" as const,
    props: {
      fallback: props.fallback,
      threshold: props.threshold ?? 100,
      children: childrenArray,
    },
  };
};

// =============================================================================
// Effect-Native Error Boundary
// =============================================================================

// Counter for generating unique boundary IDs
let boundaryIdCounter = 0;

/**
 * Normalize children to an array of VElements.
 */
const normalizeChildren = (children: VElement | VElement[]): VElement[] =>
  Array.isArray(children) ? children : [children];

/**
 * Creates an Effect-native error boundary around children.
 *
 * Returns a `Stream<VElement, ComponentError, never>` that can be piped with
 * `Stream.catchTags` for fully typed error handling.
 *
 * @example
 * ```tsx
 * // Create a boundary with typed error handlers as a wrapper component
 * const SafeApp = () => ErrorBoundary(<App />).pipe(
 *   Stream.catchTags({
 *     RenderError: (e) => Stream.succeed(<div>Render failed: {e.componentName}</div>),
 *     StreamError: (e) => Stream.succeed(<div>Stream failed: {e.phase}</div>),
 *     EventHandlerError: (e) => Stream.succeed(<div>Event {e.eventType} failed</div>),
 *   })
 * );
 *
 * // Use it like any other component
 * <SafeApp />
 * ```
 *
 * **How it works:**
 * 1. `ErrorBoundary()` returns a Stream that first emits a BOUNDARY marker element
 * 2. The renderer detects this marker and sets up error handling
 * 3. If any error occurs in the subtree, the Stream fails with that ComponentError
 * 4. `Stream.catchTags` catches the error and produces a fallback Stream
 * 5. The fallback VElement is rendered in place of the failed content
 *
 * **Nesting:** Boundaries nest naturally - inner boundary catches first, unhandled
 * errors propagate to outer boundary following Effect/Stream error propagation rules.
 *
 * @param children - The VElement(s) to wrap in an error boundary
 * @returns Stream<VElement, ComponentError, never> - pipe with Stream.catchTags to handle errors
 */
export const ErrorBoundary = (
  children: VElement | VElement[],
): Stream.Stream<VElement, ComponentError, never> => {
  const boundaryId = `boundary-${++boundaryIdCounter}`;
  const childrenArray = normalizeChildren(children);

  if (childrenArray.length === 0) {
    return Stream.die("ErrorBoundary() requires at least one child");
  }

  // Create a stream that:
  // 1. Emits the BOUNDARY marker with an onError callback
  // 2. When onError is called, the stream fails with that error
  // 3. Stream stays open until error or unmount
  return Stream.async<VElement, ComponentError>((emit) => {
    // Create the BOUNDARY marker with error callback wired to stream failure
    const boundaryElement: VElement = {
      type: "BOUNDARY" as const,
      props: {
        children: childrenArray,
        boundaryId,
        // When renderer detects an error in subtree, it calls this
        onError: (error: ComponentError) => {
          void emit.fail(error);
        },
      },
    };

    // Emit the marker immediately
    void emit.single(boundaryElement);

    // Stream stays open - it will fail when onError is called
    // or be cancelled when the component unmounts
  });
};
