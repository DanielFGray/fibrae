import * as Effect from "effect/Effect";
import * as Scope from "effect/Scope";
import * as FiberSet from "effect/FiberSet";
import * as Layer from "effect/Layer";

import { Atom, Registry as AtomRegistry } from "@effect-atom/atom";

// =============================================================================
// Runtime Service
// =============================================================================

export const CustomAtomRegistryLayer = AtomRegistry.layerOptions({
  scheduleTask: (f: () => void) => f()
});

export class DidactRuntime extends Effect.Service<DidactRuntime>()("DidactRuntime", {
  accessors: true,
  dependencies: [CustomAtomRegistryLayer],
  scoped: Effect.gen(function*() {
    const registry = yield* AtomRegistry.AtomRegistry;
    const rootScope = yield* Scope.make();
    const runFork = yield* FiberSet.makeRuntime<AtomRegistry.AtomRegistry>();

    const AtomOps = {
      get: <A>(atom: Atom.Atom<A>): A => registry.get(atom),
      set: <R, W>(atom: Atom.Writable<R, W>, value: W): void => registry.set(atom, value),
      update: <R, W>(atom: Atom.Writable<R, W>, f: (_: R) => W): void => registry.update(atom, f),
      modify: <R, W, A>(atom: Atom.Writable<R, W>, f: (_: R) => [returnValue: A, nextValue: W]): A => registry.modify(atom, f),
    };

    return { registry, rootScope, runFork, AtomOps };
  }),
}) {
  static Live = DidactRuntime.Default;

  /**
   * Layer that provides both DidactRuntime AND AtomRegistry.
   * Use this when composing with user layers that need AtomRegistry access.
   * (DidactRuntime.Default consumes AtomRegistry internally but doesn't re-export it)
   */
  static LiveWithRegistry = Layer.merge(DidactRuntime.Default, CustomAtomRegistryLayer);
}
