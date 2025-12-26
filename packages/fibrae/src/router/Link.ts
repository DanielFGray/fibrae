/**
 * Link component - declarative navigation.
 *
 * Renders an <a> element with correct href and handles click for SPA navigation.
 * - <Link to="routeName">text</Link>
 * - <Link to="routeName" params={{ id: 123 }}>text</Link>
 * - <Link to="routeName" search={{ sort: "date" }}>text</Link>
 * - <Link to="routeName" replace>text</Link>
 *
 * Design: href is pre-computed for SSR/accessibility. onClick prevents default
 * and uses Navigator for SPA navigation.
 */

import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Atom, Registry as AtomRegistry } from "@effect-atom/atom";
import { Navigator } from "./Navigator.js";
import type { Route } from "./Route.js";
import type { Router } from "./Router.js";
import type { VElement } from "../shared.js";
// Note: We don't use h() here because props.children is already normalized
// by the JSX runtime. Using h() would double-process the children.

// =============================================================================
// Types
// =============================================================================

/**
 * Props for the Link component.
 */
export interface LinkProps {
  /** Route name to navigate to */
  readonly to: string;
  /** Path parameters for the route */
  readonly params?: Record<string, unknown>;
  /** Search/query parameters */
  readonly search?: Record<string, unknown>;
  /** Use history.replace instead of push */
  readonly replace?: boolean;
  /** Additional CSS class names */
  readonly class?: string;
  /** Active class name (default: "active") */
  readonly activeClass?: string;
  /** Data attributes for testing */
  readonly "data-cy"?: string;
  /** Children to render inside the anchor (already normalized by JSX runtime) */
  readonly children?: ReadonlyArray<VElement>;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Find a route by name in the router.
 */
function findRouteByName(router: Router, name: string): Option.Option<Route> {
  for (const group of router.groups) {
    for (const route of group.routes) {
      if (route.name === name) {
        return Option.some(route);
      }
    }
  }
  return Option.none();
}

/**
 * Build search string from params object.
 */
function buildSearchString(params: Record<string, unknown>): string {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      searchParams.set(key, String(value));
    }
  }
  const str = searchParams.toString();
  return str ? `?${str}` : "";
}

/**
 * Build the href for a route with params.
 */
function buildHref(
  router: Router,
  routeName: string,
  params?: Record<string, unknown>,
  search?: Record<string, unknown>,
  basePath: string = ""
): string {
  const route = findRouteByName(router, routeName);
  if (Option.isNone(route)) {
    return "#";
  }

  const pathname = route.value.interpolate(params ?? {});
  const searchString = search ? buildSearchString(search) : "";
  return `${basePath}${pathname}${searchString}`;
}

// =============================================================================
// Link Component Factory
// =============================================================================

/**
 * Create a Link component bound to a router.
 *
 * The Link component must know which router to use for:
 * - Building hrefs from route names
 * - Checking active state
 *
 * Usage:
 * ```typescript
 * const Link = createLink(appRouter);
 * <Link to="posts" params={{ id: 123 }}>View Post</Link>
 * ```
 */
export function createLink(router: Router) {
  return function Link(props: LinkProps): Effect.Effect<VElement, never, Navigator | AtomRegistry.AtomRegistry> {
    return Effect.gen(function* () {
      const navigator = yield* Navigator;
      const currentRoute = yield* Atom.get(navigator.currentRoute);

      // Build href for SSR/accessibility (includes basePath)
      const href = buildHref(router, props.to, props.params, props.search, navigator.basePath);

      // Check if this link is active
      const isActive = Option.match(currentRoute, {
        onNone: () => false,
        onSome: (route) => {
          if (route.routeName !== props.to) {
            return false;
          }
          // If params provided, check they match
          if (props.params) {
            for (const [key, value] of Object.entries(props.params)) {
              if (route.params[key] !== value) {
                return false;
              }
            }
          }
          return true;
        },
      });

      // Build class string
      const activeClass = props.activeClass ?? "active";
      const classes = [props.class, isActive ? activeClass : null]
        .filter(Boolean)
        .join(" ");

      // Click handler - prevent default and use Navigator
      const handleClick = (e: MouseEvent) => {
        // Allow ctrl/cmd click for new tab
        if (e.ctrlKey || e.metaKey || e.shiftKey) {
          return;
        }

        e.preventDefault();
        return navigator.go(props.to, {
          path: props.params,
          searchParams: props.search,
          replace: props.replace,
        });
      };

      // Return VElement directly - children are already normalized by JSX runtime
      return {
        type: "a",
        props: {
          href,
          class: classes || undefined,
          "data-cy": props["data-cy"],
          onClick: handleClick,
          children: [...(props.children ?? [])],
        },
      };
    });
  };
}
