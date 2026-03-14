/**
 * Fiber commit phase — DOM mutations.
 *
 * This module contains the commit phase of the fiber reconciler: creating and
 * updating real DOM nodes, processing deletions, and walking the fiber tree
 * to apply placement/update/deletion effect tags to the DOM.
 *
 * Extracted from fiber-render.ts.
 */

import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";
import * as Ref from "effect/Ref";
import * as Exit from "effect/Exit";
import * as Deferred from "effect/Deferred";

import type { Fiber } from "./shared.js";
import { isEvent, isProperty } from "./shared.js";
import { FibraeRuntime } from "./runtime.js";
import { setDomProperty, createEventWrapper } from "./dom.js";
import { findDomParent } from "./fiber-tree.js";
import { handleFiberError } from "./fiber-boundary.js";

// =============================================================================
// Create DOM
// =============================================================================

export const createDom = (fiber: Fiber, runtime: FibraeRuntime) =>
  Effect.gen(function* () {
    const dom = yield* Option.match(fiber.type, {
      onNone: () => Effect.die("createDom called with no type"),
      onSome: (type) => {
        if (typeof type !== "string") {
          return Effect.die("createDom called on function component");
        }
        const node: Node =
          type === "TEXT_ELEMENT" ? document.createTextNode("") : document.createElement(type);
        return Effect.succeed(node);
      },
    });

    yield* updateDom(dom, {}, fiber.props, fiber, runtime);

    // Handle ref
    const ref = fiber.props.ref;
    if (ref && typeof ref === "object" && "current" in ref) {
      (ref as { current: unknown }).current = dom;
    }

    return dom;
  });

// =============================================================================
// Update DOM
// =============================================================================

export const isNew =
  (prev: { [key: string]: unknown }, next: { [key: string]: unknown }) => (key: string) =>
    prev[key] !== next[key];

export const updateDom = (
  dom: Node,
  prevProps: { [key: string]: unknown },
  nextProps: { [key: string]: unknown },
  ownerFiber: Fiber,
  runtime: FibraeRuntime,
) =>
  Effect.gen(function* () {
    const stateRef = runtime.fiberState;
    const element = dom as HTMLElement | Text;

    if (element instanceof Text) {
      if (nextProps.nodeValue !== prevProps.nodeValue) {
        const value = nextProps.nodeValue;
        element.nodeValue =
          typeof value === "string" || typeof value === "number" ? String(value) : "";
      }
      return;
    }

    const stateSnapshot = yield* Ref.get(stateRef);
    const el = element;
    const stored = stateSnapshot.listenerStore.get(el) ?? {};

    // Remove old event listeners
    const eventsToRemove = Object.keys(prevProps)
      .filter(isEvent)
      .filter((key) => !(key in nextProps) || isNew(prevProps, nextProps)(key));

    eventsToRemove.forEach((name) => {
      const eventType = name.toLowerCase().substring(2);
      const wrapper = stored[eventType];
      if (wrapper) {
        el.removeEventListener(eventType, wrapper);
        delete stored[eventType];
      }
    });

    // Remove properties that were in prevProps but not in nextProps
    Object.keys(prevProps)
      .filter(isProperty)
      .filter((key) => !(key in nextProps))
      .forEach((name) => {
        if (el instanceof HTMLElement) {
          setDomProperty(el, name, null);
        }
      });

    // Handle dangerouslySetInnerHTML
    if (nextProps.dangerouslySetInnerHTML != null) {
      if (
        el instanceof HTMLElement &&
        nextProps.dangerouslySetInnerHTML !== prevProps.dangerouslySetInnerHTML
      ) {
        el.innerHTML = String(nextProps.dangerouslySetInnerHTML);
      }
    }

    // Update changed properties
    Object.keys(nextProps)
      .filter(isProperty)
      .filter(isNew(prevProps, nextProps))
      .forEach((name) => {
        if (el instanceof HTMLElement) {
          setDomProperty(el, name, nextProps[name]);
        }
      });

    // Add new event listeners
    Object.keys(nextProps)
      .filter(isEvent)
      .filter(isNew(prevProps, nextProps))
      .forEach((name) => {
        const eventType = name.toLowerCase().substring(2);
        const handler = nextProps[name] as (event: Event) => unknown;
        const wrapper = createEventWrapper(
          handler,
          eventType,
          runtime,
          ownerFiber ? (error) => handleFiberError(ownerFiber, error) : undefined,
        );

        const existing = stored[eventType];
        if (existing) {
          el.removeEventListener(eventType, existing);
        }
        el.addEventListener(eventType, wrapper);
        stored[eventType] = wrapper;
      });

    stateSnapshot.listenerStore.set(el, stored);
  });

// =============================================================================
// Commit Phase
// =============================================================================

export const deleteFiber = (fiber: Fiber): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    // Close component scope (unless fiber is parked - its scope must stay alive)
    if (!fiber.isParked && Option.isSome(fiber.componentScope)) {
      yield* Scope.close(fiber.componentScope.value, Exit.void);
    }

    // Recursively delete children
    if (Option.isSome(fiber.child)) {
      yield* deleteFiber(fiber.child.value);
    }
  });

export const commitDeletion = (fiber: Fiber, domParent: Node): Effect.Effect<void, never, never> =>
  Option.match(fiber.dom, {
    onSome: (dom) =>
      Effect.sync(() => {
        domParent.removeChild(dom);
      }),
    onNone: () =>
      // Function component - find DOM children
      Effect.iterate(fiber.child, {
        while: (opt): opt is Option.Some<Fiber> => Option.isSome(opt),
        body: (childOpt) =>
          Effect.gen(function* () {
            const child = childOpt.value;
            yield* commitDeletion(child, domParent);
            return child.sibling;
          }),
      }),
  });

export const commitRoot = (runtime: FibraeRuntime) =>
  Effect.gen(function* () {
    const stateRef = runtime.fiberState;
    const currentState = yield* Ref.get(stateRef);

    // Process deletions first
    yield* Effect.forEach(
      currentState.deletions,
      (fiber) =>
        Effect.gen(function* () {
          const domParent = findDomParent(fiber);
          if (Option.isSome(domParent)) {
            yield* commitDeletion(fiber, domParent.value);
          }
          yield* deleteFiber(fiber);
        }),
      { discard: true },
    );

    // Commit work starting from wipRoot.child
    const firstChild = currentState.wipRoot.pipe(
      Option.flatMap((root) => root.child),
      Option.getOrUndefined,
    );
    if (firstChild) {
      yield* commitWork(firstChild, runtime);
    }

    // Swap wipRoot to currentRoot
    yield* Ref.update(stateRef, (s) => ({
      ...s,
      currentRoot: currentState.wipRoot,
      wipRoot: Option.none(),
      deletions: [],
    }));
  });

export const commitWork = (
  fiber: Fiber,
  runtime: FibraeRuntime,
): Effect.Effect<void, never, FibraeRuntime> =>
  Effect.gen(function* () {
    // KEY INSIGHT: If fiber has no DOM (function component), just process children
    if (Option.isNone(fiber.dom)) {
      if (Option.isSome(fiber.child)) {
        yield* commitWork(fiber.child.value, runtime);
      }
      // Signal mounted after subtree commits (for function components)
      yield* Option.match(fiber.mountedDeferred, {
        onNone: () => Effect.void,
        onSome: (deferred) =>
          Effect.gen(function* () {
            const done = yield* Deferred.isDone(deferred);
            if (!done) {
              yield* Deferred.succeed(deferred, undefined);
            }
          }),
      });
      if (Option.isSome(fiber.sibling)) {
        yield* commitWork(fiber.sibling.value, runtime);
      }
      return;
    }

    // Find DOM parent by walking up to nearest fiber with dom
    const domParentOpt = findDomParent(fiber);
    if (Option.isNone(domParentOpt)) {
      // No DOM parent found - continue with children/siblings
      if (Option.isSome(fiber.child)) {
        yield* commitWork(fiber.child.value, runtime);
      }
      if (Option.isSome(fiber.sibling)) {
        yield* commitWork(fiber.sibling.value, runtime);
      }
      return;
    }
    const domParent = domParentOpt.value;

    // Process effect tag
    const tag = fiber.effectTag.pipe(Option.getOrUndefined);
    if (tag === "PLACEMENT") {
      // Append DOM node
      if (Option.isSome(fiber.dom)) {
        domParent.appendChild(fiber.dom.value);
      }

      // Signal first child committed (for Suspense)
      const deferred = fiber.parent.pipe(
        Option.flatMap((p) => p.childFirstCommitDeferred),
        Option.getOrUndefined,
      );
      if (deferred) {
        const done = yield* Deferred.isDone(deferred);
        if (!done) {
          yield* Deferred.succeed(deferred, undefined);
        }
      }
    } else if (tag === "UPDATE") {
      const prevProps = fiber.alternate.pipe(
        Option.map((alt) => alt.props),
        Option.getOrElse(() => ({})),
      );
      if (Option.isSome(fiber.dom)) {
        yield* updateDom(fiber.dom.value, prevProps, fiber.props, fiber, runtime);
      }
    } else if (tag === "DELETION") {
      yield* commitDeletion(fiber, domParent);
      return;
    }

    // Continue with children and siblings
    if (Option.isSome(fiber.child)) {
      yield* commitWork(fiber.child.value, runtime);
    }

    // After children are committed, apply deferred properties.
    // <select> value must be set after <option> children exist in the DOM.
    if (Option.isSome(fiber.dom)) {
      const node = fiber.dom.value;
      if (node instanceof HTMLSelectElement && "value" in fiber.props) {
        node.value = String(fiber.props.value);
      }
    }

    if (Option.isSome(fiber.sibling)) {
      yield* commitWork(fiber.sibling.value, runtime);
    }
  });
