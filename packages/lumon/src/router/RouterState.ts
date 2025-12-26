/**
 * RouterState - Unified serializable state for the router.
 *
 * Contains everything needed to render the current route:
 * - routeName: The matched route's name
 * - params: Decoded path parameters
 * - searchParams: Query string parameters
 * - loaderData: Data returned by the route's loader
 *
 * This atom is:
 * - Serializable for SSR hydration
 * - Updated on navigation
 * - Accessible via Effect DI
 */

import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { Atom, Registry as AtomRegistry } from "@effect-atom/atom";

// =============================================================================
// Types
// =============================================================================

/**
 * Complete router state including loader data.
 * This is what gets serialized for SSR and hydrated on client.
 */
export interface RouterState {
  readonly routeName: string;
  readonly params: Record<string, unknown>;
  readonly searchParams: Record<string, string>;
  readonly loaderData: unknown;
}

/**
 * Schema for RouterState - used for serialization.
 * 
 * Note: loaderData uses Schema.Unknown since the actual type
 * is inferred from the loader Effect return type.
 */
export const RouterStateSchema = Schema.Struct({
  routeName: Schema.String,
  params: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  searchParams: Schema.Record({ key: Schema.String, value: Schema.String }),
  loaderData: Schema.Unknown,
});

// =============================================================================
// Serializable Atom
// =============================================================================

/**
 * The router state atom - a serializable atom containing the full route state.
 * 
 * When None, no route is matched.
 * When Some, contains the matched route info and loader data.
 * 
 * This atom is automatically:
 * - Dehydrated during SSR (included in __LUMON_STATE__)
 * - Hydrated on client (restored from __LUMON_STATE__)
 */
export const RouterStateAtom = Atom.make<Option.Option<RouterState>>(
  Option.none()
).pipe(
  Atom.serializable({
    key: "@lumon/router/state",
    schema: Schema.Option(RouterStateSchema),
  })
);

// =============================================================================
// Service Tag
// =============================================================================

/**
 * Service tag for accessing router state via Effect DI.
 * 
 * Usage in components:
 * ```typescript
 * const Component = () => Effect.gen(function* () {
 *   const state = yield* RouterStateService;
 *   if (Option.isSome(state)) {
 *     const { loaderData, params } = state.value;
 *     // ...
 *   }
 * });
 * ```
 */
export class RouterStateService extends Context.Tag("@lumon/router/RouterStateService")<
  RouterStateService,
  {
    /**
     * Get the current router state.
     */
    readonly get: Effect.Effect<Option.Option<RouterState>, never, AtomRegistry.AtomRegistry>;
    
    /**
     * Set the router state (used internally by Navigator).
     */
    readonly set: (state: Option.Option<RouterState>) => Effect.Effect<void, never, AtomRegistry.AtomRegistry>;
    
    /**
     * The underlying atom (for reactive subscriptions).
     */
    readonly atom: Atom.Writable<Option.Option<RouterState>, Option.Option<RouterState>>;
  }
>() {}

// =============================================================================
// Convenience Accessors
// =============================================================================

/**
 * Get the current router state.
 */
export const getRouterState: Effect.Effect<
  Option.Option<RouterState>,
  never,
  RouterStateService | AtomRegistry.AtomRegistry
> = Effect.gen(function* () {
  const service = yield* RouterStateService;
  return yield* service.get;
});

/**
 * Get the current loader data (typed by the caller).
 * Returns None if no route is matched.
 */
export const getLoaderData = <T>(): Effect.Effect<
  Option.Option<T>,
  never,
  RouterStateService | AtomRegistry.AtomRegistry
> =>
  Effect.gen(function* () {
    const state = yield* getRouterState;
    return Option.map(state, (s) => s.loaderData as T);
  });

/**
 * Get the current route params.
 * Returns None if no route is matched.
 */
export const getRouteParams: Effect.Effect<
  Option.Option<Record<string, unknown>>,
  never,
  RouterStateService | AtomRegistry.AtomRegistry
> = Effect.gen(function* () {
  const state = yield* getRouterState;
  return Option.map(state, (s) => s.params);
});
