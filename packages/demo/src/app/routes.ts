/**
 * App Router - route definitions for the Notes demo app.
 *
 * Pattern follows fibrae router conventions:
 * - Route.get(name, path) for static routes
 * - Route.get(name, path, { params }) for dynamic routes
 * - Router.group(name) to group routes
 * - Router.make(name).add(group) to create router
 */

import * as Schema from "effect/Schema";
import { Route, Router, RouterOutlet, Link } from "fibrae/router";

// =============================================================================
// Route Definitions
// =============================================================================

/**
 * App routes:
 * - home: / - Landing page
 * - posts: /posts - List all posts
 * - postNew: /posts/new - Create new post form
 * - postEdit: /posts/:id/edit - Edit post form
 * - post: /posts/:id - Single post detail
 */
export const AppRoutes = Router.group("app")
  .add(Route.get("home", "/"))
  .add(Route.get("posts", "/posts"))
  .add(Route.get("postNew", "/posts/new"))
  .add(Route.get("postEdit", "/posts/:id/edit", { id: Schema.NumberFromString }))
  .add(Route.get("post", "/posts/:id", { id: Schema.NumberFromString }));

// =============================================================================
// Router
// =============================================================================

/**
 * The main app router.
 */
export const AppRouter = Router.make("AppRouter").add(AppRoutes);

// =============================================================================
// Register routes for type-safe Link href
// =============================================================================

declare module "fibrae/router" {
  interface RegisteredRouter {
    AppRouter: typeof AppRouter;
  }
}

// =============================================================================
// Navigation Components
// =============================================================================

export { Link, RouterOutlet };

// =============================================================================
// Route Names (inferred from router — no manual type needed)
// =============================================================================

/** Route names are inferred from the router's type parameter. */
export type AppRouteName = typeof AppRouter extends Router.Router<string, infer R> ? R : never;

// =============================================================================
// Type Safety Assertions (compile-time tests)
// =============================================================================

// Valid hrefs compile fine:
void Link({ href: "/" });
void Link({ href: "/posts" });
void Link({ href: "/posts/42" });
void Link({ href: "/posts/42/edit" });

// @ts-expect-error — "/typo" is not a valid href
void Link({ href: "/typo" });

// @ts-expect-error — empty string is not a valid href
void Link({ href: "" });
