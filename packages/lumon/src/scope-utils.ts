import * as Effect from "effect/Effect";
import * as Scope from "effect/Scope";
import * as Exit from "effect/Exit";
import * as Ref from "effect/Ref";

// =============================================================================
// Scope Utilities
// =============================================================================

/**
 * Clear content by closing the current scope in the Ref and creating a fresh one.
 * This triggers finalizers that remove DOM nodes and cancel subscriptions.
 * Returns the new scope for convenience.
 */
export const clearContentScope = (
  contentScopeRef: Ref.Ref<Scope.Scope.Closeable>
): Effect.Effect<Scope.Scope.Closeable, never, never> =>
  Effect.gen(function*() {
    const oldScope = yield* Ref.get(contentScopeRef);
    yield* Scope.close(oldScope, Exit.void);
    const newScope = yield* Scope.make();
    yield* Ref.set(contentScopeRef, newScope);
    return newScope;
  });

/**
 * Register a DOM node for cleanup when scope closes.
 * Removes the node from its parent when the scope is closed.
 */
export const registerNodeCleanup = (
  node: Node,
  scope: Scope.Scope.Closeable
): Effect.Effect<void, never, never> =>
  Scope.addFinalizer(scope, Effect.sync(() => {
    if (node.parentNode) {
      node.parentNode.removeChild(node);
    }
  }));
