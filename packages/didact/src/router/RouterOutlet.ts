/**
 * RouterOutlet - Reactive route rendering component.
 *
 * Subscribes to Navigator.currentRoute and renders the matched route's component.
 * When route changes, runs the new route's loader and renders the component.
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
import type { VElement } from "../shared.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Props for RouterOutlet component.
 */
export interface RouterOutletProps {
  /**
   * Initial loader data from SSR - skips loader on first render.
   */
  readonly initialLoaderData?: unknown;
  
  /**
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
 * 1. Subscribes to Navigator.currentRoute
 * 2. When route changes, runs the matched route's loader
 * 3. Renders the route's component with loader data
 *
 * For SSR hydration, pass initialLoaderData to skip the first loader call.
 */
export function RouterOutlet(
  props: RouterOutletProps = {}
): Stream.Stream<VElement, unknown, Navigator | RouterHandlers | AtomRegistry.AtomRegistry> {
  // Track if this is the first render (for SSR hydration)
  // Using closure state since Stream.unwrap creates a new stream each subscription
  let isFirstRender = true;
  const { initialLoaderData, initialRouteName } = props;

  // Use Stream.unwrap to lift Effect<Stream> into Stream
  // Services are accessed inside, making the outer type just Stream<VElement>
  return Stream.unwrap(
    Effect.gen(function* () {
      const navigator = yield* Navigator;
      const routerHandlers = yield* RouterHandlers;
      const registry = yield* AtomRegistry.AtomRegistry;

      // Create a stream from the currentRoute atom
      const routeStream = AtomRegistry.toStream(registry, navigator.currentRoute);

      // Map route changes to rendered VElements
      return Stream.mapEffect(routeStream, (currentRoute) =>
        Effect.gen(function* () {
          if (Option.isNone(currentRoute)) {
            // No route matched - render nothing or 404
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

          // Determine if we should skip the loader (SSR hydration case)
          const shouldSkipLoader =
            isFirstRender &&
            initialLoaderData !== undefined &&
            initialRouteName === routeName;

          let loaderData: unknown;

          if (shouldSkipLoader) {
            // Use SSR data for first render
            loaderData = initialLoaderData;
          } else {
            // Run the loader
            const loaderCtx = { path: params, searchParams };
            loaderData = yield* handler.value.loader(loaderCtx);
          }

          // Mark first render complete
          isFirstRender = false;

          // Render the component
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
