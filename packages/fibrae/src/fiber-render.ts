/**
 * Fiber-based rendering — public API and orchestration.
 *
 * This module provides:
 * - `renderFiber` — mount a VElement tree to the DOM
 * - `hydrateFiber` — hydrate an existing SSR DOM tree
 * - `renderMailboxConsumer` — batched re-render work loop
 *
 * The actual reconciliation, commit, boundary, and tree logic
 * are split across fiber-tree, fiber-update, fiber-commit, and fiber-boundary.
 */

import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Ref from "effect/Ref";
import * as Option from "effect/Option";
import * as Deferred from "effect/Deferred";
import * as Context from "effect/Context";
import * as FiberRef from "effect/FiberRef";

import { Atom, Registry as AtomRegistry } from "@effect-atom/atom";
import {
  type VElement,
  type Fiber,
  type FiberRef as FiberRefType,
  ComponentScope,
  isStream,
} from "./shared.js";
import { FibraeRuntime } from "./runtime.js";
import { attachEventListeners } from "./dom.js";
import { normalizeToStream, makeTrackingRegistry } from "./tracking.js";
import { type LiveAtom } from "./live/atom.js";

import {
  createFiber,
  getComponentScopeService,
  linkFibersAsSiblings,
} from "./fiber-tree.js";
import { handleFiberError } from "./fiber-boundary.js";
import {
  performUnitOfWork,
  resubscribeFiber,
  subscribeComponentStream,
  subscribeFiberAtoms,
  activateLiveAtoms,
  reconcileChildren,
} from "./fiber-update.js";
import { commitRoot } from "./fiber-commit.js";

// =============================================================================
// Work Loop
// =============================================================================

const workLoop = (runtime: FibraeRuntime) =>
  Effect.gen(function* () {
    const stateRef = runtime.fiberState;

    // Process all units of work using Effect.iterate for interruptibility
    yield* Effect.iterate(yield* Ref.get(stateRef), {
      while: (state) => Option.isSome(state.nextUnitOfWork),
      body: (state) =>
        Effect.gen(function* () {
          const nextUnitOfWork = yield* performUnitOfWork(
            Option.getOrThrow(state.nextUnitOfWork),
            runtime,
          );
          yield* Ref.update(stateRef, (s) => ({ ...s, nextUnitOfWork }));
          return yield* Ref.get(stateRef);
        }),
    });

    // If we have a wipRoot but no more work, commit
    const finalState = yield* Ref.get(stateRef);
    if (Option.isNone(finalState.nextUnitOfWork) && Option.isSome(finalState.wipRoot)) {
      yield* commitRoot(runtime);
    }
  });

// =============================================================================
// Mailbox Consumer (batched re-render loop)
// =============================================================================

/**
 * Consumer loop that processes batched re-render requests from the Mailbox.
 *
 * Runs as a long-lived fiber: waits for items via takeAll, then reconciles
 * the full tree. Sequential processing guarantees no concurrent workLoops.
 */
const renderMailboxConsumer = (runtime: FibraeRuntime): Effect.Effect<void, never, FibraeRuntime> =>
  Effect.gen(function* () {
    const stateRef = runtime.fiberState;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      // takeAll suspends until items are available, then returns all queued items
      const [_fibers, done] = yield* runtime.renderMailbox.takeAll;
      if (done) break;

      const stateSnapshot = yield* Ref.get(stateRef);
      yield* Option.match(stateSnapshot.currentRoot, {
        onNone: () => Effect.void,
        onSome: (currentRoot) =>
          Effect.gen(function* () {
            yield* Ref.update(stateRef, (s) => ({
              ...s,
              wipRoot: Option.some(
                createFiber(
                  currentRoot.type,
                  currentRoot.props,
                  Option.none(),
                  Option.some(currentRoot),
                  Option.none(),
                ),
              ),
              deletions: [],
            }));

            // Copy dom from currentRoot to wipRoot
            const newState = yield* Ref.get(stateRef);
            newState.wipRoot.pipe(Option.map((wip) => { wip.dom = currentRoot.dom; }));

            yield* Ref.update(stateRef, (s) => ({
              ...s,
              nextUnitOfWork: s.wipRoot,
            }));

            yield* workLoop(runtime);
          }),
      });
    }
  });

// =============================================================================
// Main Render Function
// =============================================================================

/**
 * Render a VElement tree to a DOM container using fiber-based reconciliation.
 *
 * This implementation:
 * - Uses a fiber tree for efficient updates
 * - Supports key-based diffing
 * - Function components have no DOM wrapper - fixing SSR hydration
 *
 * @param element - VElement to render
 * @param container - DOM container to render into
 */
export const renderFiber = (element: VElement, container: HTMLElement) =>
  Effect.gen(function* () {
    const runtime = yield* FibraeRuntime;
    const stateRef = runtime.fiberState;
    const currentState = yield* Ref.get(stateRef);

    // Create root fiber with container as DOM
    const rootFiber = createFiber(
      Option.none(),
      { children: [element] },
      Option.none(),
      currentState.currentRoot,
      Option.none(),
    );
    rootFiber.dom = Option.some(container);

    yield* Ref.update(stateRef, (s) => ({
      ...s,
      wipRoot: Option.some(rootFiber),
      deletions: [],
    }));

    const newState = yield* Ref.get(stateRef);
    yield* Ref.update(stateRef, (s) => ({
      ...s,
      nextUnitOfWork: newState.wipRoot,
    }));

    yield* workLoop(runtime);

    // Process re-render requests from the Mailbox (runs forever)
    return yield* renderMailboxConsumer(runtime);
  });

// =============================================================================
// Hydration Support
// =============================================================================

// =============================================================================
// Hydration Helpers - Cursor-based DOM Walking (like React)
// =============================================================================

/**
 * Get the next hydratable node, skipping whitespace-only text nodes
 * and non-marker comments. Returns None if no more hydratable nodes.
 *
 * Hydratable nodes are:
 * - Element nodes (always)
 * - Text nodes with non-whitespace content
 * - Comment nodes that are Fibrae markers (fibrae:...)
 */
const getNextHydratable = (node: Node | null): Option.Option<Node> => {
  let current = node;
  while (current) {
    const nodeType = current.nodeType;

    // Element nodes are always hydratable
    if (nodeType === Node.ELEMENT_NODE) {
      return Option.some(current);
    }

    // Text nodes are hydratable if they have non-whitespace content
    if (nodeType === Node.TEXT_NODE) {
      const textContent = current.textContent;
      if (textContent !== null && textContent.trim() !== "") {
        return Option.some(current);
      }
      // Skip whitespace-only text nodes
    }

    // Comment nodes are hydratable if they're Fibrae markers
    if (nodeType === Node.COMMENT_NODE) {
      const data = (current as Comment).data;
      if (data.startsWith("fibrae:")) {
        return Option.some(current);
      }
      // Skip non-marker comments
    }

    current = current.nextSibling;
  }
  return Option.none();
};

const getFirstHydratableChild = (parent: Node): Option.Option<Node> => {
  return getNextHydratable(parent.firstChild);
};

const getNextHydratableSibling = (node: Node): Option.Option<Node> => {
  return getNextHydratable(node.nextSibling);
};

// =============================================================================
// Fiber Hydration - Cursor-based Implementation
// =============================================================================

/**
 * Hydrate an existing DOM tree by building a fiber tree that references
 * the existing DOM nodes. This enables event handlers and reactivity
 * without replacing the DOM.
 *
 * Uses cursor-based DOM walking (like React) to match VElement tree
 * against existing DOM, skipping whitespace-only text nodes and comments.
 */
export const hydrateFiber = (element: VElement, container: HTMLElement) =>
  Effect.gen(function* () {
    const runtime = yield* FibraeRuntime;
    const stateRef = runtime.fiberState;

    // Create root fiber with container as DOM
    const rootFiber = createFiber(
      Option.none(),
      { children: [element] },
      Option.none(),
      Option.none(),
      Option.none(),
    );
    rootFiber.dom = Option.some(container);

    // Build fiber tree by walking DOM and VElement together
    // Start with first hydratable child (skipping whitespace)
    const firstChild = getFirstHydratableChild(container);
    yield* hydrateChildren(rootFiber, [element], firstChild, runtime);

    yield* Ref.update(stateRef, (s) => ({
      ...s,
      currentRoot: Option.some(rootFiber),
      wipRoot: Option.none(),
      deletions: [],
    }));

    // Process re-render requests from the Mailbox (runs forever)
    return yield* renderMailboxConsumer(runtime);
  });

/**
 * Hydrate multiple vElements against DOM nodes using cursor-based walking.
 * Returns the next DOM cursor position after all children are hydrated.
 */
const hydrateChildren = (
  parentFiber: Fiber,
  vElements: VElement[],
  startCursor: Option.Option<Node>,
  runtime: FibraeRuntime,
): Effect.Effect<Option.Option<Node>, unknown, FibraeRuntime> =>
  Effect.gen(function* () {
    // Walk vElements and DOM cursor together using Effect.reduce
    const { fibers, cursor } = yield* Effect.reduce(
      vElements,
      { fibers: [] as Fiber[], cursor: startCursor },
      (acc, vElement) => {
        if (Option.isNone(acc.cursor)) return Effect.succeed(acc);
        return Effect.map(
          hydrateElement(parentFiber, vElement, acc.cursor.value, runtime),
          ({ fiber, nextCursor }) => ({
            fibers: [...acc.fibers, fiber],
            cursor: nextCursor,
          }),
        );
      },
    );

    linkFibersAsSiblings(fibers, parentFiber);

    return cursor;
  });

/**
 * Hydrate a single vElement against a DOM node.
 * Returns the created fiber and the next DOM cursor position.
 */
const hydrateElement = (
  parentFiber: Fiber,
  vElement: VElement,
  domNode: Node,
  runtime: FibraeRuntime,
): Effect.Effect<{ fiber: Fiber; nextCursor: Option.Option<Node> }, unknown, FibraeRuntime> =>
  Effect.gen(function* () {
    // Detect hydration mismatch: VElement type vs DOM node tag
    if (typeof vElement.type === "string" && vElement.type !== "TEXT_ELEMENT" && vElement.type !== "FRAGMENT" && vElement.type !== "SUSPENSE" && vElement.type !== "BOUNDARY") {
      if (domNode.nodeType === Node.ELEMENT_NODE) {
        const expected = vElement.type.toUpperCase();
        const actual = (domNode as Element).tagName;
        if (expected !== actual) {
          yield* Effect.logError(
            `Hydration mismatch: expected <${vElement.type}> but found <${actual.toLowerCase()}>. ` +
            `SSR and client component trees differ.`
          );
        }
      } else if (domNode.nodeType === Node.TEXT_NODE) {
        yield* Effect.logError(
          `Hydration mismatch: expected <${vElement.type}> but found text node "${domNode.textContent?.substring(0, 30)}". ` +
          `SSR and client component trees differ.`
        );
      }
    }
    const fiber = createFiber(
      Option.some(vElement.type),
      vElement.props,
      Option.some(parentFiber),
      Option.none(),
      Option.none(), // No effect tag - already in DOM
    );

    let nextCursor: Option.Option<Node>;

    if (typeof vElement.type === "function") {
      // Function component - invoke to get children
      nextCursor = yield* hydrateFunctionComponent(fiber, vElement, domNode, runtime);
    } else if (vElement.type === "TEXT_ELEMENT") {
      // Text node - adopt the DOM text node
      fiber.dom = Option.some(domNode);
      nextCursor = getNextHydratableSibling(domNode);
    } else if (vElement.type === "FRAGMENT") {
      // Fragment - children consume DOM nodes starting from current cursor
      nextCursor = yield* hydrateChildren(
        fiber,
        vElement.props.children || [],
        Option.some(domNode),
        runtime,
      );
    } else if (vElement.type === "SUSPENSE") {
      // Suspense boundary - DOM has comment markers from SSR
      // Initialize suspense config on the fiber
      const fallback = vElement.props.fallback as VElement;
      const threshold = (vElement.props.threshold as number) ?? 100;
      fiber.suspense = Option.some({
        fallback,
        threshold,
        showingFallback: false,
        parkedFiber: Option.none(),
        parkedComplete: Option.none(),
      });

      const children = (vElement.props.children || []) as VElement[];

      if (
        domNode.nodeType === Node.COMMENT_NODE &&
        (domNode as Comment).data.includes("fibrae:sus:resolved")
      ) {
        // Resolved: hydrate children against DOM nodes between markers
        // Use hydrateChildren for proper fiber linking, but skip comment markers
        const firstContentNode = getNextHydratableSibling(domNode);

        // hydrateChildren links fibers as siblings and sets fiber.child
        const afterChildren = yield* hydrateChildren(
          fiber,
          children,
          firstContentNode,
          runtime,
        );

        // Skip past closing marker
        if (Option.isSome(afterChildren)) {
          const maybeClosing = afterChildren.value;
          if (
            maybeClosing.nodeType === Node.COMMENT_NODE &&
            (maybeClosing as Comment).data.includes("/fibrae:sus")
          ) {
            nextCursor = getNextHydratableSibling(maybeClosing);
          } else {
            nextCursor = afterChildren;
          }
        } else {
          nextCursor = Option.none();
        }
      } else if (
        domNode.nodeType === Node.COMMENT_NODE &&
        (domNode as Comment).data.includes("fibrae:sus:fallback")
      ) {
        // Fallback: remove fallback DOM and render Suspense fresh
        const parent = domNode.parentNode as HTMLElement;

        // Collect nodes between markers using a scan loop
        const { nodesToRemove, closingMarker } = (() => {
          const nodes: Node[] = [domNode];
          let current: Node | null = domNode.nextSibling;
          while (current) {
            nodes.push(current);
            if (current.nodeType === Node.COMMENT_NODE && (current as Comment).data.includes("/fibrae:sus")) {
              return { nodesToRemove: nodes, closingMarker: current };
            }
            current = current.nextSibling;
          }
          return { nodesToRemove: nodes, closingMarker: null as Node | null };
        })();

        // Cursor after the closing marker
        nextCursor = closingMarker
          ? getNextHydratableSibling(closingMarker)
          : Option.none();

        // Remove fallback DOM
        nodesToRemove.forEach((node) => parent.removeChild(node));

        // Mark as showing fallback initially, then reconcile children
        // (the normal render path will handle the Suspense race)
        const suspenseConfig = Option.getOrThrow(fiber.suspense);
        suspenseConfig.showingFallback = false;
        yield* reconcileChildren(fiber, children);
      } else {
        // No Suspense markers — treat as normal render
        nextCursor = yield* hydrateChildren(
          fiber,
          children,
          Option.some(domNode),
          runtime,
        );
      }
    } else {
      // Host element - adopt DOM node and hydrate children
      const el = domNode as HTMLElement;
      fiber.dom = Option.some(el);

      // Inherit renderContext from parent fiber (function components capture it during render)
      if (Option.isNone(fiber.renderContext) && Option.isSome(fiber.parent)) {
        fiber.renderContext = fiber.parent.value.renderContext;
      }

      // Attach event listeners with listenerStore tracking for proper cleanup on re-render
      const stateSnapshot = yield* Ref.get(runtime.fiberState);
      attachEventListeners(
        el,
        vElement.props as Record<string, unknown>,
        runtime,
        (cause) => handleFiberError(fiber, cause),
        stateSnapshot.listenerStore,
      );

      // Handle ref
      const ref = vElement.props.ref;
      if (ref && typeof ref === "object" && "current" in ref) {
        (ref as { current: unknown }).current = el;
      }

      // Hydrate children using cursor-based walking
      const firstChildCursor = getFirstHydratableChild(el);
      yield* hydrateChildren(fiber, vElement.props.children || [], firstChildCursor, runtime);

      // Move to next sibling for the parent's cursor
      nextCursor = getNextHydratableSibling(domNode);
    }

    return { fiber, nextCursor };
  });

/**
 * Hydrate a function component by invoking it and hydrating its output.
 * Returns the next DOM cursor position.
 */
const hydrateFunctionComponent = (
  fiber: Fiber,
  vElement: VElement,
  domNode: Node,
  runtime: FibraeRuntime,
): Effect.Effect<Option.Option<Node>, unknown, FibraeRuntime> =>
  Effect.gen(function* () {
    // Capture current context during render phase for event handlers in commit phase
    const currentContext = yield* FiberRef.get(FiberRef.currentContext);
    fiber.renderContext = Option.some(currentContext);

    // Create scope for this component FIRST so it's available in context
    yield* resubscribeFiber(fiber);

    const componentScopeService = yield* getComponentScopeService(
      fiber,
      "Expected componentScope",
    );

    // Set up atom tracking
    const accessedAtoms = new Set<Atom.Atom<unknown>>();
    const accessedLiveAtoms = new Set<LiveAtom<any>>();
    const trackingRegistry = makeTrackingRegistry(runtime.registry, accessedAtoms, accessedLiveAtoms);
    fiber.accessedAtoms = Option.some(accessedAtoms);

    // Build context with tracking registry AND ComponentScope
    const contextWithTracking = Context.add(
      Context.add(currentContext, ComponentScope, componentScopeService),
      AtomRegistry.AtomRegistry,
      trackingRegistry,
    );

    // Invoke component
    const component = vElement.type as (
      props: unknown,
    ) => VElement | Effect.Effect<VElement> | Stream.Stream<VElement>;
    const output = yield* Effect.sync(() => component(vElement.props));

    fiber.isMultiEmissionStream = isStream(output);

    // Get first value from stream
    const stream = normalizeToStream(output).pipe(Stream.provideContext(contextWithTracking));

    // Set up fiber ref
    const fiberRef: FiberRefType = { current: fiber };
    fiber.fiberRef = Option.some(fiberRef);

    // Subscribe to component stream - errors typed via "fail" mode
    const firstValueDeferred = yield* subscribeComponentStream(
      stream,
      fiberRef,
      componentScopeService.scope,
    );

    // Wait for first value
    const childVElement = yield* Deferred.await(firstValueDeferred);
    fiber.latestStreamValue = Option.some(childVElement);

    // Hydrate the child VElement against DOM node
    // Function components render output directly to DOM (no wrapper)
    const nextCursor = yield* hydrateChildren(
      fiber,
      [childVElement],
      Option.some(domNode),
      runtime,
    );

    // Signal mounted after subtree hydrates
    yield* Deferred.succeed(componentScopeService.mounted, undefined);

    // Subscribe to atom changes
    yield* subscribeFiberAtoms(fiber, accessedAtoms, runtime);

    // Activate SSE connections for any live atoms
    if (accessedLiveAtoms.size > 0) {
      yield* activateLiveAtoms(
        accessedLiveAtoms,
        currentContext,
        runtime,
        componentScopeService.scope,
      );
    }

    return nextCursor;
  });
