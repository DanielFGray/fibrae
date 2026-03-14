/**
 * App Router - route definitions for the Notes demo app.
 *
 * Pattern follows fibrae router conventions:
 * - Route.get(name, pattern) for route declaration
 * - Route.param(name, Schema) for typed path params
 * - Router.group(name) to group routes
 * - Router.make(name).add(group) to create router
 */

import * as Schema from "effect/Schema";
import { Route, Router, createLink, RouterOutlet } from "fibrae/router";

// =============================================================================
// Path Parameters
// =============================================================================

const idParam = Route.param("id", Schema.NumberFromString);

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
  .add(Route.get("postEdit")`/posts/${idParam}/edit`)
  .add(Route.get("post")`/posts/${idParam}`);

// =============================================================================
// Router
// =============================================================================

/**
 * The main app router.
 */
export const AppRouter = Router.make("AppRouter").add(AppRoutes);

// =============================================================================
// Typed Navigation Components
// =============================================================================

/**
 * Type-safe Link component for the app router.
 * Usage: <Link to="post" params={{ id: 1 }}>View Post</Link>
 */
export const Link = createLink(AppRouter);

/**
 * Re-export RouterOutlet for app shell.
 */
export { RouterOutlet };

// =============================================================================
// Route Names (inferred from router — no manual type needed)
// =============================================================================

/** Route names are inferred from the router's type parameter. */
export type AppRouteName = typeof AppRouter extends Router.Router<string, infer R> ? R : never;

// =============================================================================
// Type Safety Assertions (compile-time tests)
// =============================================================================

// Valid route names compile fine:
void Link({ to: "home" });
void Link({ to: "posts" });
void Link({ to: "post" });

// @ts-expect-error — "typo" is not a valid route name
void Link({ to: "typo" });

// @ts-expect-error — empty string is not a valid route name
void Link({ to: "" });
