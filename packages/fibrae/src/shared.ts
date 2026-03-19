import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as Effect from "effect/Effect";
import * as Scope from "effect/Scope";
import * as Deferred from "effect/Deferred";
import * as Schema from "effect/Schema";
import * as Context from "effect/Context";
// Import Cause and Types for declaration file emission (needed by Schema.TaggedError)
import type * as Cause from "effect/Cause";
import type * as Types from "effect/Types";
import { Atom as BaseAtom } from "@effect-atom/atom";

// Re-export to satisfy declaration file requirements
export type { Cause, Types };

// =============================================================================
// Component Scope Service
// =============================================================================

/**
 * Service tag for accessing the current component's scope and mount signal.
 *
 * Provides:
 * - `scope`: Register cleanup logic that runs when the component unmounts
 * - `mounted`: Deferred that resolves after the component's DOM subtree commits
 *
 * @example
 * ```tsx
 * const JsonEditor = () =>
 *   Effect.gen(function* () {
 *     const { scope, mounted } = yield* ComponentScope;
 *     const containerRef = createRef<HTMLDivElement>();
 *
 *     // Fork an effect that waits for mount, then initializes
 *     yield* pipe(
 *       Effect.gen(function* () {
 *         yield* Deferred.await(mounted); // Wait for DOM to be ready
 *         const editor = monaco.create(containerRef.current!);
 *         yield* Scope.addFinalizer(scope, Effect.sync(() => editor.dispose()));
 *       }),
 *       Effect.forkScoped,
 *       Scope.extend(scope)
 *     );
 *
 *     return <div ref={containerRef} />;
 *   });
 * ```
 *
 * For simple cleanup without waiting for mount:
 *
 * @example
 * ```tsx
 * const JsonEditor = () =>
 *   Effect.gen(function* () {
 *     const { scope } = yield* ComponentScope;
 *
 *     // Register cleanup that runs on unmount
 *     yield* Scope.addFinalizer(scope, Effect.sync(() => {
 *       console.log("Editor unmounted");
 *     }));
 *
 *     return <div />;
 *   });
 * ```
 */
export class ComponentScope extends Context.Tag("fibrae/ComponentScope")<
  ComponentScope,
  { scope: Scope.Scope; mounted: Deferred.Deferred<void> }
>() {}

// =============================================================================
// Ref
// =============================================================================

/**
 * Mutable ref container for DOM elements.
 *
 * Type parameter `E` is inferred from JSX context:
 * - `<div ref={ref}>` expects `Ref<HTMLDivElement>`
 * - `<input ref={ref}>` expects `Ref<HTMLInputElement>`
 * - `<svg ref={ref}>` expects `Ref<SVGSVGElement>`
 *
 * @example
 * ```tsx
 * const MyComponent = () =>
 *   Effect.gen(function* () {
 *     const divRef = createRef<HTMLDivElement>();
 *     return <div ref={divRef}>hello</div>;
 *   });
 * ```
 */
export interface Ref<E extends Element = Element> {
  current: E | null;
}

/**
 * Create a typed ref. The type parameter is inferred when passed to JSX:
 *
 * ```tsx
 * const ref = createRef<HTMLDivElement>();
 * <div ref={ref} />  // OK
 * <span ref={ref} /> // Type error: HTMLSpanElement is not HTMLDivElement
 * ```
 */
export const createRef = <E extends Element = Element>(): Ref<E> => ({ current: null });

/**
 * Primitive element types: HTML tags, text nodes, fragments, suspense, or boundary
 */
export type Primitive =
  | keyof HTMLElementTagNameMap
  | keyof SVGElementTagNameMap
  | "TEXT_ELEMENT"
  | "FRAGMENT"
  | "SUSPENSE"
  | "BOUNDARY";

/**
 * What can appear as children in JSX (recursive type)
 * Includes primitives, VElements, Effects, Streams, and arrays thereof
 */
export type VChild =
  | VElement
  | Effect.Effect<VElement, unknown, unknown>
  | Stream.Stream<VElement, unknown, unknown>
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
  | null
  | Effect.Effect<VElement | null, unknown, unknown>
  | Stream.Stream<VElement, unknown, unknown>;

/**
 * Element type can be a primitive or a component function
 * Components can return VNode (VElement, Effect<VElement>, or Stream<VElement>)
 */
export type ElementType<Props = {}> = Primitive | ((props: Props) => VNode);

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
 * Error boundary configuration (ErrorBoundary component)
 *
 * Created when the renderer encounters a BOUNDARY marker from ErrorBoundary.
 * On error, parks children (keeps subscriptions alive) and renders fallback.
 * When parked children emit new values (e.g. route change), boundary resets.
 */
export type BoundaryConfig = {
  /** Unique identifier for this boundary (for debugging) */
  boundaryId: string;
  /** Fallback renderer — called with the caught error to produce fallback UI */
  fallback: (error: ComponentError) => VElement;
  /** True when an error has occurred and fallback is being shown */
  hasError: boolean;
  /** The caught error (when hasError is true) */
  error: Option.Option<ComponentError>;
  /** Reference to the parked child fiber (kept alive for recovery) */
  parkedFiber: Option.Option<Fiber>;
  /** Mutable reference to the current BOUNDARY fiber (survives reconciliation) */
  currentFiber: Option.Option<Fiber>;
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
  componentScope: Option.Option<Scope.Scope.Closeable>;
  /** Deferred that resolves after this component's DOM subtree commits */
  mountedDeferred: Option.Option<Deferred.Deferred<void>>;
  accessedAtoms: Option.Option<Set<BaseAtom.Atom<unknown>>>;
  latestStreamValue: Option.Option<VElement>;
  childFirstCommitDeferred: Option.Option<Deferred.Deferred<void>>;
  fiberRef: Option.Option<FiberRef>;
  isMultiEmissionStream: boolean;
  /** Effect-native boundary config (ErrorBoundary API) */
  boundary: Option.Option<BoundaryConfig>;
  suspense: Option.Option<SuspenseConfig>;
  /** Context captured during render phase, used for event handlers in commit phase */
  renderContext: Option.Option<Context.Context<never>>;
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
  key !== "children" &&
  key !== "ref" &&
  key !== "key" &&
  key !== "dangerouslySetInnerHTML" &&
  !isEvent(key);

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
export class HydrationMismatch extends Schema.TaggedError<HydrationMismatch>()(
  "HydrationMismatch",
  {
    /** What the VElement tree expected (e.g., "div", "3 children") */
    expected: Schema.String,
    /** What the DOM actually had (e.g., "span", "2 children") */
    actual: Schema.String,
    /** Human-readable path to the mismatch location (e.g., "div > ul > li:2") */
    path: Schema.String,
  },
) {}

// =============================================================================
// Component Errors
// =============================================================================

/**
 * Error during component render (sync throw or Effect failure).
 *
 * Caught by ErrorBoundary — match on `_tag` in the fallback:
 * ```tsx
 * <ErrorBoundary fallback={(e) =>
 *   e._tag === "RenderError"
 *     ? <div>Render failed: {e.componentName}</div>
 *     : <div>Error</div>
 * }>
 * ```
 */
/** Format a cause for inclusion in error messages. */
const formatCause = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

export class RenderError extends Schema.TaggedError<RenderError>()("RenderError", {
  /** The underlying error that caused the render failure */
  cause: Schema.Unknown,
  /** Name of the component that failed (if available) */
  componentName: Schema.optional(Schema.String),
}) {
  get message() {
    const name = this.componentName ? ` in ${this.componentName}` : "";
    return `RenderError${name}: ${formatCause(this.cause)}`;
  }
}

/**
 * Error from a Stream component (before or after first emission).
 *
 * The `phase` field distinguishes:
 * - "before-first-emission": Stream failed before producing any value (shows fallback immediately)
 * - "after-first-emission": Stream failed after showing content (replaces content with fallback)
 */
export class StreamError extends Schema.TaggedError<StreamError>()("StreamError", {
  /** The underlying error that caused the stream failure */
  cause: Schema.Unknown,
  /** When the error occurred relative to first emission */
  phase: Schema.Literal("before-first-emission", "after-first-emission"),
}) {
  get message() {
    return `StreamError (${this.phase}): ${formatCause(this.cause)}`;
  }
}

/**
 * Error from an event handler Effect.
 *
 * The `eventType` field indicates which event triggered the failure (e.g., "click", "change").
 */
export class EventHandlerError extends Schema.TaggedError<EventHandlerError>()(
  "EventHandlerError",
  {
    /** The underlying error that caused the event handler failure */
    cause: Schema.Unknown,
    /** The DOM event type that triggered this handler (e.g., "click", "change") */
    eventType: Schema.String,
  },
) {
  get message() {
    return `EventHandlerError (${this.eventType}): ${formatCause(this.cause)}`;
  }
}

/**
 * Union of all component error types.
 * Used with ErrorBoundary's onError handlers for typed error matching.
 */
export type ComponentError = RenderError | StreamError | EventHandlerError;
