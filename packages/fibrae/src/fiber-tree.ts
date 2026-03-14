/**
 * Fiber tree creation and traversal utilities.
 *
 * Pure functions for constructing fibers, checking fiber types, accessing
 * component scopes, and walking the fiber tree to find ancestors, siblings,
 * DOM parents, and boundary nodes. Extracted from fiber-render.ts.
 */

import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type {
  VElement,
  ElementType,
  Fiber,
} from "./shared.js";
import { FibraeRuntime } from "./runtime.js";

// =============================================================================
// Fiber Creation Helpers
// =============================================================================

export const createFiber = (
  type: Option.Option<ElementType>,
  props: { [key: string]: unknown; children?: VElement[] },
  parent: Option.Option<Fiber>,
  alternate: Option.Option<Fiber>,
  effectTag: Option.Option<"UPDATE" | "PLACEMENT" | "DELETION">,
): Fiber => ({
  type,
  props,
  dom: Option.none(),
  parent,
  child: Option.none(),
  sibling: Option.none(),
  alternate,
  effectTag,
  componentScope: Option.none(),
  mountedDeferred: Option.none(),
  accessedAtoms: Option.none(),
  latestStreamValue: Option.none(),
  childFirstCommitDeferred: Option.none(),
  fiberRef: Option.none(),
  isMultiEmissionStream: false,
  boundary: Option.none(),
  suspense: Option.none(),
  renderContext: Option.none(),
  isParked: false,
  isUnparking: false,
});

/**
 * Check if a fiber's type matches a specific element type string.
 */
export const fiberTypeIs = (fiber: Fiber, expected: string): boolean =>
  fiber.type.pipe(
    Option.map((t) => t === expected),
    Option.getOrElse(() => false),
  );

/**
 * Check if a fiber's type is a function (i.e., a function component).
 */
export const fiberTypeIsFunction = (fiber: Fiber): boolean =>
  fiber.type.pipe(
    Option.map((t) => typeof t === "function"),
    Option.getOrElse(() => false),
  );

/**
 * Check if a fiber is a virtual element (no DOM node created).
 * Returns true for root fiber (no type) or FRAGMENT type.
 */
export const fiberIsVirtualElement = (fiber: Fiber): boolean =>
  fiber.type.pipe(
    Option.map((t) => t === "FRAGMENT"),
    Option.getOrElse(() => true), // Root fiber has no type
  );

/**
 * Get a fiber's required componentScope or die with a message.
 */
export const getComponentScopeOrDie = (fiber: Fiber, msg: string) =>
  fiber.componentScope.pipe(
    Option.match({
      onNone: () => Effect.die(msg),
      onSome: Effect.succeed,
    }),
  );

/**
 * Get the full ComponentScope service value (scope + mounted) for a fiber.
 */
export const getComponentScopeService = (fiber: Fiber, msg: string) =>
  Effect.gen(function* () {
    const scope = yield* getComponentScopeOrDie(fiber, msg);
    const mounted = yield* fiber.mountedDeferred.pipe(
      Option.match({
        onNone: () => Effect.die(`${msg} (missing mountedDeferred)`),
        onSome: Effect.succeed,
      }),
    );
    return { scope, mounted };
  });

// =============================================================================
// Fiber Tree Walking Helpers
// =============================================================================

/**
 * Walk up the fiber tree from the starting fiber's parent, returning the first
 * ancestor that matches the predicate (excludes the starting fiber itself).
 */
export const findAncestorExcludingSelf = (
  fiber: Fiber,
  predicate: (f: Fiber) => boolean,
): Option.Option<Fiber> => {
  let current: Option.Option<Fiber> = fiber.parent;
  while (Option.isSome(current)) {
    if (predicate(current.value)) return current;
    current = current.value.parent;
  }
  return Option.none();
};

/**
 * Link an array of fibers as siblings under a parent fiber.
 * Sets parent.child to the first fiber and chains the rest via sibling pointers.
 */
export const linkFibersAsSiblings = (fibers: Fiber[], parent: Fiber): void => {
  if (fibers.length === 0) {
    parent.child = Option.none();
    return;
  }
  parent.child = Option.some(fibers[0]);
  for (let i = 1; i < fibers.length; i++) {
    fibers[i - 1].sibling = Option.some(fibers[i]);
  }
};

/**
 * Walk up the fiber tree from the given fiber to find the next sibling
 * (own sibling, or uncle, or great-uncle, etc.).
 */
export const findNextSibling = (fiber: Fiber): Option.Option<Fiber> => {
  let current: Option.Option<Fiber> = Option.some(fiber);
  while (Option.isSome(current)) {
    if (Option.isSome(current.value.sibling)) {
      return current.value.sibling;
    }
    current = current.value.parent;
  }
  return Option.none();
};

/**
 * Find the nearest ancestor with a DOM node (walks up from parent).
 */
export const findDomParent = (fiber: Fiber): Option.Option<Node> => {
  const ancestor = findAncestorExcludingSelf(fiber, (f) => Option.isSome(f.dom));
  return Option.flatMap(ancestor, (f) => f.dom);
};

// =============================================================================
// Error Boundary Support
// =============================================================================

/** Find nearest BOUNDARY by walking up the fiber tree */
export const findNearestBoundary = (fiber: Fiber): Option.Option<Fiber> =>
  findAncestorExcludingSelf(fiber, (f) => Option.isSome(f.boundary));

// =============================================================================
// Suspense Support
// =============================================================================

/**
 * Find the nearest Suspense boundary by walking up the fiber tree.
 */
export const findNearestSuspenseBoundary = (fiber: Fiber): Option.Option<Fiber> =>
  findAncestorExcludingSelf(fiber, (f) => Option.isSome(f.suspense));

/**
 * Get the threshold from the nearest Suspense boundary.
 * Returns 0 if no boundary (wait indefinitely).
 */
export const getSuspenseThreshold = (fiber: Fiber): number => {
  const boundary = findNearestSuspenseBoundary(fiber);
  return boundary.pipe(
    Option.flatMap((b) => b.suspense),
    Option.map((cfg) => cfg.threshold),
    Option.getOrElse(() => 0),
  );
};

// =============================================================================
// Queue Fiber for Re-render (Mailbox-based batched updates)
// =============================================================================

/**
 * Queue a fiber for re-render via the Mailbox.
 *
 * The Mailbox naturally batches: multiple synchronous offers accumulate
 * before the consumer fiber's takeAll runs, giving us the same coalescing
 * as the previous queueMicrotask + Set approach.
 */
export const queueFiberForRerender = (fiber: Fiber) =>
  Effect.gen(function* () {
    const runtime = yield* FibraeRuntime;
    yield* runtime.renderMailbox.offer(fiber);
  });
