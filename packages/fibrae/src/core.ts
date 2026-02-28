import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as FiberRef from "effect/FiberRef";
import * as Context from "effect/Context";

import { Registry as AtomRegistry, Hydration } from "@effect-atom/atom";
import { type VElement } from "./shared.js";
import { FibraeRuntime, CustomAtomRegistryLayer } from "./runtime.js";
import { renderFiber, hydrateFiber } from "./fiber-render.js";
import { HydrationState, HydrationStateLive } from "./hydration-state.js";

// =============================================================================
// Internal render logic (requires all services)
// =============================================================================

const renderCore = (element: VElement, container: HTMLElement) =>
  Effect.gen(function* () {
    const runtime = yield* FibraeRuntime;
    const registry = yield* AtomRegistry.AtomRegistry;

    // Capture the full context NOW (after all layers are built) and store it in runtime
    // This ensures user-provided services like Navigator are available for forked effects
    const fullContext = (yield* FiberRef.get(
      FiberRef.currentContext,
    )) as Context.Context<unknown>;
    yield* Ref.set(runtime.fullContextRef, fullContext);

    // Auto-discover and hydrate atoms from the HydrationState service
    const hydrationState = yield* HydrationState;
    if (hydrationState.length > 0) {
      Hydration.hydrate(registry, hydrationState);
    }

    // If container has element children, use hydration mode
    // (skip whitespace-only text nodes that may exist in pre-rendered HTML)
    const firstElementChild = container.firstElementChild;
    if (firstElementChild) {
      return yield* hydrateFiber(element, container);
    } else {
      // Fresh render - create new DOM using fiber-based reconciliation
      return yield* renderFiber(element, container);
    }
  });

// =============================================================================
// Public API
// =============================================================================

/**
 * Render a VElement tree to a container.
 * Returns an Effect that runs forever (until interrupted).
 *
 * If the container already has children, hydration mode is used:
 * - Existing DOM nodes are reused (not replaced)
 * - Event handlers are attached to existing elements
 * - Throws HydrationMismatch if structure doesn't match
 *
 * Services are auto-detected from the current Effect context:
 * - AtomRegistry: if already provided (e.g. shared between render and other effects),
 *   render will use it. Otherwise creates a fresh one.
 * - HydrationState: if already provided, uses it. Otherwise auto-discovers from DOM.
 *
 * A fresh FibraeRuntime is always created per render tree (each has its own fiber state).
 *
 * @param element - The VElement tree to render
 * @param container - The DOM container to render into
 * @param options - Optional configuration
 * @param options.layer - Additional layer to provide (will have access to AtomRegistry)
 */
export function render(
  element: VElement,
  container: HTMLElement,
): Effect.Effect<never, never, never>;
export function render<ROut, E>(
  element: VElement,
  container: HTMLElement,
  options: {
    layer?: Layer.Layer<ROut, E, AtomRegistry.AtomRegistry>;
  },
): Effect.Effect<never, never, never>;
export function render(
  element: VElement,
): (container: HTMLElement) => Effect.Effect<never, never, never>;
export function render(
  element: VElement,
  container?: HTMLElement,
  options?: {
    layer?: Layer.Layer<any, any, AtomRegistry.AtomRegistry>;
  },
) {
  const program = (cont: HTMLElement) =>
    Effect.gen(function* () {
      // Auto-detect services from the current context
      const existingRegistry = yield* Effect.serviceOption(AtomRegistry.AtomRegistry);
      const existingHydration = yield* Effect.serviceOption(HydrationState);

      // Use existing AtomRegistry if provided, otherwise create a fresh one
      const registryLayer = Option.match(existingRegistry, {
        onNone: () => CustomAtomRegistryLayer,
        onSome: (reg) => Layer.succeed(AtomRegistry.AtomRegistry, reg),
      });

      // Use existing HydrationState if provided, otherwise auto-discover from DOM
      const hydrationLayer = Option.match(existingHydration, {
        onNone: () => HydrationStateLive,
        onSome: (state) => Layer.succeed(HydrationState, state),
      });

      // Always create a fresh FibraeRuntime (each render tree has its own fiber state),
      // wired to the chosen AtomRegistry
      const runtimeLayer = Layer.provide(FibraeRuntime.Default, registryLayer);

      // Compose: user layer (if any) feeds from registryLayer, all merge together
      const baseLayer = Layer.mergeAll(runtimeLayer, registryLayer, hydrationLayer);
      const fullLayer = options?.layer
        ? Layer.provideMerge(options.layer, baseLayer)
        : baseLayer;

      return yield* renderCore(element, cont).pipe(
        Effect.provide(fullLayer),
      );
    });

  if (container === undefined) {
    return (cont: HTMLElement) => program(cont);
  }
  return program(container);
}
