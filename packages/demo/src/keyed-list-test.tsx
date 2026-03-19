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
import { render, Atom, AtomRegistry, createRef } from "fibrae";

// =============================================================================
// Expose ref test results to Cypress
// =============================================================================

declare global {
  interface Window {
    refTestResults: Record<string, unknown>;
  }
}
window.refTestResults = {};

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

// Ref test atoms
const showRefTargetAtom = Atom.make(true);
const refHopTargetAtom = Atom.make<"div1" | "div2">("div1");

/**
 * Seeded Fisher-Yates shuffle for deterministic test results.
 * Uses a simple LCG (linear congruential generator).
 */
const seededShuffle = <A,>(arr: ReadonlyArray<A>, seed: number): A[] => {
  const result = [...arr];
  let s = seed;
  const nextRand = () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(nextRand() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};

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

    const cycle = () =>
      Effect.sync(() =>
        registry.update(itemsAtom, (list: Item[]) => {
          if (list.length < 2) return list;
          const [first, ...rest] = list;
          return [...rest, first];
        }),
      );

    const cycleReverse = () =>
      Effect.sync(() =>
        registry.update(itemsAtom, (list: Item[]) => {
          if (list.length < 2) return list;
          const last = list[list.length - 1];
          return [last, ...list.slice(0, -1)];
        }),
      );

    const nullFirst = () =>
      Effect.sync(() => registry.update(itemsAtom, (list: Item[]) => list.slice(1)));

    const replaceAll = () =>
      Effect.sync(() => {
        const newItems: Item[] = [
          { id: nextId++, label: "Xray" },
          { id: nextId++, label: "Yankee" },
          { id: nextId++, label: "Zulu" },
        ];
        registry.set(itemsAtom, newItems);
      });

    const grow = () =>
      Effect.sync(() => {
        const newItems: Item[] = Array.from({ length: 4 }, () => {
          const id = nextId++;
          return { id, label: `Item-${id}` };
        });
        registry.update(itemsAtom, (list: Item[]) => [...list, ...newItems]);
      });

    const shuffle = () =>
      Effect.sync(() =>
        registry.update(itemsAtom, (list: Item[]) => seededShuffle(list, 42)),
      );

    const clearAll = () =>
      Effect.sync(() => registry.set(itemsAtom, []));

    const interleave = () =>
      Effect.sync(() => {
        registry.update(itemsAtom, (list: Item[]) => {
          const result: Item[] = [];
          for (const item of list) {
            result.push(item);
            const id = nextId++;
            result.push({ id, label: `New-${id}` });
          }
          return result;
        });
      });

    const removeMiddlePrepend = () =>
      Effect.sync(() => {
        registry.update(itemsAtom, (list: Item[]) => {
          // Remove Beta (id=2) if present, otherwise remove middle item
          const filtered = list.filter((item) => item.id !== 2);
          const id = nextId++;
          return [{ id, label: `Item-${id}` }, ...filtered];
        });
      });

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
          <button data-cy="btn-cycle" onClick={cycle}>
            Cycle
          </button>
          <button data-cy="btn-cycle-reverse" onClick={cycleReverse}>
            Cycle Reverse
          </button>
          <button data-cy="btn-null-first" onClick={nullFirst}>
            Null First
          </button>
          <button data-cy="btn-replace-all" onClick={replaceAll}>
            Replace All
          </button>
          <button data-cy="btn-grow" onClick={grow}>
            Grow
          </button>
          <button data-cy="btn-shuffle" onClick={shuffle}>
            Shuffle
          </button>
          <button data-cy="btn-clear-all" onClick={clearAll}>
            Clear All
          </button>
          <button data-cy="btn-interleave" onClick={interleave}>
            Interleave
          </button>
          <button data-cy="btn-remove-middle-prepend" onClick={removeMiddlePrepend}>
            Remove Mid + Prepend
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
// Ref Test Component
// =============================================================================

/** Function ref callback — logs calls to window.refTestResults during commit. */
const fnRefCallback = (el: HTMLElement | null) => {
  const log = (window.refTestResults.callbackLog ?? []) as Array<string>;
  log.push(el === null ? "fn-ref:null" : `fn-ref:${el.tagName}`);
  window.refTestResults.callbackLog = log;
};

/**
 * Object ref wrapper that writes to window.refTestResults when set.
 * This fires during commit (setRef), not after — so Cypress can read it.
 */
const makeTrackedRef = (key: string) => {
  const ref = { current: null as HTMLElement | null };
  return new Proxy(ref, {
    set(target, prop, value) {
      if (prop === "current") {
        target.current = value;
        window.refTestResults[`${key}Exists`] = value !== null;
        window.refTestResults[`${key}TagName`] = value?.tagName ?? null;
        if (value) {
          window.refTestResults[`${key}DataCy`] =
            value.getAttribute?.("data-cy") ?? null;
        }
      }
      return true;
    },
  });
};

/** Component that exercises object refs, function refs, and ref hopping. */
const RefTestComponent = () =>
  Effect.gen(function* () {
    const registry = yield* AtomRegistry.AtomRegistry;
    const showRef = yield* Atom.get(showRefTargetAtom);
    const hopTarget = yield* Atom.get(refHopTargetAtom);

    // Tracked object ref — writes to window.refTestResults via Proxy
    const objRef = makeTrackedRef("objRef");

    // Tracked hop ref
    const hopRef = makeTrackedRef("hopRef");

    const toggleRefTarget = () =>
      registry.update(showRefTargetAtom, (v: boolean) => !v);

    const toggleHopTarget = () =>
      registry.update(refHopTargetAtom, (v: "div1" | "div2") =>
        v === "div1" ? "div2" : "div1",
      );

    return (
      <div data-cy="ref-test" style="max-width: 600px; margin: 2rem auto; font-family: monospace;">
        <h2>Ref Behavior Tests</h2>
        <div style="display: flex; gap: 0.5rem; margin-bottom: 1rem;">
          <button data-cy="ref-toggle" onClick={toggleRefTarget}>
            Toggle Ref Target
          </button>
          <button data-cy="ref-hop-toggle" onClick={toggleHopTarget}>
            Hop Ref
          </button>
          <button
            data-cy="ref-reset"
            onClick={() => {
              window.refTestResults = {};
            }}
          >
            Reset Ref Log
          </button>
        </div>

        <div data-cy="ref-target-container">
          {showRef ? (
            <div data-cy="ref-target" ref={objRef}>
              Ref Target (object ref)
            </div>
          ) : (
            <div data-cy="ref-placeholder">No target</div>
          )}
        </div>

        <div data-cy="fn-ref-container">
          {showRef ? (
            <div data-cy="fn-ref-target" ref={fnRefCallback}>
              Ref Target (function ref)
            </div>
          ) : (
            <div data-cy="fn-ref-placeholder">No fn-ref target</div>
          )}
        </div>

        <div data-cy="ref-hop-container">
          {hopTarget === "div1" ? (
            <div data-cy="hop-div1" ref={hopRef}>
              Hop Target 1
            </div>
          ) : (
            <div data-cy="hop-div2" ref={hopRef}>
              Hop Target 2
            </div>
          )}
        </div>
      </div>
    );
  });

// =============================================================================
// Mount
// =============================================================================

Effect.gen(function* () {
  const root = pipe(document.getElementById("root"), Option.fromNullable, Option.getOrThrow);
  yield* render(
    <div>
      <KeyedListTest />
      <RefTestComponent />
    </div>,
    root,
  );
}).pipe(
  Effect.catchAllDefect((e) => Effect.flatMap(Effect.log(e), () => Effect.never)),
  Effect.provide(Logger.minimumLogLevel(LogLevel.Debug)),
  Effect.runFork,
);
