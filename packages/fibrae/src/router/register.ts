/**
 * Module augmentation interface for type-safe navigation.
 *
 * Register your router in your app:
 *
 * ```typescript
 * declare module "fibrae/router" {
 *   interface RegisteredRouter {
 *     AppRouter: typeof AppRouter
 *   }
 * }
 * ```
 *
 * After registration, Link's `href` prop and go()'s href parameter
 * are constrained to valid paths at compile time.
 */

import type { Router } from "./Router.js";

// biome-ignore lint/suspicious/noEmptyInterface: intentionally empty for module augmentation
export interface RegisteredRouter {}

/**
 * Extract route paths from a Router type.
 */
type ExtractRoutePaths<T> = T extends Router<string, string, infer P extends string> ? P : never;

/**
 * Convert a route pattern to a template literal type for href validation.
 * "/posts/:id" → `/posts/${string}`
 * "/posts/:id/edit" → `/posts/${string}/edit`
 * "/posts" → "/posts"
 */
export type PatternToHref<T extends string> =
  T extends `${infer Before}:${infer _Param}/${infer After}`
    ? `${Before}${string}/${PatternToHref<After>}`
    : T extends `${infer Before}:${infer _Param}`
      ? `${Before}${string}`
      : T;

/**
 * Union of all valid href values, falling back to string when unregistered.
 * Route patterns are converted to template literal types so that
 * `<Link href={`/posts/${id}`}>` matches `/posts/${string}`.
 */
export type ValidHref = keyof RegisteredRouter extends never
  ? string
  : PatternToHref<ExtractRoutePaths<RegisteredRouter[keyof RegisteredRouter]>>;
