import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { Registry as AtomRegistry, Hydration } from "@effect-atom/atom";
import { type VElement } from "./shared.js";
import { DidactRuntime } from "./runtime.js";
import { renderVElementToDOM } from "./render.js";
import { hydrateVElementToDOM } from "./hydration.js";

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
      const runtime = yield* DidactRuntime;
      const registry = yield* AtomRegistry.AtomRegistry;

      // If initialState provided, hydrate atoms first
      if (options?.initialState) {
        Hydration.hydrate(registry, options.initialState);
      }

      // If container has element children, use hydration mode
      // (skip whitespace-only text nodes that may exist in pre-rendered HTML)
      const firstElementChild = cont.firstElementChild;
      if (firstElementChild) {
        yield* hydrateVElementToDOM(element, firstElementChild, runtime);
      } else {
        // Fresh render - create new DOM
        yield* renderVElementToDOM(element, cont, runtime);
      }

      // Keep the effect running forever (until interrupted)
      return yield* Effect.never;
    }).pipe(
      // Always use LiveWithRegistry so the program has access to both DidactRuntime AND AtomRegistry
      // If user provided a layer, merge it in as well
      Effect.provide(
        options?.layer
          ? Layer.provideMerge(options.layer, DidactRuntime.LiveWithRegistry)
          : DidactRuntime.LiveWithRegistry
      )
    );

  if (container === undefined) {
    return (cont: HTMLElement) => program(cont);
  }
  return program(container);
}
