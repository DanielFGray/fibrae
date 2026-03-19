/**
 * Fiber update and reconciliation functions.
 *
 * Contains the core update logic for function components and host components,
 * the work-loop's performUnitOfWork dispatcher, fiber scope management
 * (resubscribeFiber), atom/live-atom subscription wiring, and key-based
 * child reconciliation. Extracted from fiber-render.ts.
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
import * as Cause from "effect/Cause";
import * as Schema from "effect/Schema";
import * as RcMap from "effect/RcMap";

import { Atom, Registry as AtomRegistry, Result } from "@effect-atom/atom";
import { Transition } from "./transition.js";
import {
  type VElement,
  type Fiber,
  type FiberRef as FiberRefType,
  type ComponentError,
  ComponentScope,
  StreamError,
  isStream,
} from "./shared.js";
import { FibraeRuntime, type FiberState } from "./runtime.js";
import { normalizeToStream, makeTrackingRegistry } from "./tracking.js";
import { type LiveAtom } from "./live/atom.js";
import { LiveConfig } from "./live/config.js";
import {
  createFiber,
  fiberTypeIs,
  fiberTypeIsFunction,
  fiberIsVirtualElement,
  getComponentScopeOrDie,
  getComponentScopeService,
  linkFibersAsSiblings,
  findNextSibling,
  getSuspenseThreshold,
  queueFiberForRerender,
} from "./fiber-tree.js";
import {
  handleFiberError,
  handleFiberSuspension,
  signalFiberReady,
  signalBoundaryRecovery,
} from "./fiber-boundary.js";
import { createDom } from "./fiber-commit.js";

// =============================================================================
// Stream Subscription Helper
// =============================================================================

/**
 * Subscribe to a component's output stream, handling first value and subsequent emissions.
 *
 * Returns a deferred that will be completed with the first emitted value.
 * Subsequent emissions update latestStreamValue and queue re-renders.
 * Errors are forwarded to handleFiberError.
 *
 * @param stream - The component's output stream
 * @param fiberRef - Mutable reference to the current fiber (for re-renders after reconciliation)
 * @param scope - Scope to fork the subscription into
 *
 * @typeParam E - Error type for the deferred (use `never` for die mode, stream error type for fail mode)
 */
export const subscribeComponentStream = <E>(
  stream: Stream.Stream<VElement | null, E>,
  fiberRef: FiberRefType,
  scope: Scope.Scope,
): Effect.Effect<Deferred.Deferred<VElement | null, E>, never, FibraeRuntime> =>
  Effect.gen(function* () {
    const firstValueDeferred = yield* Deferred.make<VElement | null, E>();

    const subscription = Stream.runForEach(stream, (vElement) =>
      Effect.gen(function* () {
        const done = yield* Deferred.isDone(firstValueDeferred);
        const currentFiber = fiberRef.current;
        if (!done) {
          yield* Deferred.succeed(firstValueDeferred, vElement);
        } else {
          // Subsequent emissions - queue re-render
          // null means "render nothing" — store as Option.none so reconcileChildren gets []
          currentFiber.latestStreamValue =
            vElement === null ? Option.none() : Option.some(vElement);
          if (currentFiber.isParked) {
            // Parked under an error boundary — signal recovery
            yield* signalBoundaryRecovery(currentFiber);
          } else {
            yield* queueFiberForRerender(currentFiber);
          }
        }
      }),
    ).pipe(
      Effect.catchAllCause((cause: Cause.Cause<E>) =>
        Effect.gen(function* () {
          const done = yield* Deferred.isDone(firstValueDeferred);
          const streamError = new StreamError({
            cause: Cause.squash(cause),
            phase: done ? "after-first-emission" : "before-first-emission",
          });
          if (!done) {
            // Fail the deferred with StreamError so awaiting code gets the typed error
            yield* Deferred.fail(firstValueDeferred, streamError as E);
          }
          const currentFiber = fiberRef.current;
          yield* handleFiberError(currentFiber, streamError);
        }),
      ),
    );

    yield* Effect.forkIn(subscription, scope);

    return firstValueDeferred;
  });

// =============================================================================
// Update Function Component
// =============================================================================

export const updateFunctionComponent = (
  fiber: Fiber,
  runtime: FibraeRuntime,
): Effect.Effect<void, never, FibraeRuntime> =>
  Effect.gen(function* () {
    // Initialize deferred for child first commit signaling
    if (Option.isNone(fiber.childFirstCommitDeferred)) {
      fiber.childFirstCommitDeferred = Option.some(yield* Deferred.make<void>());
    }

    // Capture current context during render phase for event handlers in commit phase
    // This includes services like Navigator, RouterHandlers, etc.
    const currentContext = yield* FiberRef.get(FiberRef.currentContext);
    fiber.renderContext = Option.some(currentContext);

    // Check if we can reuse cached stream value from alternate
    const hasAlternate = Option.isSome(fiber.alternate);
    const hasCachedValue = fiber.alternate.pipe(
      Option.map((alt) => Option.isSome(alt.latestStreamValue) && alt.isMultiEmissionStream),
      Option.getOrElse(() => false),
    );

    if (hasAlternate && hasCachedValue) {
      // Reuse cached value from alternate (stream component that emitted multiple values)
      const alt = Option.getOrThrow(fiber.alternate);
      const vElement = Option.getOrThrow(alt.latestStreamValue);

      fiber.latestStreamValue = alt.latestStreamValue;
      fiber.accessedAtoms = alt.accessedAtoms;
      fiber.componentScope = alt.componentScope;
      alt.componentScope = Option.none(); // Transfer ownership
      fiber.fiberRef = alt.fiberRef;
      fiber.fiberRef.pipe(
        Option.map((ref) => {
          ref.current = fiber;
        }),
      );
      fiber.isMultiEmissionStream = alt.isMultiEmissionStream;

      yield* reconcileChildren(fiber, [vElement]);
      return;
    }

    // Check if this fiber is being restored from parked (suspended) state
    // If so, skip re-execution and use the cached latestStreamValue
    if (fiber.isUnparking && Option.isSome(fiber.latestStreamValue)) {
      fiber.isUnparking = false; // Clear flag
      const vElement = Option.getOrThrow(fiber.latestStreamValue);
      yield* reconcileChildren(fiber, [vElement]);
      return;
    }

    // Create scope for this component FIRST so it's available in context
    yield* resubscribeFiber(fiber);

    const componentScopeService = yield* getComponentScopeService(
      fiber,
      "Expected componentScope to be created by resubscribeFiber",
    );

    // Set up atom tracking
    const accessedAtoms = new Set<Atom.Atom<unknown>>();
    const accessedLiveAtoms = new Set<LiveAtom<any>>();
    const trackingRegistry = makeTrackingRegistry(
      runtime.registry,
      accessedAtoms,
      accessedLiveAtoms,
    );
    fiber.accessedAtoms = Option.some(accessedAtoms);

    // Build context with tracking registry AND ComponentScope
    // This allows Effect components to yield* ComponentScope for cleanup registration
    const contextWithTracking = Context.add(
      Context.add(currentContext, ComponentScope, componentScopeService),
      AtomRegistry.AtomRegistry,
      trackingRegistry,
    );

    // Invoke the component
    const output = yield* Option.match(fiber.type, {
      onNone: () => Effect.die("updateFunctionComponent called with no type"),
      onSome: (type) => {
        if (typeof type !== "function") {
          return Effect.die("updateFunctionComponent called with non-function type");
        }
        const component = type as (
          props: Record<string, unknown>,
        ) => VElement | null | Effect.Effect<VElement | null> | Stream.Stream<VElement | null>;
        return Effect.sync(() => component(fiber.props));
      },
    });

    // Fast path: if component returns a plain VElement or null (not Effect/Stream),
    // handle directly without stream machinery.
    if (!Effect.isEffect(output) && !isStream(output)) {
      // null = render nothing
      if (output === null) {
        yield* reconcileChildren(fiber, []);
        return;
      }
      const vElement = output;
      if (typeof vElement === "object" && vElement !== null && "type" in vElement) {
        const elementType = vElement.type;
        if (elementType === "SUSPENSE" || elementType === "FRAGMENT") {
          // Simple wrapper component - just reconcile with the VElement directly
          yield* reconcileChildren(fiber, [vElement]);
          return;
        }
      }
    }

    // Check if it's a multi-emission stream
    fiber.isMultiEmissionStream = isStream(output);

    // Normalize to stream and provide context
    const stream = normalizeToStream(output).pipe(Stream.provideContext(contextWithTracking));

    // Set up fiber ref for stream subscriptions
    const fiberRef: FiberRefType = fiber.fiberRef.pipe(
      Option.getOrElse(() => ({ current: fiber })),
    );
    fiber.fiberRef = Option.some(fiberRef);

    // Subscribe to component stream - errors become defects via "die" mode
    const firstValueDeferred = yield* subscribeComponentStream(
      stream,
      fiberRef,
      componentScopeService.scope,
    );

    // Get threshold from nearest Suspense boundary.
    // During an active transition, bypass the threshold entirely to prevent
    // Suspense fallback flash — old content stays visible while loading.
    const rawThreshold = getSuspenseThreshold(fiber);
    const inTransition = yield* Effect.serviceOption(Transition).pipe(
      Effect.map(
        Option.match({
          onNone: () => false,
          onSome: (t) => runtime.registry.get(t.isPending),
        }),
      ),
    );
    const threshold = inTransition ? 0 : rawThreshold;

    if (threshold > 0) {
      // Race first value vs threshold
      const result = yield* Effect.race(
        Deferred.await(firstValueDeferred).pipe(
          Effect.map((v) => ({ _tag: "value" as const, value: v })),
        ),
        Effect.sleep(`${threshold} millis`).pipe(Effect.map(() => ({ _tag: "timeout" as const }))),
      );

      if (result._tag === "timeout") {
        // Threshold expired - signal suspension to boundary
        yield* handleFiberSuspension(fiber);

        // Fork background work: wait for value, subscribe atoms, then signal ready
        // This allows the render loop to continue and show fallback
        yield* Effect.forkIn(
          Effect.gen(function* () {
            const value = yield* Deferred.await(firstValueDeferred);
            const currentFiber = fiberRef.current;
            currentFiber.latestStreamValue = value === null ? Option.none() : Option.some(value);
            // Subscribe to atom changes — the Effect has completed by now,
            // so accessedAtoms is fully populated from the tracking registry
            yield* subscribeFiberAtoms(currentFiber, accessedAtoms, runtime);
            if (accessedLiveAtoms.size > 0) {
              yield* activateLiveAtoms(
                accessedLiveAtoms,
                currentContext,
                runtime,
                componentScopeService.scope,
              );
            }
            yield* signalFiberReady(currentFiber);
          }),
          componentScopeService.scope,
        );

        // Return early - don't reconcile children yet
        // The Suspense boundary will show fallback via queued re-render
        return;
      } else {
        // Value arrived before threshold - no suspension
        const v = result.value;
        fiber.latestStreamValue = v === null ? Option.none() : Option.some(v);
        yield* reconcileChildren(fiber, v === null ? [] : [v]);
      }
    } else {
      // No threshold (0) - wait indefinitely, no suspension possible
      const firstVElement = yield* Deferred.await(firstValueDeferred);
      fiber.latestStreamValue = firstVElement === null ? Option.none() : Option.some(firstVElement);
      yield* reconcileChildren(fiber, firstVElement === null ? [] : [firstVElement]);
    }

    // Subscribe to atom changes
    yield* subscribeFiberAtoms(fiber, accessedAtoms, runtime);

    // Activate SSE connections for any live atoms
    if (accessedLiveAtoms.size > 0) {
      yield* activateLiveAtoms(
        accessedLiveAtoms,
        currentContext,
        runtime,
        componentScopeService.scope,
      );
    }
  });

// =============================================================================
// Perform Unit of Work
// =============================================================================

export const performUnitOfWork = (
  fiber: Fiber,
  runtime: FibraeRuntime,
): Effect.Effect<Option.Option<Fiber>, never, FibraeRuntime> =>
  Effect.gen(function* () {
    const isFunctionComponent = fiberTypeIsFunction(fiber);

    const eff = isFunctionComponent
      ? updateFunctionComponent(fiber, runtime)
      : updateHostComponent(fiber, runtime);

    const exited = yield* Effect.exit(eff);
    if (Exit.isFailure(exited)) {
      // handleFiberError returns the next fiber to process (if recovery happened)
      return yield* handleFiberError(fiber, exited.cause);
    }

    // Return next unit of work: child → sibling → uncle (walk up to find sibling)
    return fiber.child.pipe(Option.orElse(() => findNextSibling(fiber)));
  });

// =============================================================================
// Atom Subscription
// =============================================================================

export const resubscribeFiber = (fiber: Fiber) =>
  Effect.gen(function* () {
    // Close old scope if exists
    yield* Option.match(fiber.componentScope, {
      onNone: () => Effect.void,
      onSome: (scope) => Scope.close(scope, Exit.void),
    });

    // Create new scope and mounted deferred
    const newScope = yield* Scope.make();
    const newMounted = yield* Deferred.make<void>();
    fiber.componentScope = Option.some(newScope);
    fiber.mountedDeferred = Option.some(newMounted);
  });

export const subscribeFiberAtoms = (
  fiber: Fiber,
  accessedAtoms: Set<Atom.Atom<unknown>>,
  runtime: FibraeRuntime,
) =>
  Effect.gen(function* () {
    const scope = yield* getComponentScopeOrDie(
      fiber,
      "subscribeFiberAtoms requires an existing componentScope",
    );

    // Use registry.subscribe directly — simpler and more efficient than
    // toStream + drop(1) + runForEach. Cleanup via scope finalizers.
    // unsafeOffer is synchronous, no need for runForkWithRuntime.
    yield* Effect.forEach(
      accessedAtoms,
      (atom) =>
        Effect.gen(function* () {
          const unsubscribe = runtime.registry.subscribe(atom, () => {
            runtime.renderMailbox.unsafeOffer(fiber);
          });
          yield* Scope.addFinalizer(scope, Effect.sync(unsubscribe));
        }),
      { discard: true },
    );
  });

// =============================================================================
// Live Atom SSE Activation
// =============================================================================

/**
 * Activate SSE connections for live atoms using the runtime's RcMap.
 *
 * EventSources are shared by URL via RcMap — ref-counted and automatically
 * closed when the last consumer's scope closes. Each atom adds its own
 * listener to the shared EventSource.
 */
export const activateLiveAtoms = (
  liveAtoms: Set<LiveAtom<any>>,
  currentContext: Context.Context<never>,
  runtime: FibraeRuntime,
  scope: Scope.Scope,
): Effect.Effect<void> => {
  // Skip on server
  if (typeof window === "undefined") return Effect.void;

  // Try to get LiveConfig from context
  const configOption = Context.getOption(currentContext, LiveConfig);
  if (Option.isNone(configOption)) return Effect.void;

  const config = configOption.value;

  return Effect.gen(function* () {
    // Ensure withCredentials is set before any RcMap lookups create EventSources
    yield* Ref.set(runtime.sseWithCredentials, config.withCredentials ?? false);

    yield* Effect.forEach(
      liveAtoms,
      (atom) =>
        Effect.gen(function* () {
          const url = LiveConfig.resolve(config, atom._live.event);
          const decode = Schema.decodeUnknownSync(Schema.parseJson(atom._live.schema));

          // Get shared EventSource for this URL (ref-counted via RcMap).
          // Scope.extend binds the reference to the component scope —
          // when the component unmounts, the ref count decrements.
          const es = yield* RcMap.get(runtime.sseConnections, url).pipe(Scope.extend(scope));

          const handler = (e: MessageEvent) => {
            try {
              runtime.registry.set(atom, Result.success(decode(e.data)));
            } catch {
              // Decode errors silently skipped
            }
          };
          es.addEventListener(atom._live.event, handler);

          // Clean up this atom's listener when the component unmounts
          yield* Scope.addFinalizer(
            scope,
            Effect.sync(() => es.removeEventListener(atom._live.event, handler)),
          );
        }),
      { discard: true },
    );
  });
};

// =============================================================================
// Update Host Component
// =============================================================================

export const updateHostComponent = (
  fiber: Fiber,
  runtime: FibraeRuntime,
): Effect.Effect<void, never, FibraeRuntime> =>
  Effect.gen(function* () {
    // Inherit renderContext from parent fiber (function components capture it during render)
    // This propagates Navigator, RouterHandlers, etc. down to host elements for event handlers
    if (Option.isNone(fiber.renderContext) && Option.isSome(fiber.parent)) {
      fiber.renderContext = fiber.parent.value.renderContext;
    }

    // Handle BOUNDARY specially (Effect-native error boundary API)
    const isBoundary = fiberTypeIs(fiber, "BOUNDARY");

    if (isBoundary) {
      const boundaryId = fiber.props.boundaryId as string;
      const fallbackFn = fiber.props.fallback as (error: ComponentError) => VElement;

      // Inherit boundary state from alternate (previous render) if present
      // This preserves hasError state across re-renders
      if (Option.isNone(fiber.boundary) && Option.isSome(fiber.alternate)) {
        const alt = fiber.alternate.value;
        if (Option.isSome(alt.boundary)) {
          fiber.boundary = alt.boundary;
        }
      }

      // Initialize boundary config if not already set
      if (Option.isNone(fiber.boundary)) {
        fiber.boundary = Option.some({
          boundaryId,
          fallback: fallbackFn,
          hasError: false,
          error: Option.none(),
          parkedFiber: Option.none(),
          currentFiber: Option.none(),
        });
      }

      const cfg = Option.getOrThrow(fiber.boundary);
      // Always update the current fiber reference (survives alternate swaps)
      cfg.currentFiber = Option.some(fiber);

      if (cfg.hasError && Option.isSome(cfg.error)) {
        // Error state — render fallback, children are parked
        const fallbackElement = cfg.fallback(cfg.error.value);
        yield* reconcileChildren(fiber, [fallbackElement]);
      } else if (Option.isSome(cfg.parkedFiber)) {
        // Recovering from error — close parked scopes and re-create children fresh.
        // The parked tree served only to keep the stream subscription alive long enough
        // to detect the next emission (route change). Now we rebuild from scratch.
        const closeParkedTree = (f: Fiber): Effect.Effect<void> =>
          Effect.gen(function* () {
            f.isParked = false;
            if (Option.isSome(f.componentScope)) {
              yield* Scope.close(f.componentScope.value, Exit.void);
            }
            if (Option.isSome(f.child)) yield* closeParkedTree(f.child.value);
            if (Option.isSome(f.sibling)) yield* closeParkedTree(f.sibling.value);
          });
        yield* closeParkedTree(cfg.parkedFiber.value);
        cfg.parkedFiber = Option.none();

        // Re-create children from the original props
        const children = fiber.props.children;
        yield* reconcileChildren(fiber, children || []);
      } else {
        // Normal rendering — show children
        const children = fiber.props.children;
        yield* reconcileChildren(fiber, children || []);
      }
      return;
    }

    // Handle SUSPENSE specially
    const isSuspense = fiberTypeIs(fiber, "SUSPENSE");

    if (isSuspense) {
      const fallback = fiber.props.fallback as VElement;
      const threshold = (fiber.props.threshold as number) ?? 100;
      const children = fiber.props.children;

      // Initialize suspense config if not already set
      if (Option.isNone(fiber.suspense)) {
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
      const parkedDone = yield* config.parkedComplete.pipe(
        Option.map((d) => Deferred.isDone(d)),
        Option.getOrElse(() => Effect.succeed(false)),
      );

      if (parkedDone && config.showingFallback) {
        // Parked fiber is ready - switch back to showing its content
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
        yield* reconcileChildren(fiber, [fallback]);
      } else {
        // Show children normally (they'll race against threshold in updateFunctionComponent)
        yield* reconcileChildren(fiber, children || []);
      }
      return;
    }

    // Virtual element types don't create DOM - just reconcile children
    const isVirtualElement = fiberIsVirtualElement(fiber);

    if (!isVirtualElement && Option.isNone(fiber.dom)) {
      fiber.dom = Option.some(yield* createDom(fiber, runtime));
    }

    const children = fiber.props.children;
    yield* reconcileChildren(fiber, children || []);
  });

// =============================================================================
// Reconcile Children (key-based diffing)
// =============================================================================

export const reconcileChildren = (wipFiber: Fiber, elements: VElement[]) =>
  Effect.gen(function* () {
    const runtime = yield* FibraeRuntime;
    const stateRef = runtime.fiberState;

    // Collect old children from alternate by walking the sibling chain
    const collectSiblings = (start: Option.Option<Fiber>): Fiber[] => {
      const result: Fiber[] = [];
      let current = start;
      while (Option.isSome(current)) {
        result.push(current.value);
        current = current.value.sibling;
      }
      return result;
    };
    const oldChildren = wipFiber.alternate.pipe(
      Option.map((alt) => collectSiblings(alt.child)),
      Option.getOrElse((): Fiber[] => []),
    );

    const getKey = (props: Record<string, unknown> | undefined): Option.Option<unknown> =>
      Option.fromNullable(props?.key);

    // Build maps for keyed and unkeyed old fibers
    const { keyed: oldByKey, unkeyed: oldUnkeyed } = oldChildren.reduce(
      (acc, f) => {
        Option.match(getKey(f.props), {
          onNone: () => acc.unkeyed.push(f),
          onSome: (key) => acc.keyed.set(key, f),
        });
        return acc;
      },
      { keyed: new Map<unknown, Fiber>(), unkeyed: [] as Fiber[] },
    );

    // Match each element against old fibers by key, then by type
    const matchOldFiber = (element: VElement): Option.Option<Fiber> => {
      // Try keyed match first
      const keyMatch = getKey(element.props).pipe(
        Option.flatMap((key) => {
          const found = Option.fromNullable(oldByKey.get(key));
          found.pipe(Option.map(() => oldByKey.delete(key)));
          return found;
        }),
      );
      if (Option.isSome(keyMatch)) return keyMatch;

      // Fall back to type matching for unkeyed elements
      const idx = oldUnkeyed.findIndex((f) =>
        f.type.pipe(
          Option.map((fType) => fType === element.type),
          Option.getOrElse(() => false),
        ),
      );
      if (idx >= 0) {
        const matched = oldUnkeyed[idx];
        oldUnkeyed.splice(idx, 1);
        return Option.some(matched);
      }
      return Option.none();
    };

    // Reconcile each element against its matched old fiber
    const newFibers = yield* Effect.forEach(elements, (element) => {
      const matchedOldOpt = matchOldFiber(element);

      return matchedOldOpt.pipe(
        Option.match({
          onNone: () =>
            Effect.succeed(
              createFiber(
                Option.some(element.type),
                element.props,
                Option.some(wipFiber),
                Option.none(),
                Option.some("PLACEMENT" as const),
              ),
            ),
          onSome: (matched) =>
            Effect.gen(function* () {
              const typeMatches = matched.type.pipe(
                Option.map((mType) => mType === element.type),
                Option.getOrElse(() => false),
              );

              if (typeMatches) {
                // UPDATE - reuse DOM, update props
                const fiber = createFiber(
                  matched.type,
                  element.props,
                  Option.some(wipFiber),
                  matchedOldOpt,
                  Option.some("UPDATE" as const),
                );
                fiber.dom = matched.dom;
                fiber.boundary = matched.boundary;
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
                  Option.some("PLACEMENT" as const),
                );
              }
            }),
        }),
      );
    });

    // Mark leftover old fibers for deletion
    const leftovers = [...oldByKey.values(), ...oldUnkeyed];
    yield* Effect.forEach(
      leftovers,
      (leftover) =>
        Effect.gen(function* () {
          leftover.effectTag = Option.some("DELETION" as const);
          yield* Ref.update(stateRef, (s: FiberState) => ({
            ...s,
            deletions: [...s.deletions, leftover],
          }));
        }),
      { discard: true },
    );

    // Link new fibers as child/sibling chain
    linkFibersAsSiblings(newFibers, wipFiber);
  });
