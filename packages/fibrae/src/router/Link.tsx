/**
 * Link component - declarative navigation.
 *
 * Renders an <a> element with the correct href and handles click for SPA navigation.
 * - <Link href="/posts">text</Link>
 * - <Link href={`/posts/${id}`}>text</Link>
 * - <Link href="/search" search={{ q: "effect" }}>text</Link>
 * - <Link href="/posts" replace>text</Link>
 *
 * Design: href is passed through directly (works with SSR). onClick prevents
 * default and uses Navigator for SPA navigation.
 */

// eslint-disable-next-line no-unused-vars -- jsx is used by the JSX transform (jsxFactory)
import { jsx } from "../jsx-runtime/index.js";
import * as Effect from "effect/Effect";
import { Registry as AtomRegistry } from "@effect-atom/atom";
import { Navigator } from "./Navigator.js";
import type { VElement, VChild } from "../shared.js";
import { buildSearchString } from "./utils.js";
import type { ValidHref } from "./register.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Props for the Link component.
 * `href` is validated against registered route paths via RegisteredRouter.
 */
/** Props handled by Link — omitted from the passthrough anchor attributes. */
type LinkOwnProps = {
  /** Path to navigate to — validated against registered route patterns */
  readonly href: ValidHref;
  /** Search/query parameters */
  readonly search?: Record<string, unknown>;
  /** Use history.replace instead of push */
  readonly replace?: boolean;
  /** Enable View Transitions API for this navigation (CSS-driven animations) */
  readonly viewTransition?: boolean;
  /** Active class name (default: "active") */
  readonly activeClass?: string;
  /** Children to render inside the anchor (already normalized by JSX runtime) */
  readonly children?: VChild;
};

/** Anchor attributes that Link doesn't override — class, data-*, aria-*, etc. */
type AnchorPassthroughProps = Omit<JSX.IntrinsicElements["a"], "href" | "onClick" | "children">;

export type LinkProps = LinkOwnProps & AnchorPassthroughProps;

// =============================================================================
// Link Component
// =============================================================================

/**
 * Link component — declarative, type-safe navigation with real paths.
 *
 * ```tsx
 * import { Link } from "fibrae/router";
 * <Link href="/posts">Posts</Link>
 * <Link href={`/posts/${id}`}>View Post</Link>
 * // <Link href="/typo" /> — compile-time error (with RegisteredRouter)
 * ```
 */
export function Link(
  props: LinkProps,
): Effect.Effect<VElement, never, Navigator | AtomRegistry.AtomRegistry> {
  return Effect.gen(function* () {
    const navigator = yield* Navigator;

    // Build full href with basePath and search params
    const searchString = props.search ? buildSearchString(props.search) : "";
    const fullHref = `${navigator.basePath}${props.href}${searchString}`;

    // Active state: currentPathname is already basePath-stripped by Navigator
    const isActive = navigator.currentPathname === props.href;

    // Build class string
    const activeClass = props.activeClass ?? "active";
    const classes = [props.class, isActive ? activeClass : null].filter(Boolean).join(" ");

    // Extract user-provided click handler (lowercase or camelCase)
    const userOnClick =
      (props as Record<string, unknown>).onclick ?? (props as Record<string, unknown>).onClick;

    // Click handler - prevent default and use Navigator for SPA navigation
    const handleClick = (e: MouseEvent) => {
      // Only intercept left clicks without modifier keys
      if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) {
        return;
      }
      e.preventDefault();
      // Call user's onclick handler if provided
      if (typeof userOnClick === "function") {
        userOnClick(e);
      }
      return navigator.go(props.href, {
        search: props.search,
        replace: props.replace,
        viewTransition: props.viewTransition,
      });
    };

    const normalizedChildren = props.children
      ? Array.isArray(props.children)
        ? props.children
        : [props.children]
      : [];

    // Separate Link-specific props from HTML anchor attributes
    const {
      href: _href,
      search: _search,
      replace: _replace,
      viewTransition: _viewTransition,
      activeClass: _activeClass,
      class: _className,
      children: _children,
      onclick: _onclick,
      onClick: _onClick,
      ...anchorProps
    } = props as LinkProps & { onclick?: unknown; onClick?: unknown };

    return (
      <a {...anchorProps} href={fullHref} class={classes || undefined} onClick={handleClick}>
        {normalizedChildren}
      </a>
    );
  });
}
