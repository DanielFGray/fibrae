import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Sink from "effect/Sink";
import * as Scope from "effect/Scope";
import * as Exit from "effect/Exit";
import * as Ref from "effect/Ref";
import * as Option from "effect/Option";
import * as Fiber from "effect/Fiber";
import * as Deferred from "effect/Deferred";
import * as Context from "effect/Context";
import * as FiberRef from "effect/FiberRef";

import { Atom, Registry as AtomRegistry } from "@effect-atom/atom";
import { type VElement, type ElementType, type Primitive } from "./shared.js";
import { LumonRuntime, runForkWithRuntime } from "./runtime.js";
import { setDomProperty, attachEventListeners, isProperty } from "./dom.js";
import { normalizeToStream, makeTrackingRegistry, subscribeToAtoms } from "./tracking.js";
import { clearContentScope, registerNodeCleanup } from "./scope-utils.js";
import { ErrorBoundaryChannel } from "./components.js";
import { h } from "./h.js";

// =============================================================================
// Type Guards
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

// =============================================================================
// Render Implementation
// =============================================================================

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
 * @param runtime - Lumon runtime instance
 * @param parentScope - Optional scope for registering cleanup (used for proper DOM node removal)
 */
export const renderVElementToDOM = (
  vElement: VElement,
  parent: Node,
  runtime: LumonRuntime,
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
              runForkWithRuntime(runtime)(
                Effect.gen(function*() {
                  // Capture focus state before re-render
                  const activeElement = document.activeElement as HTMLElement | null;
                  const hasFocusInWrapper = activeElement && wrapper.contains(activeElement);
                  const focusData = hasFocusInWrapper && activeElement ? {
                    tagName: activeElement.tagName,
                    dataAttributes: Object.fromEntries(
                      Array.from(activeElement.attributes)
                        .filter(attr => attr.name.startsWith("data-"))
                        .map(attr => [attr.name, attr.value])
                    ),
                    name: activeElement.getAttribute("name"),
                    id: activeElement.id,
                    selectionStart: "selectionStart" in activeElement ? (activeElement as HTMLInputElement).selectionStart : null,
                    selectionEnd: "selectionEnd" in activeElement ? (activeElement as HTMLInputElement).selectionEnd : null,
                  } : null;

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

                  // Restore focus after re-render
                  if (focusData) {
                    const candidates = wrapper.querySelectorAll(focusData.tagName);
                    for (const candidate of candidates) {
                      const el = candidate as HTMLElement;
                      // Match by id first, then name, then data attributes
                      const matchById = focusData.id && el.id === focusData.id;
                      const matchByName = focusData.name && el.getAttribute("name") === focusData.name;
                      const matchByData = Object.entries(focusData.dataAttributes).length > 0 &&
                        Object.entries(focusData.dataAttributes).every(
                          ([attr, value]) => el.getAttribute(attr) === value
                        );

                      if (matchById || matchByName || matchByData) {
                        el.focus();
                        // Restore cursor position for inputs/textareas
                        if (focusData.selectionStart !== null && "setSelectionRange" in el) {
                          (el as HTMLInputElement).setSelectionRange(
                            focusData.selectionStart,
                            focusData.selectionEnd ?? focusData.selectionStart
                          );
                        }
                        break;
                      }
                    }
                  }
                }).pipe(
                  // Provide captured context to re-render fiber so services (Navigator, etc.) are available
                  Effect.provide(currentContext),
                  Effect.catchAllCause((cause) => Effect.logError("Re-render error", cause))
                )
              );
            }, runtime, componentScope);
          }

          // Fork subscription for remaining emissions
          // Try to report stream errors to error boundary channel if available
          const maybeErrorChannel = Context.getOption(currentContext, ErrorBoundaryChannel);
          const streamErrorHandler = Option.match(maybeErrorChannel, {
            onNone: () => (cause: unknown) => Effect.logError("Component stream error (no boundary)", cause),
            onSome: (channel) => (cause: unknown) => channel.reportError(cause)
          });

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

      // Attach event listeners - uses runForkWithRuntime internally for full context
      attachEventListeners(el, vElement.props as Record<string, unknown>, runtime);

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
