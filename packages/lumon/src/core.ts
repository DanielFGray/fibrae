import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as FiberRef from "effect/FiberRef";
import * as Context from "effect/Context";

import { Registry as AtomRegistry, Hydration } from "@effect-atom/atom";
import { type VElement } from "./shared.js";
import { LumonRuntime } from "./runtime.js";
import { renderFiber, hydrateFiber } from "./fiber-render.js";

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
 * @param element - The VElement tree to render
 * @param container - The DOM container to render into
 * @param options - Optional configuration
 * @param options.layer - Additional layer to provide (will have access to AtomRegistry)
 * @param options.initialState - Dehydrated atom state from SSR (enables atom hydration)
 */
export function render(element: VElement, container: HTMLElement): Effect.Effect<never, never, never>;
export function render(element: VElement, container: HTMLElement, options: {
  layer?: Layer.Layer<unknown, unknown, AtomRegistry.AtomRegistry>;
  initialState?: ReadonlyArray<Hydration.DehydratedAtom>;
}): Effect.Effect<never, never, never>;
export function render(element: VElement): (container: HTMLElement) => Effect.Effect<never, never, never>;
export function render(
  element: VElement,
  container?: HTMLElement,
  options?: {
    layer?: Layer.Layer<unknown, unknown, AtomRegistry.AtomRegistry>;
    initialState?: ReadonlyArray<Hydration.DehydratedAtom>;
  },
) {
  const program = (cont: HTMLElement) =>
    Effect.gen(function*() {
      const runtime = yield* LumonRuntime;
      const registry = yield* AtomRegistry.AtomRegistry;

      // Capture the full context NOW (after all layers are built) and store it in runtime
      // This ensures user-provided services like Navigator are available for forked effects
      const fullContext = (yield* FiberRef.get(FiberRef.currentContext)) as Context.Context<unknown>;
      yield* Ref.set(runtime.fullContextRef, fullContext);

      // If initialState provided, hydrate atoms first
      if (options?.initialState) {
        Hydration.hydrate(registry, options.initialState);
      }

      // If container has element children, use hydration mode
      // (skip whitespace-only text nodes that may exist in pre-rendered HTML)
      const firstElementChild = cont.firstElementChild;
      if (firstElementChild) {
        yield* hydrateFiber(element, cont);
      } else {
        // Fresh render - create new DOM using fiber-based reconciliation
        yield* renderFiber(element, cont);
      }

      // Note: renderFiber/hydrateFiber already return Effect.never
      // This line is unreachable but satisfies the type system
      return yield* Effect.never;
    }).pipe(
      // Always use LiveWithRegistry so the program has access to both LumonRuntime AND AtomRegistry
      // If user provided a layer, merge it in as well
      Effect.provide(
        options?.layer
          ? Layer.provideMerge(options.layer, LumonRuntime.LiveWithRegistry)
          : LumonRuntime.LiveWithRegistry
      )
    );

  if (container === undefined) {
    return (cont: HTMLElement) => program(cont);
  }
  return program(container);
}
