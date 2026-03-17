/**
 * Component-scoped atom utilities.
 *
 * Thin wrappers that tie atom subscriptions to the component lifecycle
 * via ComponentScope, so cleanup happens automatically on unmount.
 */

import * as Effect from "effect/Effect";
import * as Scope from "effect/Scope";
import { Atom, Registry as AtomRegistry } from "@effect-atom/atom";
import { ComponentScope } from "./shared.js";

/**
 * Subscribe to an atom for the lifetime of the current component.
 * The subscription is cleaned up automatically when the component unmounts.
 *
 * @example
 * ```tsx
 * const Counter = () =>
 *   Effect.gen(function* () {
 *     yield* subscribeAtom(countAtom, (value) => {
 *       console.log("count changed:", value);
 *     });
 *     const count = yield* Atom.get(countAtom);
 *     return <div>Count: {count}</div>;
 *   });
 * ```
 */
export const subscribeAtom = <A>(
  atom: Atom.Atom<A>,
  callback: (value: A) => void,
): Effect.Effect<void, never, ComponentScope | AtomRegistry.AtomRegistry> =>
  Effect.gen(function* () {
    const { scope } = yield* ComponentScope;
    const registry = yield* AtomRegistry.AtomRegistry;
    const unsubscribe = registry.subscribe(atom, callback);
    yield* Scope.addFinalizer(scope, Effect.sync(unsubscribe));
  });

/**
 * Run an Effect after the component mounts, scoped to the component lifetime.
 * The forked fiber is interrupted when the component unmounts.
 *
 * Useful for imperative setup (DOM manipulation, external library init)
 * that needs to wait for the DOM to be ready.
 *
 * @example
 * ```tsx
 * const Editor = () =>
 *   Effect.gen(function* () {
 *     const ref = { current: null as HTMLDivElement | null };
 *
 *     yield* mountAtom(
 *       Effect.gen(function* () {
 *         const editor = monaco.create(ref.current!);
 *         yield* Effect.addFinalizer(() => Effect.sync(() => editor.dispose()));
 *       }),
 *     );
 *
 *     return <div ref={el => ref.current = el} />;
 *   });
 * ```
 */
export const mountAtom = <A, E>(
  effect: Effect.Effect<A, E, Scope.Scope>,
): Effect.Effect<void, never, ComponentScope> =>
  Effect.gen(function* () {
    const { scope, mounted } = yield* ComponentScope;
    yield* Effect.gen(function* () {
      yield* mounted;
      yield* effect;
    }).pipe(Effect.forkScoped, Scope.extend(scope));
  });
