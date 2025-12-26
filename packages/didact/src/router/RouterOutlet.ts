/**
 * RouterOutlet - Reactive route rendering component.
 *
 * Subscribes to Navigator.currentRoute and renders the matched route's component.
 * When route changes, runs the new route's loader and renders the component.
 * 
 * For SSR hydration, the RouterStateAtom is pre-populated and the loader is skipped
 * on first render.
 *
 * Usage:
 * ```typescript
 * function App() {
 *   return (
 *     <div>
 *       <Nav />
 *       <RouterOutlet />
 *     </div>
 *   );
 * }
 * ```
 */

import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Option from "effect/Option";
import { Registry as AtomRegistry } from "@effect-atom/atom";
import { Navigator } from "./Navigator.js";
import { RouterHandlers } from "./RouterBuilder.js";
import { RouterStateAtom, type RouterState } from "./RouterState.js";
import type { VElement } from "../shared.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Props for RouterOutlet component.
 * 
 * @deprecated Props are no longer needed - SSR hydration is handled via RouterStateAtom.
 */
export interface RouterOutletProps {
  /**
   * @deprecated Use RouterStateAtom hydration instead.
   * Initial loader data from SSR - skips loader on first render.
   */
  readonly initialLoaderData?: unknown;
  
  /**
   * @deprecated Use RouterStateAtom hydration instead.
   * Initial route name from SSR - used with initialLoaderData.
   */
  readonly initialRouteName?: string;
}

// =============================================================================
// RouterOutlet Component
// =============================================================================

/**
 * RouterOutlet component for reactive route rendering.
 *
 * The RouterOutlet:
 * 1. Checks if RouterStateAtom has data (SSR hydration case)
 * 2. Subscribes to Navigator.currentRoute for navigation changes
 * 3. When route changes, runs the matched route's loader
 * 4. Updates RouterStateAtom with the full state (for DI access)
 * 5. Renders the route's component with loader data
 *
 * For SSR hydration, the RouterStateAtom is pre-populated by the server,
 * so the first render uses that data and skips the loader.
 */
export function RouterOutlet(
  _props: RouterOutletProps = {}
): Stream.Stream<VElement, unknown, Navigator | RouterHandlers | AtomRegistry.AtomRegistry> {
  // Track if this is the first render (for SSR hydration)
  let isFirstRender = true;

  return Stream.unwrap(
    Effect.gen(function* () {
      const navigator = yield* Navigator;
      const routerHandlers = yield* RouterHandlers;
      const registry = yield* AtomRegistry.AtomRegistry;

      // Check if we have hydrated state from SSR
      const hydratedState = registry.get(RouterStateAtom);
      
      // Create a stream from the currentRoute atom (navigation trigger)
      const routeStream = AtomRegistry.toStream(registry, navigator.currentRoute);

      // Map route changes to rendered VElements
      return Stream.mapEffect(routeStream, (currentRoute) =>
        Effect.gen(function* () {
          if (Option.isNone(currentRoute)) {
            // No route matched - clear router state and render 404
            registry.set(RouterStateAtom, Option.none());
            return {
              type: "div",
              props: {
                children: [
                  {
                    type: "TEXT_ELEMENT",
                    props: { nodeValue: "404 - Not Found", children: [] },
                  },
                ],
              },
            } as VElement;
          }

          const { routeName, params, searchParams } = currentRoute.value;

          // Get handler for this route
          const handler = routerHandlers.getHandler(routeName);
          if (Option.isNone(handler)) {
            registry.set(RouterStateAtom, Option.none());
            return {
              type: "div",
              props: {
                children: [
                  {
                    type: "TEXT_ELEMENT",
                    props: {
                      nodeValue: `No handler for route: ${routeName}`,
                      children: [],
                    },
                  },
                ],
              },
            } as VElement;
          }

          let loaderData: unknown;
          let routerState: RouterState;

          // Check if we should use hydrated SSR state
          const shouldUseHydratedState =
            isFirstRender &&
            Option.isSome(hydratedState) &&
            hydratedState.value.routeName === routeName;

          if (shouldUseHydratedState) {
            // Use SSR-hydrated state
            routerState = hydratedState.value;
            loaderData = routerState.loaderData;
          } else {
            // Run the loader
            const loaderCtx = { path: params, searchParams };
            loaderData = yield* handler.value.loader(loaderCtx);
            
            // Build the new router state
            routerState = {
              routeName,
              params,
              searchParams,
              loaderData,
            };
            
            // Update RouterStateAtom (for DI access by other components)
            registry.set(RouterStateAtom, Option.some(routerState));
          }

          // Mark first render complete
          isFirstRender = false;

          // Render the component with both props patterns:
          // 1. Traditional props (loaderData, path, searchParams)
          // 2. Components can also access via RouterStateAtom/RouterStateService
          const element = handler.value.component({
            loaderData,
            path: params,
            searchParams,
          });

          return element;
        })
      );
    })
  );
}
