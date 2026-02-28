import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Scope from "effect/Scope";
import * as FiberSet from "effect/FiberSet";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Option from "effect/Option";
import * as Context from "effect/Context";
// These imports are needed for TypeScript declaration file emission
import type * as EffectFiber from "effect/Fiber";
import type * as Runtime from "effect/Runtime";

import { Atom, Registry as AtomRegistry, Result } from "@effect-atom/atom";
import * as RegistryModule from "@effect-atom/atom/Registry";
import type { Fiber } from "./shared.js";

// Re-export to satisfy declaration file requirements
export type { EffectFiber, Runtime };

// =============================================================================
// Fiber State (per render tree)
// =============================================================================

export interface FiberState {
  currentRoot: Option.Option<Fiber>;
  wipRoot: Option.Option<Fiber>;
  nextUnitOfWork: Option.Option<Fiber>;
  deletions: Fiber[];
  renderQueue: Set<Fiber>;
  batchScheduled: boolean;
  listenerStore: WeakMap<HTMLElement, Record<string, EventListener>>;
}

export const makeFiberState = (): FiberState => ({
  currentRoot: Option.none(),
  wipRoot: Option.none(),
  nextUnitOfWork: Option.none(),
  deletions: [],
  renderQueue: new Set(),
  batchScheduled: false,
  listenerStore: new WeakMap(),
});

// =============================================================================
// Runtime Service
// =============================================================================

export const CustomAtomRegistryLayer = AtomRegistry.layerOptions({
  scheduleTask: (f: () => void) => f(),
});

export class FibraeRuntime extends Effect.Service<FibraeRuntime>()("FibraeRuntime", {
  scoped: Effect.gen(function* () {
    const registry = yield* AtomRegistry.AtomRegistry;
    const rootScope = yield* Scope.make();
    const runFork = yield* FiberSet.makeRuntime<AtomRegistry.AtomRegistry>();

    // Store the full context in a Ref so it can be updated after all layers are built
    // Initially empty - will be set by render() after user layers are applied
    const fullContextRef = yield* Ref.make<Context.Context<unknown>>(
      Context.empty() as Context.Context<unknown>,
    );

    // Each render tree gets its own fiber state
    const fiberState = yield* Ref.make(makeFiberState());

    const AtomOps = {
      get: <A>(atom: Atom.Atom<A>): A => registry.get(atom),
      set: <R, W>(atom: Atom.Writable<R, W>, value: W): void => registry.set(atom, value),
      update: <R, W>(atom: Atom.Writable<R, W>, f: (_: R) => W): void => registry.update(atom, f),
      modify: <R, W, A>(
        atom: Atom.Writable<R, W>,
        f: (_: R) => [returnValue: A, nextValue: W],
      ): A => registry.modify(atom, f),
      getResult: <A, E>(
        atom: Atom.Atom<Result.Result<A, E>>,
        options?: { readonly suspendOnWaiting?: boolean },
      ): Effect.Effect<A, E> =>
        RegistryModule.getResult(registry, atom, options),
      toStreamResult: <A, E>(
        atom: Atom.Atom<Result.Result<A, E>>,
      ): Stream.Stream<A, E> =>
        RegistryModule.toStreamResult(registry, atom),
      refresh: <A>(atom: Atom.Atom<A>): void =>
        registry.refresh(atom),
    };

    return {
      registry,
      rootScope,
      runFork,
      AtomOps,
      fiberState,
      fullContextRef,
    };
  }),
}) {
  static Live = FibraeRuntime.Default;

  /**
   * Layer that provides both FibraeRuntime AND AtomRegistry.
   * Use this when composing with user layers that need AtomRegistry access.
   */
  static LiveWithRegistry = Layer.provideMerge(FibraeRuntime.Default, CustomAtomRegistryLayer);
}

/**
 * Fork an effect with the full application context.
 *
 * The fullContextRef contains ALL services (FibraeRuntime, AtomRegistry, Navigator, etc.)
 * captured at render() time after all layers are built.
 *
 * IMPORTANT: fullContextRef must be set by render() before this is called.
 */
export const runForkWithRuntime =
  (runtime: FibraeRuntime) =>
  <A, E>(effect: Effect.Effect<A, E, unknown>) => {
    const withContext = Effect.gen(function* () {
      const fullContext = yield* Ref.get(runtime.fullContextRef);
      return yield* Effect.provide(effect, fullContext as Context.Context<never>);
    });
    return runtime.runFork(
      withContext as Effect.Effect<unknown, unknown, AtomRegistry.AtomRegistry>,
    );
  };
