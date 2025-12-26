import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Sink from "effect/Sink";
import * as Scope from "effect/Scope";
import * as Exit from "effect/Exit";
import * as Ref from "effect/Ref";
import * as Option from "effect/Option";
import * as Context from "effect/Context";
import * as FiberRef from "effect/FiberRef";

import { Atom, Registry as AtomRegistry } from "@effect-atom/atom";
import { type VElement, type ElementType, type Primitive, HydrationMismatch } from "./shared.js";
import { DidactRuntime, runForkWithRuntime } from "./runtime.js";
import { attachEventListeners } from "./dom.js";
import { normalizeToStream, makeTrackingRegistry, subscribeToAtoms } from "./tracking.js";
import { clearContentScope, registerNodeCleanup } from "./scope-utils.js";
import { ErrorBoundaryChannel } from "./components.js";
import { renderVElementToDOM } from "./render.js";

// =============================================================================
// Type Guards
// =============================================================================

const isFunctionComponent = (type: ElementType): type is (props: Record<string, unknown>) => VElement | Effect.Effect<VElement> | Stream.Stream<VElement> =>
  typeof type === "function";

const isHostElement = (type: ElementType): type is Primitive =>
  typeof type === "string";

// =============================================================================
// Hydration Helpers
// =============================================================================

/**
 * Build a human-readable path for hydration error messages.
 * Example: "div > ul > li:2" means the 3rd li inside ul inside div
 */
const buildPath = (ancestors: Array<{ tag: string; index: number }>): string => {
  if (ancestors.length === 0) return "root";
  return ancestors
    .map(({ tag, index }) => (index > 0 ? `${tag}:${index}` : tag))
    .join(" > ");
};

// =============================================================================
// Hydration Implementation
// =============================================================================

/**
 * Hydrate a VElement tree by walking existing DOM nodes.
 * 
 * This function:
 * - Matches VElement tree to existing DOM nodes positionally
 * - Attaches event handlers to existing elements
 * - Sets up atom subscriptions for reactivity
 * - Throws HydrationMismatch on structural mismatches
 * - Tolerates text/attribute differences (DOM wins)
 * 
 * Uses cursor-based hydration: returns the next DOM sibling to process,
 * or None if no more siblings. This allows Suspense boundaries to
 * consume multiple DOM nodes (markers + content).
 * 
 * @param vElement - Virtual element to hydrate
 * @param domNode - Existing DOM node to hydrate against
 * @param runtime - Didact runtime instance
 * @param parentScope - Optional scope for registering cleanup
 * @param path - Ancestor path for error messages
 * @returns Option containing the next sibling node after what was consumed
 */
export const hydrateVElementToDOM = (
  vElement: VElement,
  domNode: Node,
  runtime: DidactRuntime,
  parentScope?: Scope.Scope.Closeable,
  path: Array<{ tag: string; index: number }> = []
): Effect.Effect<Option.Option<Node>, HydrationMismatch, never> =>
  Effect.gen(function*() {
    const type = vElement.type;

    if (isFunctionComponent(type)) {
      // Function component - during hydration, the component's output maps directly to domNode
      // (SSR doesn't create wrapper spans - it renders component output directly)

      // Component scope - for atom subscriptions and stream subscriptions
      const componentScope = yield* Scope.make();
      // Content scope ref - for rendered children
      const initialContentScope = yield* Scope.make();
      const contentScopeRef = yield* Ref.make(initialContentScope);

      const accessedAtoms = new Set<Atom.Atom<unknown>>();
      const trackingRegistry = makeTrackingRegistry(runtime.registry, accessedAtoms);

      // Capture current runtime context
      const currentContext = yield* FiberRef.get(FiberRef.currentContext) as Effect.Effect<Context.Context<unknown>, never, never>;
      const contextWithTracking = Context.add(currentContext, AtomRegistry.AtomRegistry, trackingRegistry);

      // Invoke component - catch sync errors and convert to HydrationMismatch
      const outputResult = yield* Effect.try({
        try: () => type(vElement.props),
        catch: (e) => new HydrationMismatch({
          expected: "component to render",
          actual: `error: ${String(e)}`,
          path: buildPath(path)
        })
      });

      // Normalize to stream and get first value
      const stream = normalizeToStream(outputResult).pipe(
        Stream.provideContext(contextWithTracking)
      );

      const peelResult = yield* Effect.either(
        Effect.gen(function*() {
          const [maybeFirst, remainingStream] = yield* Stream.peel(stream, Sink.head()).pipe(
            Effect.provideService(Scope.Scope, componentScope)
          );

          if (Option.isNone(maybeFirst)) {
            return { rendered: false as const };
          }

          // Hydrate the component's output DIRECTLY against domNode
          // (not against wrapper's children - SSR doesn't create wrapper spans)
          yield* hydrateVElementToDOM(maybeFirst.value, domNode, runtime, yield* Ref.get(contentScopeRef), path);

          // Register the hydrated DOM node for cleanup
          // When the content scope closes (on re-render), this node will be removed
          yield* registerNodeCleanup(domNode, yield* Ref.get(contentScopeRef));

          // Get parent for re-renders (we'll need to replace domNode on updates)
          const parent = domNode.parentNode as HTMLElement;

          // Subscribe to atom changes for reactivity
          if (accessedAtoms.size > 0) {
            yield* subscribeToAtoms(accessedAtoms, () => {
              runForkWithRuntime(runtime)(
                Effect.gen(function*() {
                  const newContentScope = yield* clearContentScope(contentScopeRef);

                  const newAccessedAtoms = new Set<Atom.Atom<unknown>>();
                  const newTrackingRegistry = makeTrackingRegistry(runtime.registry, newAccessedAtoms);
                  const newContextWithTracking = Context.add(currentContext, AtomRegistry.AtomRegistry, newTrackingRegistry);

                  const newOutput = yield* Effect.try({
                    try: () => (type as (props: Record<string, unknown>) => unknown)(vElement.props),
                    catch: (e) => e
                  });

                  const newStream = normalizeToStream(newOutput as VElement | Effect.Effect<VElement> | Stream.Stream<VElement>).pipe(
                    Stream.provideContext(newContextWithTracking)
                  );

                  // After first hydration, re-renders create new DOM
                  // We need to render into parent, clearing old content first
                  yield* Stream.runForEach(newStream, (reEmitted) =>
                    renderVElementToDOM(reEmitted, parent, runtime, newContentScope).pipe(
                      Effect.catchAll((e) => Effect.logError("Re-render child error", e))
                    )
                  );
                }).pipe(
                  Effect.catchAllCause((cause) => Effect.logError("Re-render error", cause))
                )
              );
            }, runtime, componentScope);
          }

          // Fork subscription for remaining emissions
          const maybeErrorChannel = Context.getOption(currentContext, ErrorBoundaryChannel);
          const streamErrorHandler = Option.match(maybeErrorChannel, {
            onNone: () => (cause: unknown) => Effect.logError("Component stream error (no boundary)", cause),
            onSome: (channel) => (cause: unknown) => channel.reportError(cause)
          });

          const subscription = Stream.runForEach(remainingStream, (emitted) =>
            Effect.gen(function*() {
              const newContentScope = yield* clearContentScope(contentScopeRef);
              yield* renderVElementToDOM(emitted, parent, runtime, newContentScope).pipe(
                Effect.catchAll((e) => Effect.logError("Stream emission render error", e))
              );
            })
          ).pipe(
            Effect.catchAllCause(streamErrorHandler)
          );

          yield* Effect.forkIn(subscription, componentScope);

          return { rendered: true as const };
        })
      );

      if (peelResult._tag === "Left") {
        const contentScope = yield* Ref.get(contentScopeRef);
        yield* Scope.close(contentScope, Exit.void);
        yield* Scope.close(componentScope, Exit.void);
        // Re-throw if it's already a HydrationMismatch
        if (peelResult.left instanceof HydrationMismatch) {
          return yield* Effect.fail(peelResult.left);
        }
        return yield* Effect.fail(new HydrationMismatch({
          expected: "component to render",
          actual: `error: ${String(peelResult.left)}`,
          path: buildPath(path)
        }));
      }

      // Function components: return next sibling after the node we hydrated
      return Option.fromNullable(domNode.nextSibling);

    } else if (type === "TEXT_ELEMENT") {
      // Text node - just verify it's a text node, don't update content (DOM wins)
      if (domNode.nodeType !== Node.TEXT_NODE) {
        return yield* Effect.fail(new HydrationMismatch({
          expected: "TEXT_NODE",
          actual: domNode.nodeName,
          path: buildPath(path)
        }));
      }
      // DOM text content wins - we don't update it
      // Skip past any text boundary marker (<!--didact:$-->) after text nodes
      let nextSibling = domNode.nextSibling;
      if (nextSibling?.nodeType === Node.COMMENT_NODE &&
        (nextSibling as Comment).data === "didact:$") {
        nextSibling = nextSibling.nextSibling;
      }
      return Option.fromNullable(nextSibling);

    } else if (type === "FRAGMENT") {
      // Fragment - hydrate children using cursor-based walking
      const children = vElement.props.children ?? [];
      const parent = domNode.parentNode;
      if (!parent) {
        return yield* Effect.fail(new HydrationMismatch({
          expected: "fragment parent",
          actual: "no parent node",
          path: buildPath(path)
        }));
      }

      // For fragments, hydrate starting from domNode's position using cursor
      const finalState = yield* Effect.iterate(
        { index: 0, cursor: Option.some(domNode) },
        {
          while: (state) => state.index < children.length && Option.isSome(state.cursor),
          body: (state) => Option.match(state.cursor, {
            onNone: () => Effect.fail(new HydrationMismatch({
              expected: `${children.length} children`,
              actual: `${state.index} children`,
              path: buildPath(path)
            })),
            onSome: (cursorNode) => Effect.gen(function*() {
              const nextCursor = yield* hydrateVElementToDOM(
                children[state.index],
                cursorNode,
                runtime,
                parentScope,
                [...path, { tag: "fragment", index: state.index }]
              );
              return { index: state.index + 1, cursor: nextCursor };
            })
          })
        }
      );

      return finalState.cursor;

    } else if (type === "ERROR_BOUNDARY") {
      // For error boundary during hydration, just hydrate children directly
      // The boundary behavior only matters for runtime errors, not initial hydration
      const children = vElement.props.children as VElement[];
      const wrapper = domNode as HTMLElement;

      // Use cursor-based hydration for children
      yield* Effect.iterate(
        { index: 0, cursor: Option.fromNullable(wrapper.firstChild as Node) },
        {
          while: (state) => state.index < children.length && Option.isSome(state.cursor),
          body: (state) => Option.match(state.cursor, {
            onNone: () => Effect.succeed({ index: state.index, cursor: Option.none<Node>() }),
            onSome: (cursorNode) => Effect.gen(function*() {
              const nextCursor = yield* hydrateVElementToDOM(
                children[state.index],
                cursorNode,
                runtime,
                parentScope,
                [...path, { tag: "error_boundary", index: state.index }]
              );
              return { index: state.index + 1, cursor: nextCursor };
            })
          })
        }
      );

      return Option.fromNullable(domNode.nextSibling);

    } else if (type === "SUSPENSE") {
      // Suspense during hydration: domNode should be the opening comment marker
      // Phase 4: Handle <!--didact:sus:resolved--> ... <!--/didact:sus-->
      // Phase 5: Will handle <!--didact:sus:fallback--> case

      const children = vElement.props.children as VElement[];

      // Check if we're at an opening marker
      if (domNode.nodeType === Node.COMMENT_NODE &&
        (domNode as Comment).data.includes("didact:sus:resolved")) {

        // Use Effect.iterate to hydrate children, walking from first content node
        // until we hit the closing marker
        const finalState = yield* Effect.iterate(
          { index: 0, cursor: Option.fromNullable(domNode.nextSibling as Node) },
          {
            while: (state) => {
              if (state.index >= children.length) return false;
              return Option.match(state.cursor, {
                onNone: () => false,
                onSome: (node) => {
                  // Stop if we hit closing marker
                  if (node.nodeType === Node.COMMENT_NODE &&
                    (node as Comment).data.includes("/didact:sus")) {
                    return false;
                  }
                  return true;
                }
              });
            },
            body: (state) => Option.match(state.cursor, {
              onNone: () => Effect.succeed({ index: state.index, cursor: Option.none<Node>() }),
              onSome: (cursorNode) => Effect.gen(function*() {
                const nextCursor = yield* hydrateVElementToDOM(
                  children[state.index],
                  cursorNode,
                  runtime,
                  parentScope,
                  [...path, { tag: "suspense", index: state.index }]
                );
                return { index: state.index + 1, cursor: nextCursor };
              })
            })
          }
        );

        // Skip past the closing marker to return the next sibling
        return Option.match(finalState.cursor, {
          onNone: () => Option.none<Node>(),
          onSome: (maybeClosingMarker) => {
            if (maybeClosingMarker.nodeType === Node.COMMENT_NODE &&
              (maybeClosingMarker as Comment).data.includes("/didact:sus")) {
              return Option.fromNullable(maybeClosingMarker.nextSibling);
            }
            return Option.some(maybeClosingMarker);
          }
        });

      } else if (domNode.nodeType === Node.COMMENT_NODE &&
        (domNode as Comment).data.includes("didact:sus:fallback")) {
        // Phase 5: SSR rendered fallback - we need to switch to render mode
        // The actual content was never rendered on server, so we need to:
        // 1. Find all nodes in the fallback boundary
        // 2. Remove them from DOM
        // 3. Render the Suspense fresh (which will handle the stream/async content)

        const parent = domNode.parentNode as HTMLElement;
        if (!parent) {
          return yield* Effect.fail(new HydrationMismatch({
            expected: "parent node for Suspense fallback",
            actual: "no parent",
            path: buildPath(path)
          }));
        }

        // Collect all nodes in the fallback boundary using Effect.iterate
        // State: { nodes: collected nodes, cursor: current node, done: found closing marker }
        const collectResult = yield* Effect.iterate(
          {
            nodes: [domNode] as Node[],
            cursor: Option.fromNullable(domNode.nextSibling),
            closingMarker: Option.none<Node>()
          },
          {
            while: (state) => Option.isSome(state.cursor) && Option.isNone(state.closingMarker),
            body: (state) => Effect.sync(() => {
              const current = Option.getOrThrow(state.cursor);
              const isClosingMarker = current.nodeType === Node.COMMENT_NODE &&
                (current as Comment).data.includes("/didact:sus");
              return {
                nodes: [...state.nodes, current],
                cursor: Option.fromNullable(current.nextSibling),
                closingMarker: isClosingMarker ? Option.some(current) : Option.none()
              };
            })
          }
        );

        // Get the next sibling after the closing marker (our return cursor)
        const nextSibling = Option.flatMap(collectResult.closingMarker, (marker) =>
          Option.fromNullable(marker.nextSibling)
        );

        // Remove fallback nodes from DOM
        yield* Effect.sync(() => {
          for (const node of collectResult.nodes) {
            parent.removeChild(node);
          }
        });

        // Render the Suspense fresh - this will invoke the stream-returning component,
        // handle the timeout/race logic, and properly render children
        // Insert before nextSibling if it exists, otherwise append
        const suspenseScope = yield* Scope.make();
        const renderEffect = Option.match(nextSibling, {
          onNone: () => renderVElementToDOM(vElement, parent, runtime, suspenseScope),
          onSome: (sibling) => Effect.gen(function*() {
            // Create a temporary container, render into it, then insert before sibling
            const tempContainer = document.createElement("span");
            tempContainer.style.display = "contents";
            parent.insertBefore(tempContainer, sibling);
            yield* renderVElementToDOM(vElement, tempContainer, runtime, suspenseScope);
          })
        });

        // Catch render errors and convert to HydrationMismatch
        yield* renderEffect.pipe(
          Effect.catchAll((e) => Effect.fail(new HydrationMismatch({
            expected: "Suspense to render successfully",
            actual: `render error: ${String(e)}`,
            path: buildPath(path)
          })))
        );

        // Return cursor after where the boundary was
        return nextSibling;

      } else {
        // No Suspense markers found - this means SSR output doesn't match expected format
        return yield* Effect.fail(new HydrationMismatch({
          expected: "Suspense comment marker (<!--didact:sus:resolved--> or <!--didact:sus:fallback-->)",
          actual: domNode.nodeType === Node.COMMENT_NODE
            ? `comment: ${(domNode as Comment).data}`
            : domNode.nodeName,
          path: buildPath(path)
        }));
      }

    } else if (isHostElement(type)) {
      // Host element - verify tag matches and hydrate
      const el = domNode as HTMLElement;

      // Validate tag name matches
      if (el.nodeName.toLowerCase() !== type.toLowerCase()) {
        return yield* Effect.fail(new HydrationMismatch({
          expected: type,
          actual: el.nodeName.toLowerCase(),
          path: buildPath(path)
        }));
      }

      // Attach event listeners - uses runForkWithRuntime internally for full context
      attachEventListeners(el, vElement.props as Record<string, unknown>, runtime);

      // Handle ref
      const ref = vElement.props.ref;
      if (ref && typeof ref === "object" && "current" in ref) {
        (ref as { current: unknown }).current = el;
      }

      // Hydrate children using cursor-based iteration
      const vChildren = vElement.props.children ?? [];
      const childScope = yield* Scope.make();

      yield* Effect.iterate(
        { index: 0, cursor: Option.fromNullable(el.firstChild as Node) },
        {
          while: (state) => state.index < vChildren.length,
          body: (state) => Option.match(state.cursor, {
            onNone: () => Effect.fail(new HydrationMismatch({
              expected: `child at index ${state.index}`,
              actual: "no more DOM nodes",
              path: buildPath([...path, { tag: type, index: state.index }])
            })),
            onSome: (cursorNode) => Effect.gen(function*() {
              const nextCursor = yield* hydrateVElementToDOM(
                vChildren[state.index],
                cursorNode,
                runtime,
                childScope,
                [...path, { tag: type, index: state.index }]
              );
              return { index: state.index + 1, cursor: nextCursor };
            })
          })
        }
      );

      return Option.fromNullable(domNode.nextSibling);
    }

    // Fallback for unknown types
    return Option.fromNullable(domNode.nextSibling);
  });
