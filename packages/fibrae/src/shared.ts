import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as Effect from "effect/Effect";
import * as Scope from "effect/Scope";
import * as Deferred from "effect/Deferred";
import * as Data from "effect/Data";
import * as Context from "effect/Context";
import { Atom as BaseAtom } from "@effect-atom/atom";

/**
 * Primitive element types: HTML tags, text nodes, fragments, suspense, or boundary
 */
export type Primitive =
  | keyof HTMLElementTagNameMap
  | "TEXT_ELEMENT"
  | "FRAGMENT"
  | "SUSPENSE"
  | "BOUNDARY";

/**
 * What can appear as children in JSX (recursive type)
 * Includes primitives, VElements, and arrays thereof
 */
export type VChild =
  | VElement
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined
  | VChild[];

/**
 * What components can return - VElement or wrapped in Effect/Stream
 */
export type VNode =
  | VElement
  | Effect.Effect<VElement, any, any>
  | Stream.Stream<VElement, any, any>;

/**
 * Element type can be a primitive or a component function
 * Components can return VNode (VElement, Effect<VElement>, or Stream<VElement>)
 */
export type ElementType<Props = {}> =
  | Primitive
  | ((props: Props) => VNode);

/**
 * Virtual element representation - the core unit of the virtual DOM
 */
export interface VElement {
  type: ElementType;
  props: {
    [key: string]: unknown;
    children?: VElement[];
  };
}

/**
 * Mutable reference to a fiber for component instances
 */
export type FiberRef = { current: Fiber };

/**
 * Suspense boundary configuration
 *
 * Supports optimistic rendering: try children first, show fallback if they take
 * too long. Suspended fibers are "parked" to continue processing in background.
 */
export type SuspenseConfig = {
  fallback: VElement;
  threshold: number;
  showingFallback: boolean;
  /** Reference to the original child fiber that's still processing in background */
  parkedFiber: Option.Option<Fiber>;
  /** Deferred that signals when parked fiber completes first render */
  parkedComplete: Option.Option<Deferred.Deferred<void>>;
};

/**
 * Effect-native boundary configuration (ErrorBoundary API)
 * 
 * Created when the renderer encounters a BOUNDARY marker from ErrorBoundary().
 * The onError callback fails the boundary's stream, triggering catchTags.
 */
export type BoundaryConfig = {
  /** Unique identifier for this boundary (for debugging) */
  boundaryId: string;
  /** Callback to report errors - fails the boundary stream */
  onError: (error: ComponentError) => void;
  /** True when an error has occurred and fallback is being shown */
  hasError: boolean;
};

/**
 * Fiber node - represents a unit of work in the reconciliation tree
 * Contains all state needed for rendering, effects, and diffing
 */
export interface Fiber {
  type: Option.Option<ElementType>;
  props: {
    [key: string]: unknown;
    children?: VElement[];
  };
  dom: Option.Option<Node>;
  parent: Option.Option<Fiber>;
  child: Option.Option<Fiber>;
  sibling: Option.Option<Fiber>;
  alternate: Option.Option<Fiber>;
  effectTag: Option.Option<"UPDATE" | "PLACEMENT" | "DELETION">;
  componentScope: Option.Option<Scope.Scope>;
  accessedAtoms: Option.Option<Set<BaseAtom.Atom<any>>>;
  latestStreamValue: Option.Option<VElement>;
  childFirstCommitDeferred: Option.Option<Deferred.Deferred<void>>;
  fiberRef: Option.Option<FiberRef>;
  isMultiEmissionStream: boolean;
  /** Effect-native boundary config (ErrorBoundary API) */
  boundary: Option.Option<BoundaryConfig>;
  suspense: Option.Option<SuspenseConfig>;
  /** Context captured during render phase, used for event handlers in commit phase */
  renderContext: Option.Option<Context.Context<unknown>>;
  /** True if this fiber is parked (suspended) - scope should not be closed on deletion */
  isParked: boolean;
  /** True when fiber is being restored from parked state - skip component re-execution */
  isUnparking: boolean;
}

/**
 * Helper to check if a key is an event handler
 */
export const isEvent = (key: string) => key.startsWith("on");

/**
 * Helper to check if a key is a regular property (not children, ref, key, or event)
 */
export const isProperty = (key: string) =>
  key !== "children" && key !== "ref" && key !== "key" && !isEvent(key);

/**
 * Check if an element type is a primitive (string) or component (function)
 */
export const isPrimitive = (type: ElementType): type is Primitive => typeof type === "string";

/**
 * Check if element type is a component function
 */
export const isComponent = (type: ElementType) => typeof type === "function";

export const isStream = (value: unknown): value is Stream.Stream<any, any, any> =>
  typeof value === "object" && value !== null && Stream.StreamTypeId in value;

// =============================================================================
// Hydration Errors
// =============================================================================

/**
 * Error thrown when DOM structure doesn't match VElement tree during hydration.
 *
 * This is a tagged error that can be caught via Effect.catchTag("HydrationMismatch", ...).
 *
 * Structural mismatches (tag name, child count) indicate a bug where server and client
 * rendered different component trees.
 *
 * @example
 * ```typescript
 * yield* render(<App />, container, { initialState }).pipe(
 *   Effect.catchTag("HydrationMismatch", (err) => {
 *     console.error(`Hydration failed at ${err.path}: expected ${err.expected}, got ${err.actual}`);
 *     // Fallback: clear container and do fresh render
 *     container.innerHTML = "";
 *     return render(<App />, container);
 *   })
 * );
 * ```
 */
export class HydrationMismatch extends Data.TaggedError("HydrationMismatch")<{
  /** What the VElement tree expected (e.g., "div", "3 children") */
  readonly expected: string;
  /** What the DOM actually had (e.g., "span", "2 children") */
  readonly actual: string;
  /** Human-readable path to the mismatch location (e.g., "div > ul > li:2") */
  readonly path: string;
}> {}

// =============================================================================
// Component Errors
// =============================================================================

/**
 * Error during component render (sync throw or Effect failure).
 *
 * Caught by ErrorBoundary and can be handled via Stream.catchTags:
 * ```typescript
 * const SafeApp = () => ErrorBoundary(<MyComponent />).pipe(
 *   Stream.catchTags({
 *     RenderError: (e) => Stream.succeed(<div>Render failed: {e.componentName}</div>),
 *   })
 * );
 * ```
 */
export class RenderError extends Data.TaggedError("RenderError")<{
  /** The underlying error that caused the render failure */
  readonly cause: unknown;
  /** Name of the component that failed (if available) */
  readonly componentName?: string;
}> {}

/**
 * Error from a Stream component (before or after first emission).
 *
 * The `phase` field distinguishes:
 * - "before-first-emission": Stream failed before producing any value (shows fallback immediately)
 * - "after-first-emission": Stream failed after showing content (replaces content with fallback)
 */
export class StreamError extends Data.TaggedError("StreamError")<{
  /** The underlying error that caused the stream failure */
  readonly cause: unknown;
  /** When the error occurred relative to first emission */
  readonly phase: "before-first-emission" | "after-first-emission";
}> {}

/**
 * Error from an event handler Effect.
 *
 * The `eventType` field indicates which event triggered the failure (e.g., "click", "change").
 */
export class EventHandlerError extends Data.TaggedError("EventHandlerError")<{
  /** The underlying error that caused the event handler failure */
  readonly cause: unknown;
  /** The DOM event type that triggered this handler (e.g., "click", "change") */
  readonly eventType: string;
}> {}

/**
 * Union of all component error types.
 * Used with ErrorBoundary's onError handlers for typed error matching.
 */
export type ComponentError = RenderError | StreamError | EventHandlerError;
