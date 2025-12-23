import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Sink from "effect/Sink";
import * as Scope from "effect/Scope";
import * as Exit from "effect/Exit";
import * as Ref from "effect/Ref";
import * as Option from "effect/Option";
import * as FiberSet from "effect/FiberSet";
import * as Fiber from "effect/Fiber";
import * as Deferred from "effect/Deferred";
import * as Layer from "effect/Layer";
import * as Context from "effect/Context";
import * as FiberRef from "effect/FiberRef";

import {
  Atom,
  Registry as AtomRegistry,
} from "@effect-atom/atom";
import {
  type VElement,
  type ElementType,
  type Primitive,
  isStream,
} from "./shared.js";

// Re-export shared types for backwards compatibility
export type { VElement, ElementType, Primitive };

// =============================================================================
// Error Boundary Channel
// =============================================================================

/**
 * Error boundary channel - a Deferred that async errors can fail to trigger fallback.
 * Created by ErrorBoundary and provided via context to children.
 * Children (event handlers, stream subscriptions) can fail this to report errors.
 */
class ErrorBoundaryChannel extends Context.Tag("ErrorBoundaryChannel")<
  ErrorBoundaryChannel,
  {
    readonly reportError: (error: unknown) => Effect.Effect<void, never, never>;
  }
>() {}

// Alias for convenience (matches common React terminology)
export type VNode = VElement;

// =============================================================================
// Core Data Structures
// =============================================================================

/**
 * Normalize any component return value to a Stream
 */
const normalizeToStream = (
  value: VElement | Effect.Effect<VElement, unknown, never> | Stream.Stream<VElement, unknown, never>
): Stream.Stream<VElement, unknown, never> => {
  if (isStream(value)) return value;
  if (Effect.isEffect(value)) return Stream.fromEffect(value);
  return Stream.succeed(value);
};

/**
 * Create a tracking registry that records which atoms are accessed
 */
const makeTrackingRegistry = (
  realRegistry: AtomRegistry.Registry,
  accessedAtoms: Set<Atom.Atom<unknown>>
): AtomRegistry.Registry => {
  return new Proxy(realRegistry as object, {
    get(target, prop, receiver) {
      if (prop === "get") {
        return (atom: Atom.Atom<unknown>) => {
          accessedAtoms.add(atom);
          return realRegistry.get(atom);
        };
      }
      return Reflect.get(target, prop, receiver);
    }
  }) as AtomRegistry.Registry;
};

// =============================================================================
// Runtime Service
// =============================================================================

export const CustomAtomRegistryLayer = AtomRegistry.layerOptions({
  scheduleTask: (f: () => void) => f()
});

export class DidactRuntime extends Effect.Service<DidactRuntime>()("DidactRuntime", {
  accessors: true,
  dependencies: [CustomAtomRegistryLayer],
  scoped: Effect.gen(function*() {
    const registry = yield* AtomRegistry.AtomRegistry;
    const rootScope = yield* Scope.make();
    const runFork = yield* FiberSet.makeRuntime<AtomRegistry.AtomRegistry>();

    const AtomOps = {
      get: <A>(atom: Atom.Atom<A>): A => registry.get(atom),
      set: <R, W>(atom: Atom.Writable<R, W>, value: W): void => registry.set(atom, value),
      update: <R, W>(atom: Atom.Writable<R, W>, f: (_: R) => W): void => registry.update(atom, f),
      modify: <R, W, A>(atom: Atom.Writable<R, W>, f: (_: R) => [returnValue: A, nextValue: W]): A => registry.modify(atom, f),
    };

    return { registry, rootScope, runFork, AtomOps };
  }),
}) {
  static Live = DidactRuntime.Default;
  
  /**
   * Layer that provides both DidactRuntime AND AtomRegistry.
   * Use this when composing with user layers that need AtomRegistry access.
   * (DidactRuntime.Default consumes AtomRegistry internally but doesn't re-export it)
   */
  static LiveWithRegistry = Layer.merge(DidactRuntime.Default, CustomAtomRegistryLayer);
}

// =============================================================================
// Render Implementation
// =============================================================================

/**
 * Check if a type is a function component
 */
const isFunctionComponent = (type: ElementType): type is (props: Record<string, unknown>) => VElement | Effect.Effect<VElement> | Stream.Stream<VElement> =>
  typeof type === "function";

/**
 * Check if a type is a host element (string tag)
 */
const isHostElement = (type: ElementType): type is Primitive =>
  typeof type === "string";

/**
 * Property update strategies for different DOM properties
 */
const propertyUpdateMap: Record<string, "attribute" | "property" | "classList" | "booleanAttribute"> = {
  class: "classList",
  className: "classList",
  value: "property",
  checked: "property",
};

const isEvent = (key: string) => key.startsWith("on");
const isProperty = (key: string) => key !== "children" && key !== "ref" && key !== "key" && !isEvent(key);

/**
 * Set a DOM property using the appropriate method
 */
const setDomProperty = (el: HTMLElement, name: string, value: unknown): void => {
  const method = propertyUpdateMap[name] ||
    (name.startsWith("data-") || name.startsWith("aria-") ? "attribute" : "attribute");

  switch (method) {
    case "attribute":
      el.setAttribute(name, String(value ?? ""));
      break;
    case "property":
      Reflect.set(el, name, value);
      break;
    case "classList":
      if (Array.isArray(value)) {
        value.forEach((v: string) => el.classList.add(v));
      } else {
        el.setAttribute("class", String(value ?? ""));
      }
      break;
    case "booleanAttribute":
      if (value) {
        el.setAttribute(name, "");
      } else {
        el.removeAttribute(name);
      }
      break;
  }
};

/**
 * Attach event listeners to a DOM element
 * @param context - The current Effect context for service access (ThemeService, ErrorBoundaryChannel, etc.)
 */
const attachEventListeners = (
  el: HTMLElement,
  props: Record<string, unknown>,
  runtime: DidactRuntime,
  context?: Context.Context<unknown>
): void => {
  for (const [key, handler] of Object.entries(props)) {
    if (isEvent(key) && typeof handler === "function") {
      const eventType = key.toLowerCase().substring(2);
      
      el.addEventListener(eventType, (event: Event) => {
        const result = (handler as (e: Event) => unknown)(event);
        
        if (Effect.isEffect(result)) {
          // Build the effect with full context if available, otherwise just basic services
          const effectWithServices = context
            ? (result as Effect.Effect<unknown, unknown, never>).pipe(
                Effect.provide(context),
                // Also add DidactRuntime in case it's needed but not in context
                Effect.provideService(DidactRuntime, runtime)
              )
            : (result as Effect.Effect<unknown, unknown, AtomRegistry.AtomRegistry>).pipe(
                Effect.provideService(AtomRegistry.AtomRegistry, runtime.registry),
                Effect.provideService(DidactRuntime, runtime)
              );
          
          // Try to get error boundary channel from context to report errors
          const errorChannel = context ? Context.getOption(context, ErrorBoundaryChannel) : Option.none();
          
          const errorHandler = Option.isSome(errorChannel)
            ? (cause: unknown) => errorChannel.value.reportError(cause)
            : (cause: unknown) => Effect.logError("Event handler error (no boundary)", cause);
          
          runtime.runFork(
            effectWithServices.pipe(
              Effect.catchAllCause(errorHandler)
            )
          );
        }
      });
    }
  }
};

/**
 * Clear content by closing the current scope in the Ref and creating a fresh one.
 * This triggers finalizers that remove DOM nodes and cancel subscriptions.
 * Returns the new scope for convenience.
 */
const clearContentScope = (
  contentScopeRef: Ref.Ref<Scope.Scope.Closeable>
): Effect.Effect<Scope.Scope.Closeable, never, never> =>
  Effect.gen(function*() {
    const oldScope = yield* Ref.get(contentScopeRef);
    yield* Scope.close(oldScope, Exit.void);
    const newScope = yield* Scope.make();
    yield* Ref.set(contentScopeRef, newScope);
    return newScope;
  });

/**
 * Register a DOM node for cleanup when scope closes.
 * Removes the node from its parent when the scope is closed.
 */
const registerNodeCleanup = (
  node: Node,
  scope: Scope.Scope.Closeable
): Effect.Effect<void, never, never> =>
  Scope.addFinalizer(scope, Effect.sync(() => {
    if (node.parentNode) {
      node.parentNode.removeChild(node);
    }
  }));

/**
 * Subscribe to atom changes for reactivity
 */
const subscribeToAtoms = (
  atoms: Set<Atom.Atom<unknown>>,
  onUpdate: () => void,
  runtime: DidactRuntime,
  scope: Scope.Scope.Closeable
): Effect.Effect<void, never, never> =>
  Effect.forEach(
    atoms,
    (atom) => {
      const atomStream = AtomRegistry.toStream(runtime.registry, atom).pipe(
        Stream.drop(1) // Skip initial value
      );
      const sub = Stream.runForEach(atomStream, () => Effect.sync(onUpdate));
      return Effect.forkIn(sub, scope);
    },
    { discard: true, concurrency: "unbounded" }
  );

/**
 * Recursively render a VElement tree to DOM.
 * This is the core rendering function that handles:
 * - Function components (with stream subscriptions and atom reactivity)
 * - Host elements (DOM nodes)
 * - Text elements
 * - Fragments
 * - Error boundaries
 * 
 * @param vElement - Virtual element to render
 * @param parent - Parent DOM node to append to
 * @param runtime - Didact runtime instance
 * @param parentScope - Optional scope for registering cleanup (used for proper DOM node removal)
 */
const renderVElementToDOM = (
  vElement: VElement,
  parent: Node,
  runtime: DidactRuntime,
  parentScope?: Scope.Scope.Closeable
): Effect.Effect<void, unknown, never> =>
  Effect.gen(function*() {
    const type = vElement.type;
    
    if (isFunctionComponent(type)) {
      // Function component - create wrapper and subscribe to its stream
      const wrapper = document.createElement("span");
      wrapper.style.display = "contents";
      parent.appendChild(wrapper);
      
      // Register wrapper cleanup with parent scope if provided
      if (parentScope) {
        yield* registerNodeCleanup(wrapper, parentScope);
      }
      
      // Component scope - for atom subscriptions and stream subscriptions
      const componentScope = yield* Scope.make();
      // Content scope ref - for rendered children (can be cleared/recreated on re-render)
      const initialContentScope = yield* Scope.make();
      const contentScopeRef = yield* Ref.make(initialContentScope);
      
      const accessedAtoms = new Set<Atom.Atom<unknown>>();
      const trackingRegistry = makeTrackingRegistry(runtime.registry, accessedAtoms);
      
      // Capture current runtime context (includes user services like ThemeService, UserService)
      // FiberRef.currentContext gives us the actual runtime context regardless of static types
      // We add our tracking registry to override AtomRegistry while preserving other services
      const currentContext = yield* FiberRef.get(FiberRef.currentContext) as Effect.Effect<Context.Context<unknown>, never, never>;
      const contextWithTracking = Context.add(currentContext, AtomRegistry.AtomRegistry, trackingRegistry);
      
      // Invoke component - use Effect.try to catch sync render-time crashes
      const output = yield* Effect.try({
        try: () => (type as (props: Record<string, unknown>) => unknown)(vElement.props),
        catch: (e) => e
      }).pipe(
        Effect.tapError(() => Effect.sync(() => parent.removeChild(wrapper)))
      );
      
      // Normalize to stream and provide context (with tracking registry) to it
      // This ensures user-provided services like ThemeService are available to component Effects
      const stream = normalizeToStream(output as VElement | Effect.Effect<VElement> | Stream.Stream<VElement>).pipe(
        Stream.provideContext(contextWithTracking)
      );
      
      // Use Stream.peel to properly separate first emission from remaining stream
      // Provide componentScope so the remaining stream stays valid for the component's lifetime
      const peelResult = yield* Effect.either(
        Effect.gen(function*() {
          const [maybeFirst, remainingStream] = yield* Stream.peel(stream, Sink.head()).pipe(
            Effect.provideService(Scope.Scope, componentScope)
          );
          
          if (Option.isNone(maybeFirst)) {
            // Empty stream - nothing to render
            return { rendered: false as const };
          }
          
          const contentScope = yield* Ref.get(contentScopeRef);
          yield* renderVElementToDOM(maybeFirst.value, wrapper, runtime, contentScope);
          
          // Subscribe to atom changes for reactivity
          if (accessedAtoms.size > 0) {
            yield* subscribeToAtoms(accessedAtoms, () => {
              // Queue re-render on atom change
              runtime.runFork(
                Effect.gen(function*() {
                  // Clear old content via scope (triggers finalizers, removes DOM nodes)
                  const newContentScope = yield* clearContentScope(contentScopeRef);
                  
                  const newAccessedAtoms = new Set<Atom.Atom<unknown>>();
                  const newTrackingRegistry = makeTrackingRegistry(runtime.registry, newAccessedAtoms);
                  // Re-use captured context but with new tracking registry
                  const newContextWithTracking = Context.add(currentContext, AtomRegistry.AtomRegistry, newTrackingRegistry);
                  
                  // Invoke component - use Effect.try to catch sync render-time crashes
                  const newOutput = yield* Effect.try({
                    try: () => (type as (props: Record<string, unknown>) => unknown)(vElement.props),
                    catch: (e) => e
                  });
                  
                  const newStream = normalizeToStream(newOutput as VElement | Effect.Effect<VElement> | Stream.Stream<VElement>).pipe(
                    Stream.provideContext(newContextWithTracking)
                  );
                  yield* Stream.runForEach(newStream, (reEmitted) =>
                    renderVElementToDOM(reEmitted, wrapper, runtime, newContentScope).pipe(
                      Effect.catchAll((e) => Effect.logError("Re-render child error", e))
                    )
                  );
                }).pipe(
                  Effect.catchAllCause((cause) => Effect.logError("Re-render error", cause))
                )
              );
            }, runtime, componentScope);
          }
          
          // Fork subscription for remaining emissions
          // Try to report stream errors to error boundary channel if available
          const maybeErrorChannel = Context.getOption(currentContext, ErrorBoundaryChannel);
          const streamErrorHandler = Option.isSome(maybeErrorChannel)
            ? (cause: unknown) => maybeErrorChannel.value.reportError(cause)
            : (cause: unknown) => Effect.logError("Component stream error (no boundary)", cause);
          
          const subscription = Stream.runForEach(remainingStream, (emitted) =>
            Effect.gen(function*() {
              // Clear old content via scope
              const newContentScope = yield* clearContentScope(contentScopeRef);
              yield* renderVElementToDOM(emitted, wrapper, runtime, newContentScope).pipe(
                Effect.catchAll((e) => Effect.logError("Stream emission render error", e))
              );
            })
          ).pipe(
            Effect.catchAllCause(streamErrorHandler)
          );
          
          yield* Effect.forkIn(subscription, componentScope);
          
          return { rendered: true as const };
        })
      );
      
      if (peelResult._tag === "Left") {
        // Stream error before/during first emission - propagate
        const contentScope = yield* Ref.get(contentScopeRef);
        yield* Scope.close(contentScope, Exit.void);
        yield* Scope.close(componentScope, Exit.void);
        parent.removeChild(wrapper);
        return yield* Effect.fail(peelResult.left);
      }
      
    } else if (type === "TEXT_ELEMENT") {
      // Text node
      const textNode = document.createTextNode(String(vElement.props.nodeValue ?? ""));
      parent.appendChild(textNode);
      
      // Register text node cleanup with parent scope if provided
      if (parentScope) {
        yield* registerNodeCleanup(textNode, parentScope);
      }
      
    } else if (type === "FRAGMENT") {
      // Fragment - render children directly into parent (propagate errors)
      const children = vElement.props.children ?? [];
      for (const child of children) {
        yield* renderVElementToDOM(child, parent, runtime, parentScope);
      }
      
    } else if (type === "ERROR_BOUNDARY") {
      // Error boundary - wrap child rendering in error catching
      // Also catches async errors from event handlers and streams via ErrorBoundaryChannel
      const wrapper = document.createElement("span");
      wrapper.style.display = "contents";
      parent.appendChild(wrapper);
      
      // Register wrapper cleanup with parent scope if provided
      if (parentScope) {
        yield* registerNodeCleanup(wrapper, parentScope);
      }
      
      const fallback = vElement.props.fallback as VElement;
      const onError = vElement.props.onError as ((cause: unknown) => void) | undefined;
      const children = vElement.props.children as VElement[];
      
      // Create content scope for children - wrapped in Ref so async error handler can access it
      const contentScopeRef = yield* Ref.make(yield* Scope.make());
      
      // Create error channel for async error reporting
      const errorDeferred = yield* Deferred.make<never, unknown>();
      const errorChannel: Context.Tag.Service<typeof ErrorBoundaryChannel> = {
        reportError: (error: unknown) => 
          Deferred.fail(errorDeferred, error).pipe(Effect.ignore)
      };
      
      // Flag to track if we've already shown fallback (to prevent double-triggering)
      const hasTriggeredRef = yield* Ref.make(false);
      
      // Helper to render fallback (used by both sync and async error paths)
      const renderFallback = (error: unknown) => Effect.gen(function*() {
        const alreadyTriggered = yield* Ref.getAndSet(hasTriggeredRef, true);
        if (alreadyTriggered) return; // Already showing fallback
        
        // Close content scope (cleans up DOM nodes), create fallback scope
        const oldContentScope = yield* Ref.get(contentScopeRef);
        yield* Scope.close(oldContentScope, Exit.void);
        const fallbackScope = yield* Scope.make();
        yield* Ref.set(contentScopeRef, fallbackScope);
        
        onError?.(error);
        yield* Effect.logError("ErrorBoundary caught error", error);
        yield* renderVElementToDOM(fallback, wrapper, runtime, fallbackScope).pipe(
          Effect.catchAll((e) => Effect.logError("ErrorBoundary fallback render error", e))
        );
      });
      
      // Fork listener for async errors (event handlers, stream failures)
      yield* Effect.fork(
        Deferred.await(errorDeferred).pipe(
          Effect.catchAllCause((cause) => renderFallback(cause))
        )
      );
      
      // Try to render children with error channel in context, catch sync errors
      const contentScope = yield* Ref.get(contentScopeRef);
      const renderResult = yield* Effect.either(
        Effect.forEach(children, (child) => renderVElementToDOM(child, wrapper, runtime, contentScope), { discard: true }).pipe(
          Effect.provideService(ErrorBoundaryChannel, errorChannel)
        )
      );
      
      if (renderResult._tag === "Left") {
        // Sync error during render - render fallback
        yield* renderFallback(renderResult.left);
      }
      
    } else if (type === "SUSPENSE") {
      // Suspense boundary - show fallback while children are loading
      // Uses proper DOM insertion/removal (not CSS visibility hacks)
      // Children are rendered to a detached container; if they complete within threshold, 
      // we append directly. If timeout fires first, we show fallback then swap when ready.
      const fallback = vElement.props.fallback as VElement;
      const threshold = (vElement.props.threshold as number) ?? 100;
      const children = vElement.props.children as VElement[];
      const childFragment = h("FRAGMENT", {}, children);
      
      // Create a DETACHED container for children (not in DOM yet)
      // Using display:contents so it doesn't affect layout when inserted
      const childWrapper = document.createElement("span");
      childWrapper.style.display = "contents";
      
      // Create scopes for each container
      const fallbackScope = yield* Scope.make();
      const childScope = yield* Scope.make();
      
      // Deferred to signal when children have completed first render
      const childrenReady = yield* Deferred.make<void, unknown>();
      
      // Fork: render children into DETACHED container, signal when done
      const childFiber = yield* Effect.fork(
        Effect.gen(function*() {
          yield* renderVElementToDOM(childFragment, childWrapper, runtime, childScope);
          yield* Deferred.succeed(childrenReady, void 0);
        }).pipe(
          Effect.catchAll((e) => Deferred.fail(childrenReady, e))
        )
      );
      
      // Race: wait for children vs timeout
      const childrenWon = yield* Effect.race(
        Deferred.await(childrenReady).pipe(Effect.as(true)),
        Effect.sleep(`${threshold} millis`).pipe(Effect.as(false))
      );
      
      if (childrenWon) {
        // Children completed before timeout - append directly, skip fallback entirely
        parent.appendChild(childWrapper);
        if (parentScope) {
          yield* registerNodeCleanup(childWrapper, parentScope);
        }
        // Clean up unused fallback scope
        yield* Scope.close(fallbackScope, Exit.void);
      } else {
        // Timeout fired first - render fallback to DOM while waiting for children
        const fallbackWrapper = document.createElement("span");
        fallbackWrapper.style.display = "contents";
        parent.appendChild(fallbackWrapper);
        
        if (parentScope) {
          yield* registerNodeCleanup(fallbackWrapper, parentScope);
        }
        
        yield* renderVElementToDOM(fallback, fallbackWrapper, runtime, fallbackScope);
        
        // Wait for children to complete (they're still rendering in background)
        const childResult = yield* Effect.either(Deferred.await(childrenReady));
        
        if (childResult._tag === "Right") {
          // Children completed successfully - swap: remove fallback, insert children
          fallbackWrapper.remove();
          parent.appendChild(childWrapper);
          
          if (parentScope) {
            yield* registerNodeCleanup(childWrapper, parentScope);
          }
          
          // Clean up fallback scope (stops any streams/effects in fallback)
          yield* Scope.close(fallbackScope, Exit.void);
        } else {
          // Children failed - keep showing fallback, propagate error
          // (ErrorBoundary above should catch this)
          yield* Fiber.interrupt(childFiber);
          yield* Scope.close(childScope, Exit.void);
          return yield* Effect.fail(childResult.left);
        }
      }
      
    } else if (isHostElement(type)) {
      // Regular host element (div, span, button, etc.)
      const el = document.createElement(type);
      
      // Apply properties
      for (const [key, value] of Object.entries(vElement.props)) {
        if (isProperty(key)) {
          setDomProperty(el, key, value);
        }
      }
      
      // Capture runtime context for event handlers to access user-provided services
      const currentContext = yield* FiberRef.get(FiberRef.currentContext) as Effect.Effect<Context.Context<any>, never, never>;
      
      // Attach event listeners with context for service access
      attachEventListeners(el, vElement.props as Record<string, unknown>, runtime, currentContext);
      
      // Handle ref
      const ref = vElement.props.ref;
      if (ref && typeof ref === "object" && "current" in ref) {
        (ref as { current: unknown }).current = el;
      }
      
      parent.appendChild(el);
      
      // Register element cleanup with parent scope if provided
      if (parentScope) {
        yield* registerNodeCleanup(el, parentScope);
      }
      
      // Create scope for children of this element
      const childScope = yield* Scope.make();
      
      // Render children (propagate errors)
      const children = vElement.props.children ?? [];
      for (const child of children) {
        yield* renderVElementToDOM(child, el, runtime, childScope);
      }
    }
  });

// =============================================================================
// Public API
// =============================================================================

/**
 * Create a virtual element (JSX factory)
 */
export function h<T>(
  type: Primitive,
  props?: { [key: string]: unknown },
  children?: (VElement | string)[]
): VElement;
export function h<T>(
  type: (props: T) => VElement | Stream.Stream<VElement, unknown, never>,
  props?: { [key: string]: unknown },
  children?: (VElement | string)[]
): VElement;
export function h<T>(
  type: (props: T) => Effect.Effect<VElement, unknown, never>,
  props?: { [key: string]: unknown },
  children?: (VElement | string)[]
): VElement;
export function h<T>(
  type: ElementType<T>,
  props: { [key: string]: unknown } = {},
  children: (VElement | string)[] = [],
): VElement {
  return {
    type: type as ElementType,
    props: {
      ...props,
      children: children.map((child) =>
        typeof child === "object" ? child : createTextElement(child),
      ),
    },
  };
}

const createTextElement = (text: string): VElement => ({
  type: "TEXT_ELEMENT",
  props: {
    nodeValue: text,
    children: [],
  },
});

/**
 * Render a VElement tree to a container.
 * Returns an Effect that runs forever (until interrupted).
 * 
 * @param element - The VElement tree to render
 * @param container - The DOM container to render into
 * @param options - Optional configuration
 * @param options.layer - Additional layer to provide (will have access to AtomRegistry)
 */
export function render(element: VElement, container: HTMLElement): Effect.Effect<never, never, never>;
export function render(element: VElement, container: HTMLElement, options: { layer: Layer.Layer<any, any, AtomRegistry.AtomRegistry> }): Effect.Effect<never, never, never>;
export function render(element: VElement): (container: HTMLElement) => Effect.Effect<never, never, never>;
export function render(
  element: VElement,
  container?: HTMLElement,
  options?: { layer?: Layer.Layer<any, any, AtomRegistry.AtomRegistry> },
) {
  const program = (cont: HTMLElement) =>
    Effect.gen(function*() {
      const runtime = yield* DidactRuntime;
      
      // Container must be empty - we don't support hydration yet
      if (cont.childNodes.length > 0) {
        yield* Effect.logWarning("render() called on non-empty container - clearing existing content");
        while (cont.firstChild) {
          cont.removeChild(cont.firstChild);
        }
      }
      
      // Render the VElement tree directly to DOM
      yield* renderVElementToDOM(element, cont, runtime);
      
      // Keep the effect running forever (until interrupted)
      return yield* Effect.never;
    }).pipe(
      // If user provided a layer, merge it with LiveWithRegistry so it has access to AtomRegistry
      // LiveWithRegistry outputs both DidactRuntime AND AtomRegistry (unlike Live which consumes but doesn't re-export)
      Effect.provide(
        options?.layer
          ? Layer.provideMerge(options.layer, DidactRuntime.LiveWithRegistry)
          : DidactRuntime.Live
      )
    );

  if (container === undefined) {
    return (cont: HTMLElement) => program(cont);
  }
  return program(container);
}

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
