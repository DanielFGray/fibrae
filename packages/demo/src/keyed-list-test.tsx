/**
 * Keyed list reconciliation test page.
 *
 * Exercises keyed DOM reordering, insertion, removal, and state preservation.
 * Each item has an input field whose value is preserved across reorders
 * (proving DOM identity is maintained, not just props swapped).
 */

import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Logger from "effect/Logger";
import * as LogLevel from "effect/LogLevel";
import { pipe } from "effect/Function";
import { render, Atom, AtomRegistry } from "fibrae";

// =============================================================================
// State
// =============================================================================

interface Item {
  readonly id: number;
  readonly label: string;
}

let nextId = 4;
const itemsAtom = Atom.make<Item[]>([
  { id: 1, label: "Alpha" },
  { id: 2, label: "Beta" },
  { id: 3, label: "Gamma" },
]);

// =============================================================================
// Components
// =============================================================================

/** Single list item — has an input field to prove DOM identity is preserved. */
const ListItem = ({ item }: { item: Item }) =>
  Effect.gen(function* () {
    yield* Effect.void;

    return (
      <li
        data-cy="list-item"
        data-item-id={item.id}
        style="display: flex; gap: 0.5rem; align-items: center; padding: 0.5rem 0; border-bottom: 1px solid #333;"
      >
        <span data-cy="item-label" style="min-width: 80px; font-weight: bold;">
          {item.label}
        </span>
        <input
          data-cy="item-input"
          type="text"
          placeholder={`Type in ${item.label}...`}
          style="flex: 1; padding: 0.25rem;"
        />
        <span data-cy="item-id" style="color: #666; font-size: 0.8em;">
          id={item.id}
        </span>
      </li>
    );
  });

/** Main keyed list test component. */
const KeyedListTest = () =>
  Effect.gen(function* () {
    const registry = yield* AtomRegistry.AtomRegistry;
    const items = yield* Atom.get(itemsAtom);

    const reverse = () =>
      Effect.sync(() => registry.update(itemsAtom, (list: Item[]) => list.toReversed()));

    const moveFirstToEnd = () =>
      Effect.sync(() =>
        registry.update(itemsAtom, (list: Item[]) => {
          if (list.length < 2) return list;
          const [first, ...rest] = list;
          return [...rest, first];
        }),
      );

    const moveLastToStart = () =>
      Effect.sync(() =>
        registry.update(itemsAtom, (list: Item[]) => {
          if (list.length < 2) return list;
          const last = list[list.length - 1];
          return [last, ...list.slice(0, -1)];
        }),
      );

    const removeFirst = () =>
      Effect.sync(() => registry.update(itemsAtom, (list: Item[]) => list.slice(1)));

    const removeMiddle = () =>
      Effect.sync(() =>
        registry.update(itemsAtom, (list: Item[]) => {
          if (list.length < 3) return list;
          const mid = Math.floor(list.length / 2);
          return [...list.slice(0, mid), ...list.slice(mid + 1)];
        }),
      );

    const removeLast = () =>
      Effect.sync(() => registry.update(itemsAtom, (list: Item[]) => list.slice(0, -1)));

    const prepend = () =>
      Effect.sync(() => {
        const id = nextId++;
        registry.update(itemsAtom, (list: Item[]) => [{ id, label: `Item-${id}` }, ...list]);
      });

    const append = () =>
      Effect.sync(() => {
        const id = nextId++;
        registry.update(itemsAtom, (list: Item[]) => [...list, { id, label: `Item-${id}` }]);
      });

    const insertMiddle = () =>
      Effect.sync(() => {
        const id = nextId++;
        registry.update(itemsAtom, (list: Item[]) => {
          const mid = Math.floor(list.length / 2);
          return [...list.slice(0, mid), { id, label: `Item-${id}` }, ...list.slice(mid)];
        });
      });

    const swap12 = () =>
      Effect.sync(() =>
        registry.update(itemsAtom, (list: Item[]) => {
          if (list.length < 2) return list;
          const copy = [...list];
          [copy[0], copy[1]] = [copy[1], copy[0]];
          return copy;
        }),
      );

    const reset = () =>
      Effect.sync(() => {
        nextId = 4;
        registry.set(itemsAtom, [
          { id: 1, label: "Alpha" },
          { id: 2, label: "Beta" },
          { id: 3, label: "Gamma" },
        ]);
      });

    return (
      <div style="max-width: 600px; margin: 2rem auto; font-family: monospace;">
        <h2>Keyed List Reconciliation Test</h2>

        <div
          data-cy="controls"
          style="display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 1rem;"
        >
          <button data-cy="btn-reverse" onClick={reverse}>
            Reverse
          </button>
          <button data-cy="btn-first-to-end" onClick={moveFirstToEnd}>
            First → End
          </button>
          <button data-cy="btn-last-to-start" onClick={moveLastToStart}>
            Last → Start
          </button>
          <button data-cy="btn-swap-12" onClick={swap12}>
            Swap 1↔2
          </button>
          <button data-cy="btn-prepend" onClick={prepend}>
            Prepend
          </button>
          <button data-cy="btn-append" onClick={append}>
            Append
          </button>
          <button data-cy="btn-insert-middle" onClick={insertMiddle}>
            Insert Middle
          </button>
          <button data-cy="btn-remove-first" onClick={removeFirst}>
            Remove First
          </button>
          <button data-cy="btn-remove-middle" onClick={removeMiddle}>
            Remove Middle
          </button>
          <button data-cy="btn-remove-last" onClick={removeLast}>
            Remove Last
          </button>
          <button data-cy="btn-reset" onClick={reset}>
            Reset
          </button>
        </div>

        <div data-cy="item-count" style="margin-bottom: 0.5rem; color: #999;">
          Items: {items.length}
        </div>

        <ul data-cy="list-container" style="list-style: none; padding: 0; margin: 0;">
          {items.map((item) => (
            <ListItem key={item.id} item={item} />
          ))}
        </ul>
      </div>
    );
  });

// =============================================================================
// Mount
// =============================================================================

Effect.gen(function* () {
  const root = pipe(document.getElementById("root"), Option.fromNullable, Option.getOrThrow);
  yield* render(<KeyedListTest />, root);
}).pipe(
  Effect.catchAllDefect((e) => Effect.flatMap(Effect.log(e), () => Effect.never)),
  Effect.provide(Logger.minimumLogLevel(LogLevel.Debug)),
  Effect.runFork,
);
