import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as FiberRef from "effect/FiberRef";
import * as Context from "effect/Context";

import { Registry as AtomRegistry, Hydration } from "@effect-atom/atom";
import { type VElement } from "./shared.js";
import { FibraeRuntime } from "./runtime.js";
import { renderFiber, hydrateFiber } from "./fiber-render.js";
import { HydrationState, HydrationStateLive } from "./hydration-state.js";

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
 * Hydration state is auto-discovered from a
 * <script type="application/json" id="__fibrae-state__"> tag in the DOM.
 * Provide a custom HydrationState layer to override this behavior.
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
      const firstElementChild = cont.firstElementChild;
      if (firstElementChild) {
        return yield* hydrateFiber(element, cont);
      } else {
        // Fresh render - create new DOM using fiber-based reconciliation
        return yield* renderFiber(element, cont);
      }
    }).pipe(
      // Provide HydrationState (default auto-discover from DOM)
      Effect.provide(HydrationStateLive),
      // Always use LiveWithRegistry so the program has access to both FibraeRuntime AND AtomRegistry
      // If user provided a layer, merge it in as well
      Effect.provide(
        options?.layer
          ? Layer.provideMerge(options.layer, FibraeRuntime.LiveWithRegistry)
          : FibraeRuntime.LiveWithRegistry,
      ),
    );

  if (container === undefined) {
    return (cont: HTMLElement) => program(cont);
  }
  return program(container);
}
