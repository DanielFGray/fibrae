import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Scope from "effect/Scope";

import { Atom, Registry as AtomRegistry } from "@effect-atom/atom";
import { type VElement, isStream } from "./shared.js";
import { LumonRuntime } from "./runtime.js";

// =============================================================================
// Stream Normalization
// =============================================================================

/**
 * Normalize component output to a Stream.
 * Components can return VElement, Effect<VElement, E>, or Stream<VElement, E>.
 * Error type is preserved through the conversion.
 */
export const normalizeToStream = <E>(
  value: VElement | Effect.Effect<VElement, E, never> | Stream.Stream<VElement, E, never>
): Stream.Stream<VElement, E, never> => {
  if (isStream(value)) return value;
  if (Effect.isEffect(value)) return Stream.fromEffect(value);
  return Stream.succeed(value);
};

// =============================================================================
// Atom Tracking
// =============================================================================

/**
 * Create a tracking registry that records which atoms are accessed
 */
export const makeTrackingRegistry = (
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

/**
 * Subscribe to atom changes for reactivity.
 * Uses registry.subscribe directly (like atom-react) instead of streams.
 * This is simpler and more efficient - subscriptions are synchronous
 * and cleanup is handled via scope finalizers.
 */
export const subscribeToAtoms = (
  atoms: Set<Atom.Atom<unknown>>,
  onUpdate: () => void,
  runtime: LumonRuntime,
  scope: Scope.Scope.Closeable
): Effect.Effect<void, never, never> =>
  Effect.forEach(
    atoms,
    (atom) =>
      Effect.gen(function*() {
        // Subscribe immediately - returns unsubscribe function
        const unsubscribe = runtime.registry.subscribe(atom, onUpdate);
        // Register unsubscribe to run when scope closes
        yield* Scope.addFinalizer(scope, Effect.sync(unsubscribe));
      }),
    { discard: true }
  );
