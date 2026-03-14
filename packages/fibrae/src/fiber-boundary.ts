/**
 * Error boundary and suspense boundary handlers.
 *
 * Functions for converting errors, parking fibers, and signaling recovery
 * in ErrorBoundary and Suspense components.
 */

import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Deferred from "effect/Deferred";
import * as Cause from "effect/Cause";

import {
  type Fiber,
  type ComponentError,
  RenderError,
  StreamError,
  EventHandlerError,
} from "./shared.js";
import { FibraeRuntime } from "./runtime.js";
import { findNearestBoundary, findNearestSuspenseBoundary, queueFiberForRerender } from "./fiber-tree.js";

/**
 * Convert a raw cause/error to a ComponentError.
 * If it's already a ComponentError, return as-is.
 * Otherwise, wrap in RenderError as a fallback.
 */
export const toComponentError = (cause: unknown): ComponentError => {
  // Check if it's already a ComponentError
  if (
    cause instanceof RenderError ||
    cause instanceof StreamError ||
    cause instanceof EventHandlerError
  ) {
    return cause;
  }
  // Extract the actual error from Cause if needed
  const actualError = Cause.isCause(cause) ? Cause.squash(cause) : cause;
  if (
    actualError instanceof RenderError ||
    actualError instanceof StreamError ||
    actualError instanceof EventHandlerError
  ) {
    return actualError;
  }
  // Wrap unknown errors as RenderError
  return new RenderError({ cause: actualError });
};

/**
 * Handle an error by finding the nearest error boundary and rendering its fallback.
 *
 * Parks the boundary's children (keeps subscriptions alive for recovery)
 * and queues the boundary for re-render with the fallback element.
 * When parked children emit new values (e.g. route change), the boundary resets.
 */
export const handleFiberError = (
  fiber: Fiber,
  cause: unknown,
): Effect.Effect<Option.Option<Fiber>, never, FibraeRuntime> =>
  Effect.gen(function* () {
    const componentError = toComponentError(cause);

    // Find nearest boundary
    const boundaryOpt = findNearestBoundary(fiber);

    return yield* Option.match(boundaryOpt, {
      onNone: () =>
        Effect.gen(function* () {
          yield* Effect.logError("Unhandled error without any error boundary", componentError);
          return Option.none<Fiber>();
        }),
      onSome: (boundary) =>
        Effect.gen(function* () {
          const cfg = Option.getOrThrow(boundary.boundary);
          cfg.hasError = true;
          cfg.error = Option.some(componentError);

          // Park the boundary's child fiber tree — keep subscriptions alive for recovery.
          // Walk all children and mark them as parked so their scopes aren't closed.
          const parkFiberTree = (f: Fiber): void => {
            f.isParked = true;
            if (Option.isSome(f.child)) parkFiberTree(f.child.value);
            if (Option.isSome(f.sibling)) parkFiberTree(f.sibling.value);
          };
          if (Option.isSome(boundary.child)) {
            cfg.parkedFiber = boundary.child;
            parkFiberTree(boundary.child.value);
          }

          // Queue the boundary for re-render — it will show the fallback
          yield* queueFiberForRerender(boundary);

          return Option.none<Fiber>();
        }),
    });
  });

/**
 * Called when a stream component's threshold expires before first emission.
 * Parks the fiber and switches the boundary to show fallback.
 */
export const handleFiberSuspension = (fiber: Fiber): Effect.Effect<void, never, FibraeRuntime> =>
  Effect.gen(function* () {
    const boundaryOpt = findNearestSuspenseBoundary(fiber);
    if (Option.isNone(boundaryOpt)) {
      // No Suspense boundary - just continue waiting
      return;
    }

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
    yield* queueFiberForRerender(boundary);
  });

/**
 * Called when a parked fiber finally gets its first emission.
 * Signals the boundary to swap back to showing children.
 */
export const signalFiberReady = (fiber: Fiber): Effect.Effect<void, never, FibraeRuntime> =>
  Effect.gen(function* () {
    const boundaryOpt = findNearestSuspenseBoundary(fiber);
    if (Option.isNone(boundaryOpt)) return;

    const boundary = boundaryOpt.value;
    const config = Option.getOrThrow(boundary.suspense);

    // Unpark the fiber - it's ready now, scope can be closed normally on next deletion
    fiber.isParked = false;

    // Signal that parked fiber is ready
    yield* config.parkedComplete.pipe(
      Option.map((deferred) => Deferred.succeed(deferred, undefined)),
      Option.getOrElse(() => Effect.void),
    );

    // Trigger re-render to swap fallback → children
    yield* queueFiberForRerender(boundary);
  });

/**
 * Called when a parked-under-boundary fiber emits a new value (e.g. route change).
 * Signals the error boundary to reset — unpark children and show new content.
 */
export const signalBoundaryRecovery = (fiber: Fiber): Effect.Effect<void, never, FibraeRuntime> =>
  Effect.gen(function* () {
    // Walk up to find the boundary config (may be on an old/alternate fiber)
    const boundaryOpt = findNearestBoundary(fiber);
    if (Option.isNone(boundaryOpt)) return;

    const cfg = Option.getOrThrow(boundaryOpt.value.boundary);

    if (!cfg.hasError) return;

    // Reset error state
    cfg.hasError = false;
    cfg.error = Option.none();

    // Unpark the entire parked fiber tree
    const unparkFiberTree = (f: Fiber): void => {
      f.isParked = false;
      if (Option.isSome(f.child)) unparkFiberTree(f.child.value);
      if (Option.isSome(f.sibling)) unparkFiberTree(f.sibling.value);
    };
    if (Option.isSome(cfg.parkedFiber)) {
      unparkFiberTree(cfg.parkedFiber.value);
    }

    // Use currentFiber ref to queue the ACTIVE boundary fiber (not the stale alternate)
    const currentBoundary = Option.isSome(cfg.currentFiber)
      ? cfg.currentFiber.value
      : boundaryOpt.value;
    yield* queueFiberForRerender(currentBoundary);
  });
