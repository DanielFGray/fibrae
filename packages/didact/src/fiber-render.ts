/**
 * Fiber-based rendering implementation.
 *
 * This module implements a proper fiber reconciliation system that:
 * - Uses a fiber tree for incremental rendering
 * - Supports key-based diffing for efficient list updates
 * - Two-phase rendering: render phase builds fiber tree, commit phase touches DOM
 * - Function components have `dom: Option.none()` - no wrapper spans!
 *
 * This fixes SSR hydration by producing identical DOM structure on server and client.
 */

import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Scope from "effect/Scope";
import * as Ref from "effect/Ref";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Deferred from "effect/Deferred";
import * as Context from "effect/Context";
import * as FiberRef from "effect/FiberRef";

import { Atom, Registry as AtomRegistry } from "@effect-atom/atom";
import {
  type VElement,
  type ElementType,
  type Fiber,
  type FiberRef as FiberRefType,
  type ErrorBoundaryConfig,
  isEvent,
  isProperty,
  isStream,
} from "./shared.js";
import { DidactRuntime, type FiberState, runForkWithRuntime } from "./runtime.js";
import { setDomProperty, attachEventListeners } from "./dom.js";
import { normalizeToStream, makeTrackingRegistry } from "./tracking.js";
import { h } from "./h.js";

// =============================================================================
// Fiber Creation Helpers
// =============================================================================

const createFiber = (
  type: Option.Option<ElementType>,
  props: { [key: string]: unknown; children?: VElement[] },
  parent: Option.Option<Fiber>,
  alternate: Option.Option<Fiber>,
  effectTag: Option.Option<"UPDATE" | "PLACEMENT" | "DELETION">
): Fiber => ({
  type,
  props,
  dom: Option.none(),
  parent,
  child: Option.none(),
  sibling: Option.none(),
  alternate,
  effectTag,
  componentScope: Option.none(),
  accessedAtoms: Option.none(),
  latestStreamValue: Option.none(),
  childFirstCommitDeferred: Option.none(),
  fiberRef: Option.none(),
  isMultiEmissionStream: false,
  errorBoundary: Option.none(),
  suspense: Option.none(),
  renderContext: Option.none(),
  isParked: false,
  isUnparking: false,
});

// =============================================================================
// Queue Fiber for Re-render (batched updates)
// =============================================================================

const queueFiberForRerender = (fiber: Fiber) =>
  Effect.gen(function* () {
    const runtime = yield* DidactRuntime;
    const stateRef = runtime.fiberState;

    const didSchedule = yield* Ref.modify(stateRef, (s: FiberState) => {
      const alreadyQueued = s.renderQueue.has(fiber);
      const newQueue = alreadyQueued ? s.renderQueue : new Set([...s.renderQueue, fiber]);
      const shouldScheduleNow = !s.batchScheduled;
      const next: FiberState = {
        ...s,
        renderQueue: newQueue,
        batchScheduled: s.batchScheduled || shouldScheduleNow,
      };
      return [shouldScheduleNow, next] as const;
    });

    if (didSchedule) {
      queueMicrotask(() => {
        runForkWithRuntime(runtime)(processBatch());
      });
    }
  });

// =============================================================================
// Process Batch (handles queued re-renders)
// =============================================================================

const processBatch = () =>
  Effect.gen(function* () {
    const runtime = yield* DidactRuntime;
    const stateRef = runtime.fiberState;
    const stateSnapshot = yield* Ref.get(stateRef);

    const batch = Array.from(stateSnapshot.renderQueue);
    yield* Ref.update(stateRef, (s) => ({
      ...s,
      renderQueue: new Set<Fiber>(),
      batchScheduled: false,
    }));

    if (batch.length === 0) return;

    yield* Option.match(stateSnapshot.currentRoot, {
      onNone: () => Effect.void,
      onSome: (currentRoot) =>
        Effect.gen(function* () {
          yield* Ref.update(stateRef, (s) => ({
            ...s,
            wipRoot: Option.some(
              createFiber(
                currentRoot.type,
                currentRoot.props,
                Option.none(),
                Option.some(currentRoot),
                Option.none()
              )
            ),
            deletions: [],
          }));

          // Copy dom from currentRoot to wipRoot
          const newState = yield* Ref.get(stateRef);
          Option.match(newState.wipRoot, {
            onNone: () => {},
            onSome: (wip) => {
              wip.dom = currentRoot.dom;
            },
          });

          yield* Ref.update(stateRef, (s) => ({
            ...s,
            nextUnitOfWork: s.wipRoot,
          }));

          yield* workLoop(runtime);
        }),
    });
  });

// =============================================================================
// Error Boundary Support
// =============================================================================

const findNearestErrorBoundary = (fiber: Fiber): Option.Option<Fiber> => {
  let current: Option.Option<Fiber> = Option.some(fiber);
  while (Option.isSome(current)) {
    const f = current.value;
    if (Option.isSome(f.errorBoundary)) return Option.some(f);
    current = f.parent;
  }
  return Option.none();
};

const handleFiberError = (fiber: Fiber, cause: unknown): Effect.Effect<Option.Option<Fiber>, never, DidactRuntime> =>
  Effect.gen(function* () {
    const runtime = yield* DidactRuntime;
    const stateRef = runtime.fiberState;
    const state = yield* Ref.get(stateRef);
    
    const boundaryOpt = findNearestErrorBoundary(fiber);
    if (Option.isSome(boundaryOpt)) {
      const boundary = boundaryOpt.value;
      const cfg = Option.getOrElse(boundary.errorBoundary, (): ErrorBoundaryConfig => ({
        fallback: h("div", {}, []),
        hasError: false,
        onError: undefined,
      }));
      cfg.onError?.(cause);
      cfg.hasError = true;
      boundary.errorBoundary = Option.some(cfg as ErrorBoundaryConfig);
      
      // Check if we're in initial render (no currentRoot yet)
      if (Option.isNone(state.currentRoot)) {
        // During initial render: re-reconcile boundary with fallback immediately
        // This replaces the errored child with the fallback element
        yield* reconcileChildren(boundary, [cfg.fallback]);
        // Return the boundary's new child (fallback) so work continues
        return boundary.child;
      } else {
        // After initial render: queue for re-render
        yield* queueFiberForRerender(boundary);
        return Option.none<Fiber>();
      }
    } else {
      yield* Effect.logError("Unhandled error without ErrorBoundary", cause);
      return Option.none<Fiber>();
    }
  });

// =============================================================================
// Suspense Support
// =============================================================================

/**
 * Find the nearest Suspense boundary by walking up the fiber tree.
 */
const findNearestSuspenseBoundary = (fiber: Fiber): Option.Option<Fiber> => {
  let current: Option.Option<Fiber> = fiber.parent;
  while (Option.isSome(current)) {
    const f = current.value;
    if (Option.isSome(f.suspense)) return Option.some(f);
    current = f.parent;
  }
  return Option.none();
};

/**
 * Get the threshold from the nearest Suspense boundary.
 * Returns 0 if no boundary (wait indefinitely).
 */
const getSuspenseThreshold = (fiber: Fiber): number => {
  const boundary = findNearestSuspenseBoundary(fiber);
  return Option.match(boundary, {
    onNone: () => 0,
    onSome: (b) => Option.match(b.suspense, {
      onNone: () => 0,
      onSome: (cfg) => cfg.threshold,
    }),
  });
};

/**
 * Called when a stream component's threshold expires before first emission.
 * Parks the fiber and switches the boundary to show fallback.
 */
const handleFiberSuspension = (fiber: Fiber): Effect.Effect<void, never, DidactRuntime> =>
  Effect.gen(function* () {
    yield* Effect.log("[Suspense] handleFiberSuspension called");
    const boundaryOpt = findNearestSuspenseBoundary(fiber);
    if (Option.isNone(boundaryOpt)) {
      yield* Effect.log("[Suspense] No boundary found");
      // No Suspense boundary - just continue waiting
      return;
    }
    
    yield* Effect.log("[Suspense] Found boundary, setting showingFallback=true");
    const boundary = boundaryOpt.value;
    const config = Option.getOrThrow(boundary.suspense);
    
    if (config.showingFallback) {
      // Already suspended - first suspension wins
      return;
    }
    
    // Create deferred for parked fiber completion
    const parkedComplete = yield* Deferred.make<void>();
    
    // Mark fiber as parked - its scope should not be closed on deletion
    fiber.isParked = true;
    
    // Park the fiber and switch to fallback
    config.showingFallback = true;
    config.parkedFiber = Option.some(fiber);
    config.parkedComplete = Option.some(parkedComplete);
    
    // Trigger re-render of boundary with fallback
    yield* Effect.log("[Suspense] Queuing boundary for re-render");
    yield* queueFiberForRerender(boundary);
  });

/**
 * Called when a parked fiber finally gets its first emission.
 * Signals the boundary to swap back to showing children.
 */
const signalFiberReady = (fiber: Fiber): Effect.Effect<void, never, DidactRuntime> =>
  Effect.gen(function* () {
    yield* Effect.log("[Suspense] signalFiberReady called");
    const boundaryOpt = findNearestSuspenseBoundary(fiber);
    if (Option.isNone(boundaryOpt)) return;
    
    const boundary = boundaryOpt.value;
    const config = Option.getOrThrow(boundary.suspense);
    
    // Unpark the fiber - it's ready now, scope can be closed normally on next deletion
    fiber.isParked = false;
    
    // Signal that parked fiber is ready
    yield* Option.match(config.parkedComplete, {
      onNone: () => Effect.void,
      onSome: (deferred) => Deferred.succeed(deferred, undefined),
    });
    
    yield* Effect.log("[Suspense] Queuing boundary for re-render (ready)");
    // Trigger re-render to swap fallback → children
    yield* queueFiberForRerender(boundary);
  });

// =============================================================================
// Update Function Component
// =============================================================================

const updateFunctionComponent = (fiber: Fiber, runtime: DidactRuntime): Effect.Effect<void, never, DidactRuntime> =>
  Effect.gen(function* () {
    // Initialize deferred for child first commit signaling
    if (Option.isNone(fiber.childFirstCommitDeferred)) {
      fiber.childFirstCommitDeferred = Option.some(
        yield* Deferred.make<void>()
      );
    }

    // Capture current context during render phase for event handlers in commit phase
    // This includes services like Navigator, RouterHandlers, etc.
    const currentContext = (yield* FiberRef.get(FiberRef.currentContext)) as Context.Context<any>;
    fiber.renderContext = Option.some(currentContext);

    // Check if we can reuse cached stream value from alternate
    const hasAlternate = Option.isSome(fiber.alternate);
    const hasCachedValue = Option.match(fiber.alternate, {
      onNone: () => false,
      onSome: (alt) => Option.isSome(alt.latestStreamValue) && alt.isMultiEmissionStream,
    });

    if (hasAlternate && hasCachedValue) {
      // Reuse cached value from alternate (stream component that emitted multiple values)
      const alt = Option.getOrThrow(fiber.alternate);
      const vElement = Option.getOrThrow(alt.latestStreamValue);

      fiber.latestStreamValue = alt.latestStreamValue;
      fiber.accessedAtoms = alt.accessedAtoms;
      fiber.componentScope = alt.componentScope;
      alt.componentScope = Option.none(); // Transfer ownership
      fiber.fiberRef = alt.fiberRef;
      Option.match(fiber.fiberRef, {
        onNone: () => {},
        onSome: (ref) => {
          ref.current = fiber;
        },
      });
      fiber.isMultiEmissionStream = alt.isMultiEmissionStream;

      yield* reconcileChildren(fiber, [vElement]);
      return;
    }

    // Check if this fiber is being restored from parked (suspended) state
    // If so, skip re-execution and use the cached latestStreamValue
    if (fiber.isUnparking && Option.isSome(fiber.latestStreamValue)) {
      yield* Effect.log("[Suspense] Fiber unparking - using cached value, skipping re-execution");
      fiber.isUnparking = false; // Clear flag
      const vElement = Option.getOrThrow(fiber.latestStreamValue);
      yield* reconcileChildren(fiber, [vElement]);
      return;
    }

    // Set up atom tracking
    fiber.props._atomCallIndex = 0;

    const accessedAtoms = new Set<Atom.Atom<any>>();
    const trackingRegistry = makeTrackingRegistry(runtime.registry, accessedAtoms);

    const contextWithTracking = Context.add(currentContext, AtomRegistry.AtomRegistry, trackingRegistry);

    // Invoke the component
    const output = yield* Option.match(fiber.type, {
      onNone: () => Effect.die("updateFunctionComponent called with no type"),
      onSome: (type) => {
        if (typeof type !== "function") {
          return Effect.die("updateFunctionComponent called with non-function type");
        }
        const component = type as (props: any) => VElement | Effect.Effect<VElement> | Stream.Stream<VElement>;
        return Effect.sync(() => component(fiber.props));
      },
    });

    // Fast path: if component returns a plain VElement (not Effect/Stream), 
    // and it's a special element type, just reconcile directly without stream machinery.
    // This handles wrapper components like Suspense and ErrorBoundary efficiently.
    if (!Effect.isEffect(output) && !isStream(output)) {
      const vElement = output as VElement;
      if (typeof vElement === "object" && vElement !== null && "type" in vElement) {
        const elementType = vElement.type;
        if (elementType === "SUSPENSE" || elementType === "ERROR_BOUNDARY" || elementType === "FRAGMENT") {
          // Simple wrapper component - just reconcile with the VElement directly
          yield* reconcileChildren(fiber, [vElement]);
          return;
        }
      }
    }

    // Check if it's a multi-emission stream
    fiber.isMultiEmissionStream = isStream(output);

    // Normalize to stream and provide context
    const stream = normalizeToStream(output as VElement | Effect.Effect<VElement> | Stream.Stream<VElement>).pipe(
      Stream.provideContext(contextWithTracking)
    );

    // Create scope for this component
    yield* resubscribeFiber(fiber);
    fiber.accessedAtoms = Option.some(accessedAtoms);

    const scope = yield* Option.match(fiber.componentScope, {
      onNone: () => Effect.die("Expected componentScope to be created by resubscribeFiber"),
      onSome: (s) => Effect.succeed(s),
    });

    // Set up fiber ref for stream subscriptions
    const fiberRef: FiberRefType = Option.match(fiber.fiberRef, {
      onNone: () => ({ current: fiber }),
      onSome: (ref) => ref,
    });
    fiber.fiberRef = Option.some(fiberRef);

    // First value deferred - errors become defects via Deferred.die
    const firstValueDeferred = yield* Deferred.make<VElement, never>();

    // Fork stream subscription
    const subscription = Stream.runForEach(stream, (vElement) =>
      Effect.gen(function* () {
        yield* Effect.log("[Stream] Stream emitted value");
        const done = yield* Deferred.isDone(firstValueDeferred);
        const currentFiber = fiberRef.current;
        if (!done) {
          yield* Effect.log("[Stream] Setting first value deferred");
          yield* Deferred.succeed(firstValueDeferred, vElement);
        } else {
          // Subsequent emissions - queue re-render
          yield* Effect.log("[Stream] Subsequent emission, queuing re-render");
          currentFiber.latestStreamValue = Option.some(vElement);
          yield* queueFiberForRerender(currentFiber);
        }
      })
    ).pipe(
      Effect.catchAllCause((cause) =>
        Effect.gen(function* () {
          const done = yield* Deferred.isDone(firstValueDeferred);
          if (!done) {
            yield* Deferred.die(firstValueDeferred, cause);
          }
          const currentFiber = fiberRef.current;
          yield* handleFiberError(currentFiber, cause);
        })
      )
    );

    yield* Effect.forkIn(subscription, scope);

    // Get threshold from nearest Suspense boundary
    const threshold = getSuspenseThreshold(fiber);
    
    if (threshold > 0) {
      // Race first value vs threshold
      const result = yield* Effect.race(
        Deferred.await(firstValueDeferred).pipe(
          Effect.map((v) => ({ _tag: "value" as const, value: v }))
        ),
        Effect.sleep(`${threshold} millis`).pipe(
          Effect.map(() => ({ _tag: "timeout" as const }))
        )
      );
      
      if (result._tag === "timeout") {
        // Threshold expired - signal suspension to boundary
        yield* handleFiberSuspension(fiber);
        
        // Fork background work: wait for value, then signal ready
        // This allows the render loop to continue and show fallback
        yield* Effect.log("[Suspense] Forking background wait for first value");
        yield* Effect.forkIn(
          Effect.gen(function* () {
            yield* Effect.log("[Suspense] Background: waiting for first value");
            const value = yield* Deferred.await(firstValueDeferred);
            yield* Effect.log("[Suspense] Background: got first value, signaling ready");
            const currentFiber = fiberRef.current;
            currentFiber.latestStreamValue = Option.some(value);
            yield* signalFiberReady(currentFiber);
          }),
          scope
        );
        
        // Return early - don't reconcile children yet
        // The Suspense boundary will show fallback via queued re-render
        return;
      } else {
        // Value arrived before threshold - no suspension
        fiber.latestStreamValue = Option.some(result.value);
        yield* reconcileChildren(fiber, [result.value]);
      }
    } else {
      // No threshold (0) - wait indefinitely, no suspension possible
      const firstVElement = yield* Deferred.await(firstValueDeferred);
      fiber.latestStreamValue = Option.some(firstVElement);
      yield* reconcileChildren(fiber, [firstVElement]);
    }

    // Subscribe to atom changes
    yield* subscribeFiberAtoms(fiber, accessedAtoms, runtime);
  });

// =============================================================================
// Perform Unit of Work
// =============================================================================

const performUnitOfWork = (
  fiber: Fiber,
  runtime: DidactRuntime
): Effect.Effect<Option.Option<Fiber>, never, DidactRuntime> =>
  Effect.gen(function* () {
    const isFunctionComponent = Option.match(fiber.type, {
      onNone: () => false,
      onSome: (type) => typeof type === "function",
    });

    const eff = isFunctionComponent
      ? updateFunctionComponent(fiber, runtime)
      : updateHostComponent(fiber, runtime);

    const exited = yield* Effect.exit(eff);
    if (Exit.isFailure(exited)) {
      // handleFiberError returns the next fiber to process (if recovery happened)
      return yield* handleFiberError(fiber, exited.cause);
    }

    // Return next unit of work: child, then sibling, then uncle
    if (Option.isSome(fiber.child)) {
      return fiber.child;
    }

    let currentFiber: Option.Option<Fiber> = Option.some(fiber);
    while (Option.isSome(currentFiber)) {
      if (Option.isSome(currentFiber.value.sibling)) {
        return currentFiber.value.sibling;
      }
      currentFiber = currentFiber.value.parent;
    }

    return Option.none<Fiber>();
  });

// =============================================================================
// Atom Subscription
// =============================================================================

const resubscribeFiber = (fiber: Fiber) =>
  Effect.gen(function* () {
    // Close old scope if exists
    yield* Option.match(fiber.componentScope, {
      onNone: () => Effect.void,
      onSome: (scope) => Scope.close(scope as Scope.Scope.Closeable, Exit.void),
    });

    // Create new scope
    const newScope = yield* Scope.make();
    fiber.componentScope = Option.some(newScope);
  });

const subscribeFiberAtoms = (fiber: Fiber, accessedAtoms: Set<Atom.Atom<any>>, runtime: DidactRuntime) =>
  Effect.gen(function* () {
    const scope = yield* Option.match(fiber.componentScope, {
      onNone: () => Effect.die("subscribeFiberAtoms requires an existing componentScope"),
      onSome: (s) => Effect.succeed(s),
    });

    yield* Effect.forEach(
      accessedAtoms,
      (atom) => {
        // Drop first emission (current value), subscribe to changes
        const atomStream = AtomRegistry.toStream(runtime.registry, atom).pipe(Stream.drop(1));
        const subscription = Stream.runForEach(atomStream, () => queueFiberForRerender(fiber));
        return Effect.forkIn(subscription, scope);
      },
      { discard: true, concurrency: "unbounded" }
    );
  });

// =============================================================================
// Update Host Component
// =============================================================================

const updateHostComponent = (fiber: Fiber, runtime: DidactRuntime): Effect.Effect<void, never, DidactRuntime> =>
  Effect.gen(function* () {
    // Inherit renderContext from parent fiber (function components capture it during render)
    // This propagates Navigator, RouterHandlers, etc. down to host elements for event handlers
    if (Option.isNone(fiber.renderContext) && Option.isSome(fiber.parent)) {
      fiber.renderContext = fiber.parent.value.renderContext;
    }

    // Handle ERROR_BOUNDARY specially
    const isErrorBoundary = Option.match(fiber.type, {
      onNone: () => false,
      onSome: (type) => type === "ERROR_BOUNDARY",
    });

    if (isErrorBoundary) {
      // Initialize errorBoundary config if not already set
      if (Option.isNone(fiber.errorBoundary)) {
        const fallback = fiber.props.fallback as VElement;
        const onError = fiber.props.onError as ((cause: unknown) => void) | undefined;
        fiber.errorBoundary = Option.some({
          fallback,
          onError,
          hasError: false,
        });
      }

      const config = Option.getOrThrow(fiber.errorBoundary);
      
      if (config.hasError) {
        // Error state - render fallback instead of children
        yield* reconcileChildren(fiber, [config.fallback]);
      } else {
        // Normal state - render children
        const children = fiber.props.children;
        yield* reconcileChildren(fiber, children || []);
      }
      return;
    }

    // Handle SUSPENSE specially
    const isSuspense = Option.match(fiber.type, {
      onNone: () => false,
      onSome: (type) => type === "SUSPENSE",
    });

    if (isSuspense) {
      const fallback = fiber.props.fallback as VElement;
      const threshold = (fiber.props.threshold as number) ?? 100;
      const children = fiber.props.children as VElement[] | undefined;

      // Initialize suspense config if not already set
      if (Option.isNone(fiber.suspense)) {
        yield* Effect.log("[Suspense] SUSPENSE initializing config");
        fiber.suspense = Option.some({
          fallback,
          threshold,
          showingFallback: false,
          parkedFiber: Option.none(),
          parkedComplete: Option.none(),
        });
      }

      const config = Option.getOrThrow(fiber.suspense);

      // Check if parked fiber has completed (signaled via signalFiberReady)
      const parkedDone = yield* Option.match(config.parkedComplete, {
        onNone: () => Effect.succeed(false),
        onSome: (d) => Deferred.isDone(d),
      });
      
      yield* Effect.log(`[Suspense] SUSPENSE update: parkedDone=${parkedDone}, showingFallback=${config.showingFallback}`);
      
      if (parkedDone && config.showingFallback) {
        // Parked fiber is ready - switch back to showing its content
        yield* Effect.log("[Suspense] SUSPENSE switching from fallback to parked fiber content");
        config.showingFallback = false;
        
        // Mark the fallback child from alternate (previous render) for deletion
        // The fallback fiber is in the alternate's child, not the current fiber's child
        yield* Option.match(fiber.alternate, {
          onNone: () => Effect.void,
          onSome: (alt) =>
            Option.match(alt.child, {
              onNone: () => Effect.void,
              onSome: (fallbackChild) =>
                Effect.gen(function* () {
                  yield* Effect.log("[Suspense] Marking fallback child for deletion");
                  fallbackChild.effectTag = Option.some("DELETION" as const);
                  yield* Ref.update(runtime.fiberState, (s: FiberState) => ({
                    ...s,
                    deletions: [...s.deletions, fallbackChild],
                  }));
                }),
            }),
        });
        
        // Reuse the parked fiber directly - it already has latestStreamValue
        const parkedFiber = Option.getOrThrow(config.parkedFiber);
        
        // Re-parent the parked fiber under this suspense boundary
        parkedFiber.parent = Option.some(fiber);
        parkedFiber.sibling = Option.none();
        parkedFiber.effectTag = Option.some("PLACEMENT" as const);
        
        // Mark as unparking - this tells updateFunctionComponent to skip re-execution
        parkedFiber.isUnparking = true;
        
        // Set as child of this boundary
        fiber.child = Option.some(parkedFiber);
        
        // Clear parked state
        config.parkedFiber = Option.none();
        config.parkedComplete = Option.none();
        
        // Don't reconcile here - let performUnitOfWork handle it
        // The work loop will process parkedFiber next, and updateFunctionComponent
        // will see isUnparking=true and use the cached latestStreamValue
        return;
      }

      if (config.showingFallback) {
        // Show fallback while children are suspended
        yield* Effect.log("[Suspense] SUSPENSE reconciling with fallback");
        yield* reconcileChildren(fiber, [fallback]);
      } else {
        // Show children normally (they'll race against threshold in updateFunctionComponent)
        yield* Effect.log("[Suspense] SUSPENSE reconciling with children");
        yield* reconcileChildren(fiber, children || []);
      }
      return;
    }

    // Virtual element types don't create DOM - just reconcile children
    const isVirtualElement = Option.match(fiber.type, {
      onNone: () => true, // Root fiber has no type
      onSome: (type) => type === "FRAGMENT",
    });

    if (!isVirtualElement && Option.isNone(fiber.dom)) {
      fiber.dom = Option.some(yield* createDom(fiber, runtime));
    }

    const children = fiber.props.children;
    yield* reconcileChildren(fiber, children || []);
  });

const createDom = (fiber: Fiber, runtime: DidactRuntime) =>
  Effect.gen(function* () {
    const dom = yield* Option.match(fiber.type, {
      onNone: () => Effect.die("createDom called with no type"),
      onSome: (type) => {
        if (typeof type !== "string") {
          return Effect.die("createDom called on function component");
        }
        const node: Node =
          type === "TEXT_ELEMENT"
            ? document.createTextNode("")
            : document.createElement(type);
        return Effect.succeed(node);
      },
    });

    yield* updateDom(dom, {}, fiber.props, fiber, runtime);

    // Handle ref
    Option.match(Option.fromNullable(fiber.props.ref), {
      onNone: () => {},
      onSome: (ref) => {
        if (typeof ref === "object" && "current" in ref) {
          (ref as { current: unknown }).current = dom;
        }
      },
    });

    return dom;
  });

// =============================================================================
// Update DOM
// =============================================================================

const isNew = (prev: { [key: string]: unknown }, next: { [key: string]: unknown }) => (key: string) =>
  prev[key] !== next[key];

const updateDom = (
  dom: Node,
  prevProps: { [key: string]: unknown },
  nextProps: { [key: string]: unknown },
  ownerFiber: Fiber,
  runtime: DidactRuntime
) =>
  Effect.gen(function* () {
    const stateRef = runtime.fiberState;
    const element = dom as HTMLElement | Text;

    if (element instanceof Text) {
      if (nextProps.nodeValue !== prevProps.nodeValue) {
        element.nodeValue = String(nextProps.nodeValue ?? "");
      }
      return;
    }

    const stateSnapshot = yield* Ref.get(stateRef);
    const el = element as HTMLElement;
    const stored = stateSnapshot.listenerStore.get(el) ?? {};

    // Remove old event listeners
    const eventsToRemove = Object.keys(prevProps)
      .filter(isEvent)
      .filter((key) => !(key in nextProps) || isNew(prevProps, nextProps)(key));

    for (const name of eventsToRemove) {
      const eventType = name.toLowerCase().substring(2);
      const wrapper = stored[eventType];
      if (wrapper) {
        el.removeEventListener(eventType, wrapper);
        delete stored[eventType];
      }
    }

    // Update changed properties
    Object.keys(nextProps)
      .filter(isProperty)
      .filter(isNew(prevProps, nextProps))
      .forEach((name) => {
        if (el instanceof HTMLElement) {
          setDomProperty(el, name, nextProps[name]);
        }
      });

     // Add new event listeners
    Object.keys(nextProps)
      .filter(isEvent)
      .filter(isNew(prevProps, nextProps))
      .forEach((name) => {
        const eventType = name.toLowerCase().substring(2);
        const handler = nextProps[name] as (event: Event) => unknown;

        const wrapper: EventListener = (event: Event) => {
          const result = handler(event);
          if (Effect.isEffect(result)) {
            // Use runForkWithRuntime to get the full application context
            // This provides Navigator, DidactRuntime, AtomRegistry, etc.
            const effectWithErrorHandling = (result as Effect.Effect<unknown, unknown, unknown>).pipe(
              Effect.catchAllCause((cause) =>
                ownerFiber ? handleFiberError(ownerFiber, cause) : Effect.void
              )
            );
            runForkWithRuntime(runtime)(effectWithErrorHandling);
          }
        };

        const existing = stored[eventType];
        if (existing) {
          el.removeEventListener(eventType, existing);
        }
        el.addEventListener(eventType, wrapper);
        stored[eventType] = wrapper;
      });


    stateSnapshot.listenerStore.set(el, stored);
  });

// =============================================================================
// Reconcile Children (key-based diffing)
// =============================================================================

const reconcileChildren = (wipFiber: Fiber, elements: VElement[]) =>
  Effect.gen(function* () {
    const runtime = yield* DidactRuntime;
    const stateRef = runtime.fiberState;

    // Collect old children from alternate
    const oldChildren: Fiber[] = [];
    if (Option.isSome(wipFiber.alternate)) {
      let current = wipFiber.alternate.value.child;
      while (Option.isSome(current)) {
        oldChildren.push(current.value);
        current = current.value.sibling;
      }
    }

    const getKey = (props: { [key: string]: unknown } | undefined): Option.Option<unknown> =>
      Option.fromNullable(props ? (props as Record<string, unknown>).key : undefined);

    // Build maps for keyed and unkeyed old fibers
    const oldByKey = new Map<unknown, Fiber>();
    const oldUnkeyed: Fiber[] = [];

    for (const f of oldChildren) {
      const keyOpt = getKey(f.props);
      Option.match(keyOpt, {
        onNone: () => oldUnkeyed.push(f),
        onSome: (key) => oldByKey.set(key, f),
      });
    }

    const newFibers: Fiber[] = [];

    for (const element of elements) {
      let matchedOldOpt: Option.Option<Fiber> = Option.none();
      const keyOpt = getKey(element.props as { [key: string]: unknown } | undefined);

      // Try to match by key first
      matchedOldOpt = Option.match(keyOpt, {
        onNone: () => Option.none(),
        onSome: (key) => {
          const maybe = Option.fromNullable(oldByKey.get(key));
          Option.match(maybe, {
            onNone: () => {},
            onSome: () => oldByKey.delete(key),
          });
          return maybe;
        },
      });

      // Fall back to type matching for unkeyed elements
      if (Option.isNone(matchedOldOpt)) {
        const idx = oldUnkeyed.findIndex((f) =>
          Option.match(f.type, {
            onNone: () => false,
            onSome: (fType) => fType === element.type,
          })
        );
        if (idx >= 0) {
          matchedOldOpt = Option.some(oldUnkeyed[idx]);
          oldUnkeyed.splice(idx, 1);
        }
      }

      // Create new fiber based on match
      const newFiber = yield* Option.match(matchedOldOpt, {
        onNone: () =>
          Effect.succeed(
            createFiber(
              Option.some(element.type),
              element.props,
              Option.some(wipFiber),
              Option.none(),
              Option.some("PLACEMENT" as const)
            )
          ),
        onSome: (matched) =>
          Effect.gen(function* () {
            const typeMatches = Option.match(matched.type, {
              onNone: () => false,
              onSome: (mType) => mType === element.type,
            });

            if (typeMatches) {
              // UPDATE - reuse DOM, update props
              const newProps = { ...element.props };
              // Preserve atom cache if present
              if ((matched.props as any)._atomCache) {
                (newProps as any)._atomCache = (matched.props as any)._atomCache;
              }

              const fiber = createFiber(
                matched.type,
                newProps,
                Option.some(wipFiber),
                matchedOldOpt,
                Option.some("UPDATE" as const)
              );
              fiber.dom = matched.dom;
              fiber.errorBoundary = matched.errorBoundary;
              fiber.suspense = matched.suspense;
              return fiber;
            } else {
              // Type changed - delete old, create new
              matched.effectTag = Option.some("DELETION" as const);
              yield* Ref.update(stateRef, (s: FiberState) => ({
                ...s,
                deletions: [...s.deletions, matched],
              }));

              return createFiber(
                Option.some(element.type),
                element.props,
                Option.some(wipFiber),
                Option.none(),
                Option.some("PLACEMENT" as const)
              );
            }
          }),
      });

      newFibers.push(newFiber);
    }

    // Mark leftover old fibers for deletion
    const leftovers = [...oldByKey.values(), ...oldUnkeyed];
    for (const leftover of leftovers) {
      leftover.effectTag = Option.some("DELETION" as const);
      yield* Ref.update(stateRef, (s: FiberState) => ({
        ...s,
        deletions: [...s.deletions, leftover],
      }));
    }

    // Link new fibers as child/sibling chain
    console.log(`[reconcileChildren] linking ${newFibers.length} fibers for ${Option.match(wipFiber.type, {onNone: () => "[no-type]", onSome: (t) => typeof t === "function" ? t.name || String(t) : String(t)})}`);
    for (let i = 0; i < newFibers.length; i++) {
      if (i === 0) {
        wipFiber.child = Option.some(newFibers[i]);
      } else {
        newFibers[i - 1].sibling = Option.some(newFibers[i]);
      }
    }

    if (newFibers.length === 0) {
      wipFiber.child = Option.none();
    }
  });

// =============================================================================
// Commit Phase
// =============================================================================

const deleteFiber = (fiber: Fiber): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    // Close component scope (unless fiber is parked - its scope must stay alive)
    if (!fiber.isParked) {
      yield* Option.match(fiber.componentScope, {
        onNone: () => Effect.void,
        onSome: (scope) => Scope.close(scope as Scope.Scope.Closeable, Exit.void),
      });
    }

    // Recursively delete children
    yield* Option.match(fiber.child, {
      onNone: () => Effect.void,
      onSome: (child) => deleteFiber(child),
    });
  });

const commitDeletion = (fiber: Fiber, domParent: Node): Effect.Effect<void, never, never> =>
  Option.match(fiber.dom, {
    onSome: (dom) =>
      Effect.sync(() => {
        domParent.removeChild(dom);
      }),
    onNone: () =>
      // Function component - find DOM children
      Effect.iterate(fiber.child, {
        while: (opt): opt is Option.Some<Fiber> => Option.isSome(opt),
        body: (childOpt) =>
          Effect.gen(function* () {
            const child = childOpt.value;
            yield* commitDeletion(child, domParent);
            return child.sibling;
          }),
      }),
  });

const commitRoot = (runtime: DidactRuntime) =>
  Effect.gen(function* () {
    const stateRef = runtime.fiberState;
    const currentState = yield* Ref.get(stateRef);

    // Process deletions first
    for (const fiber of currentState.deletions) {
      // Find DOM parent by walking up
      let domParentFiber = fiber.parent;
      while (Option.isSome(domParentFiber) && Option.isNone(domParentFiber.value.dom)) {
        domParentFiber = domParentFiber.value.parent;
      }

      yield* Option.match(domParentFiber, {
        onNone: () => Effect.void,
        onSome: (parentFiber) =>
          Option.match(parentFiber.dom, {
            onNone: () => Effect.void,
            onSome: (dom) => commitDeletion(fiber, dom),
          }),
      });

      yield* deleteFiber(fiber);
    }

    // Commit work starting from wipRoot.child
    yield* Option.match(currentState.wipRoot, {
      onNone: () => Effect.void,
      onSome: (wipRoot) =>
        Option.match(wipRoot.child, {
          onNone: () => Effect.void,
          onSome: (child) => commitWork(child, runtime),
        }),
    });

    // Swap wipRoot to currentRoot
    yield* Ref.update(stateRef, (s) => ({
      ...s,
      currentRoot: currentState.wipRoot,
      wipRoot: Option.none(),
      deletions: [],
    }));
  });

const commitWork = (fiber: Fiber, runtime: DidactRuntime): Effect.Effect<void, never, DidactRuntime> =>
  Effect.gen(function* () {
    const typeDesc = Option.match(fiber.type, {
      onNone: () => "[root]",
      onSome: (t) => typeof t === "function" ? t.name || "[fn]" : String(t),
    });
    const hasDom = Option.isSome(fiber.dom);
    const hasChild = Option.isSome(fiber.child);
    const hasSibling = Option.isSome(fiber.sibling);
    console.log(`[commitWork] fiber=${typeDesc}, dom=${hasDom}, child=${hasChild}, sibling=${hasSibling}, tag=${Option.getOrElse(fiber.effectTag, () => "none")}`);
    
    // KEY INSIGHT: If fiber has no DOM (function component), just process children
    if (Option.isNone(fiber.dom)) {
      console.log(`[commitWork] ${typeDesc} has no DOM, processing children`);
      yield* Option.match(fiber.child, {
        onNone: () => Effect.void,
        onSome: (child) => commitWork(child, runtime) as Effect.Effect<void, never, DidactRuntime>,
      });
      yield* Option.match(fiber.sibling, {
        onNone: () => Effect.void,
        onSome: (sibling) => commitWork(sibling, runtime) as Effect.Effect<void, never, DidactRuntime>,
      });
      return;
    }

    // Find DOM parent by walking up to nearest fiber with dom
    let domParentFiber = fiber.parent;
    while (Option.isSome(domParentFiber) && Option.isNone(domParentFiber.value.dom)) {
      domParentFiber = domParentFiber.value.parent;
    }

    yield* Option.match(domParentFiber, {
      onNone: () => Effect.void,
      onSome: (parentFiber) =>
        Option.match(parentFiber.dom, {
          onNone: () => Effect.void,
          onSome: (domParent) =>
            Option.match(fiber.effectTag, {
              onNone: () => Effect.void,
              onSome: (tag) =>
                Effect.gen(function* () {
                  if (tag === "PLACEMENT") {
                    yield* Option.match(fiber.dom, {
                      onNone: () => Effect.void,
                      onSome: (dom) => Effect.sync(() => domParent.appendChild(dom)),
                    });

                    // Signal first child committed (for Suspense)
                    yield* Option.match(fiber.parent, {
                      onNone: () => Effect.void,
                      onSome: (parent) =>
                        Option.match(parent.childFirstCommitDeferred, {
                          onNone: () => Effect.void,
                          onSome: (deferred) =>
                            Effect.gen(function* () {
                              const done = yield* Deferred.isDone(deferred);
                              if (!done) {
                                yield* Deferred.succeed(deferred, undefined);
                              }
                            }),
                        }),
                    });
                  } else if (tag === "UPDATE") {
                    const prevProps = Option.match(fiber.alternate, {
                      onNone: () => ({}),
                      onSome: (alt) => alt.props,
                    });
                    yield* Option.match(fiber.dom, {
                      onNone: () => Effect.void,
                      onSome: (dom) => updateDom(dom, prevProps, fiber.props, fiber, runtime),
                    });
                  } else if (tag === "DELETION") {
                    yield* commitDeletion(fiber, domParent);
                    return;
                  }
                }),
            }),
        }),
    });

    // Continue with children and siblings
    yield* Option.match(fiber.child, {
      onNone: () => Effect.void,
      onSome: (child) => commitWork(child, runtime) as Effect.Effect<void, never, DidactRuntime>,
    });
    yield* Option.match(fiber.sibling, {
      onNone: () => Effect.void,
      onSome: (sibling) => commitWork(sibling, runtime) as Effect.Effect<void, never, DidactRuntime>,
    });
  });

// =============================================================================
// Work Loop
// =============================================================================

const workLoop = (runtime: DidactRuntime) =>
  Effect.gen(function* () {
    const stateRef = runtime.fiberState;

    // Process all units of work
    let state = yield* Ref.get(stateRef);
    let workCount = 0;
    while (Option.isSome(state.nextUnitOfWork)) {
      const fiber = state.nextUnitOfWork.value;
      const typeDesc = Option.match(fiber.type, {
        onNone: () => "[root]",
        onSome: (t) => typeof t === "function" ? t.name || "[fn]" : String(t),
      });
      console.log(`[workLoop] unit ${workCount}: ${typeDesc}`);
      workCount++;
      
      const nextUnitOfWork = yield* performUnitOfWork(state.nextUnitOfWork.value, runtime);
      yield* Ref.update(stateRef, (s) => ({
        ...s,
        nextUnitOfWork: nextUnitOfWork,
      }));
      state = yield* Ref.get(stateRef);
    }
    console.log(`[workLoop] completed ${workCount} units of work`);

    // If we have a wipRoot but no more work, commit
    const finalState = yield* Ref.get(stateRef);
    if (Option.isNone(finalState.nextUnitOfWork) && Option.isSome(finalState.wipRoot)) {
      console.log(`[workLoop] starting commitRoot`);
      yield* commitRoot(runtime);
      console.log(`[workLoop] commitRoot finished`);
    }
  });

// =============================================================================
// Main Render Function
// =============================================================================

/**
 * Render a VElement tree to a DOM container using fiber-based reconciliation.
 *
 * This implementation:
 * - Uses a fiber tree for efficient updates
 * - Supports key-based diffing
 * - Function components have no DOM wrapper - fixing SSR hydration
 *
 * @param element - VElement to render
 * @param container - DOM container to render into
 */
export const renderFiber = (element: VElement, container: HTMLElement) =>
  Effect.gen(function* () {
    const runtime = yield* DidactRuntime;
    const stateRef = runtime.fiberState;
    const currentState = yield* Ref.get(stateRef);

    // Create root fiber with container as DOM
    const rootFiber = createFiber(
      Option.none(),
      { children: [element] },
      Option.none(),
      currentState.currentRoot,
      Option.none()
    );
    rootFiber.dom = Option.some(container);

    yield* Ref.update(stateRef, (s) => ({
      ...s,
      wipRoot: Option.some(rootFiber),
      deletions: [],
    }));

    const newState = yield* Ref.get(stateRef);
    yield* Ref.update(stateRef, (s) => ({
      ...s,
      nextUnitOfWork: newState.wipRoot,
    }));

    yield* workLoop(runtime);

    // Keep runtime alive
    return yield* Effect.never;
  });

// =============================================================================
// Hydration Support
// =============================================================================

/**
 * Hydrate an existing DOM tree with a VElement tree.
 *
 * This walks the existing DOM and builds a fiber tree that matches it,
 * enabling reactive updates without re-creating the DOM.
 */
export const hydrateFiber = (element: VElement, container: HTMLElement) =>
  Effect.gen(function* () {
    const runtime = yield* DidactRuntime;
    const stateRef = runtime.fiberState;

    // Create root fiber with container as DOM
    const rootFiber = createFiber(
      Option.none(),
      { children: [element] },
      Option.none(),
      Option.none(),
      Option.none()
    );
    rootFiber.dom = Option.some(container);

    // Build fiber tree by walking DOM and VElement together
    // The element itself is the child of the root fiber (same as renderFiber)
    yield* hydrateChildren(rootFiber, [element], Array.from(container.childNodes), runtime);

    yield* Ref.update(stateRef, (s) => ({
      ...s,
      currentRoot: Option.some(rootFiber),
      wipRoot: Option.none(),
      deletions: [],
    }));

    // Keep runtime alive
    return yield* Effect.never;
  });

const hydrateChildren = (
  parentFiber: Fiber,
  vElements: VElement[],
  domNodes: Node[],
  runtime: DidactRuntime
): Effect.Effect<void, unknown, DidactRuntime> =>
  Effect.gen(function* () {
    let domIndex = 0;
    const fibers: Fiber[] = [];

    for (const vElement of vElements) {
      const fiber = yield* hydrateElement(parentFiber, vElement, domNodes, domIndex, runtime);
      fibers.push(fiber);

      // Advance DOM index based on element type
      if (typeof vElement.type === "string") {
        domIndex++;
      }
      // Function components don't consume DOM nodes directly
    }

    // Link fibers
    for (let i = 0; i < fibers.length; i++) {
      if (i === 0) {
        parentFiber.child = Option.some(fibers[i]);
      } else {
        fibers[i - 1].sibling = Option.some(fibers[i]);
      }
    }
  });

const hydrateElement = (
  parentFiber: Fiber,
  vElement: VElement,
  domNodes: Node[],
  domIndex: number,
  runtime: DidactRuntime
): Effect.Effect<Fiber, unknown, DidactRuntime> =>
  Effect.gen(function* () {
    const fiber = createFiber(
      Option.some(vElement.type),
      vElement.props,
      Option.some(parentFiber),
      Option.none(),
      Option.none() // No effect tag - already in DOM
    );

    if (typeof vElement.type === "function") {
      // Function component - invoke to get children
      yield* hydrateFunctionComponent(fiber, vElement, domNodes, domIndex, runtime) as Effect.Effect<void, unknown, DidactRuntime>;
    } else if (vElement.type === "TEXT_ELEMENT") {
      // Text node
      const domNode = domNodes[domIndex];
      fiber.dom = Option.some(domNode);
    } else if (vElement.type === "FRAGMENT") {
      // Fragment - children are direct children of parent DOM
      yield* hydrateChildren(fiber, vElement.props.children || [], domNodes.slice(domIndex), runtime);
    } else {
      // Host element
      const domNode = domNodes[domIndex] as HTMLElement;
      fiber.dom = Option.some(domNode);

      // Inherit renderContext from parent fiber (function components capture it during render)
      if (Option.isNone(fiber.renderContext) && Option.isSome(fiber.parent)) {
        fiber.renderContext = fiber.parent.value.renderContext;
      }

      // Attach event listeners - uses runForkWithRuntime internally for full context
      attachEventListeners(domNode, vElement.props as Record<string, unknown>, runtime);

      // Handle ref
      const ref = vElement.props.ref;
      if (ref && typeof ref === "object" && "current" in ref) {
        (ref as { current: unknown }).current = domNode;
      }

      // Hydrate children
      const childNodes = Array.from(domNode.childNodes);
      yield* hydrateChildren(fiber, vElement.props.children || [], childNodes, runtime);
    }

    return fiber;
  });

const hydrateFunctionComponent = (
  fiber: Fiber,
  vElement: VElement,
  domNodes: Node[],
  domIndex: number,
  runtime: DidactRuntime
): Effect.Effect<void, unknown, DidactRuntime> =>
  Effect.gen(function* () {
    // Capture current context during render phase for event handlers in commit phase
    const currentContext = (yield* FiberRef.get(FiberRef.currentContext)) as Context.Context<any>;
    fiber.renderContext = Option.some(currentContext);

    // Set up atom tracking
    const accessedAtoms = new Set<Atom.Atom<any>>();
    const trackingRegistry = makeTrackingRegistry(runtime.registry, accessedAtoms);

    const contextWithTracking = Context.add(currentContext, AtomRegistry.AtomRegistry, trackingRegistry);

    // Invoke component
    const component = vElement.type as (props: any) => VElement | Effect.Effect<VElement> | Stream.Stream<VElement>;
    const output = yield* Effect.sync(() => component(vElement.props));

    fiber.isMultiEmissionStream = isStream(output);

    // Get first value from stream
    const stream = normalizeToStream(output as VElement | Effect.Effect<VElement> | Stream.Stream<VElement>).pipe(
      Stream.provideContext(contextWithTracking)
    );

    // Create scope for this component
    yield* resubscribeFiber(fiber);
    fiber.accessedAtoms = Option.some(accessedAtoms);

    const scope = yield* Option.match(fiber.componentScope, {
      onNone: () => Effect.die("Expected componentScope"),
      onSome: (s) => Effect.succeed(s),
    });

    // Set up fiber ref
    const fiberRef: FiberRefType = { current: fiber };
    fiber.fiberRef = Option.some(fiberRef);

    // First value deferred - use unknown error type so we can fail with any cause
    const firstValueDeferred = yield* Deferred.make<VElement, unknown>();

    // Fork stream subscription
    const subscription = Stream.runForEach(stream, (childVElement) =>
      Effect.gen(function* () {
        const done = yield* Deferred.isDone(firstValueDeferred);
        const currentFiber = fiberRef.current;
        if (!done) {
          yield* Deferred.succeed(firstValueDeferred, childVElement);
        } else {
          currentFiber.latestStreamValue = Option.some(childVElement);
          yield* queueFiberForRerender(currentFiber);
        }
      })
    ).pipe(
      Effect.catchAllCause((cause) =>
        Effect.gen(function* () {
          const done = yield* Deferred.isDone(firstValueDeferred);
          if (!done) {
            yield* Deferred.fail(firstValueDeferred, cause);
          }
          yield* handleFiberError(fiberRef.current, cause);
        })
      )
    );

    yield* Effect.forkIn(subscription, scope);

    // Wait for first value
    const childVElement = yield* Deferred.await(firstValueDeferred);
    fiber.latestStreamValue = Option.some(childVElement);

    // Hydrate the child VElement against remaining DOM nodes
    yield* hydrateChildren(fiber, [childVElement], domNodes.slice(domIndex), runtime);

    // Subscribe to atom changes
    yield* subscribeFiberAtoms(fiber, accessedAtoms, runtime);
  });
