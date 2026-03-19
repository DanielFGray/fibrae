/**
 * Transition service — keeps old UI visible during navigation.
 *
 * Provides an `isPending` atom that is true while a route loader is running.
 * Components can subscribe to show loading indicators without Suspense fallback.
 *
 * When provided:
 * - RouterOutlet sets isPending=true during loader execution
 * - Suspense bypasses its threshold during transitions (no fallback flash)
 * - Stale loaders are cancelled via Stream.switchMap
 *
 * Usage:
 * ```tsx
 * // Provide TransitionLive to your app
 * render(<App />, root, { layer: TransitionLive })
 *
 * // Read isPending in any component
 * const NavBar = () => Effect.gen(function* () {
 *   const { isPending } = yield* Transition
 *   const pending = yield* Atom.get(isPending)
 *   return <nav class={pending ? "loading" : ""}>...</nav>
 * })
 * ```
 */

import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import { Atom } from "@effect-atom/atom";

// =============================================================================
// Types
// =============================================================================

/**
 * Transition service interface.
 *
 * `isPending` is a reactive atom — components that read it will re-render
 * when its value changes, enabling loading indicators during navigation.
 */
export interface TransitionService {
  /** Reactive atom — true while a route transition loader is running. */
  readonly isPending: Atom.Writable<boolean, boolean>;
}

// =============================================================================
// Service Tag
// =============================================================================

/**
 * Context tag for the Transition service.
 * When provided, RouterOutlet sets isPending during loader execution
 * and Suspense bypasses its threshold during transitions.
 */
export class Transition extends Context.Tag("fibrae/Transition")<Transition, TransitionService>() {}

// =============================================================================
// Layer
// =============================================================================

/**
 * Live layer for the Transition service.
 * Creates an isPending atom scoped to this layer.
 */
export const TransitionLive: Layer.Layer<Transition> = Layer.succeed(
  Transition,
  Transition.of({ isPending: Atom.make(false) }),
);
