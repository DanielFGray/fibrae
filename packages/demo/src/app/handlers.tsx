/**
 * App Route Handlers - implements loaders and components for each route.
 *
 * Pattern follows fibrae RouterBuilder conventions:
 * - RouterBuilder.group(Router, groupName, handlers => ...)
 * - handlers.handle(routeName, { loader, component })
 * - loaders can return plain values or Effects
 * - components receive loaderData and path params
 */

import * as Effect from "effect/Effect";
import type { VElement } from "fibrae";
import { AtomRegistry, Suspense } from "fibrae";
import { RouterBuilder } from "fibrae/router";
import { NotesApi, type Post } from "../api/index.js";
import { AppRouter, AppRoutes, Link } from "./routes.js";
import { PostDetail } from "./components/PostDetail.js";
import { PostForm, PostFormTitleAtom, PostFormContentAtom } from "./components/PostForm.js";
import { PostList } from "./components/PostList.js";

// =============================================================================
// Page Components (simple wrappers)
// =============================================================================

/**
 * Home page - landing with welcome message
 */
function HomePage(): VElement {
  return (
    <div data-cy="home-page">
      <h2>Welcome to Fibrae Notes</h2>
      <p>An Effect-first notes application demonstrating:</p>
      <ul>
        <li>Effect-based components</li>
        <li>Type-safe routing with schema-validated params</li>
        <li>Suspense with Effect and Stream</li>
        <li>Server-side rendering with hydration</li>
      </ul>
      <p>
        <Link href="/posts" data-cy="get-started-link">
          Get Started - View Posts
        </Link>
      </p>
    </div>
  );
}

/**
 * Posts list page - wrapper for PostList component with Suspense
 */
function PostsPage(): VElement {
  return (
    <div data-cy="posts-page">
      <h2>All Posts</h2>
      <Suspense fallback={<div data-cy="posts-loading">Loading posts...</div>} threshold={50}>
        <PostList />
      </Suspense>
    </div>
  );
}

// =============================================================================
// Handler Layer
// =============================================================================

/**
 * Create the handler layer for the app router.
 *
 * @param isServer - Whether running on server (affects loader behavior)
 */
export function createAppHandlers(_isServer: boolean) {
  return RouterBuilder.group(AppRouter, AppRoutes, (handlers) =>
    handlers
      // Home page - no loader needed
      .handle("home", {
        component: () => <HomePage />,
      })

      // Posts list - PostList reads its own query atom
      .handle("posts", {
        component: () => <PostsPage />,
      })

      // Create new post - initialize form atoms
      .handle("postNew", {
        loader: () => null,
        component: () => <PostForm />,
      })

      // Edit post - load post data and pre-fill form
      .handle("postEdit", {
        loader: ({ path }) =>
          Effect.gen(function* () {
            const api = yield* NotesApi;
            const registry = yield* AtomRegistry.AtomRegistry;
            const post = yield* api.posts.findById({ path: { id: path.id as number } });

            // Initialize form atoms with post data
            registry.set(PostFormTitleAtom, post.title);
            registry.set(PostFormContentAtom, post.content);

            return post;
          }),
        component: (props) => <PostForm post={props.loaderData as Post} />,
      })

      // Post detail - load single post
      .handle("post", {
        loader: ({ path }) =>
          Effect.gen(function* () {
            const api = yield* NotesApi;
            return yield* api.posts.findById({ path: { id: path.id as number } });
          }),
        component: (props) => {
          const pathParams = { id: props.path.id as number };
          return <PostDetail loaderData={props.loaderData as Post} path={pathParams} />;
        },
      }),
  );
}

/**
 * Server-side handlers layer
 */
export const AppHandlersServerLive = createAppHandlers(true);

/**
 * Client-side handlers layer
 */
export const AppHandlersClientLive = createAppHandlers(false);

/**
 * Combined layer with API client dependency
 */
export const AppHandlersLive = (isServer: boolean) => createAppHandlers(isServer);

// =============================================================================
// Type Safety Assertions (compile-time tests)
// =============================================================================

void RouterBuilder.group(AppRouter, AppRoutes, (h) =>
  h
    // @ts-expect-error — "typo" is not a valid route name for this group
    .handle("typo", { component: () => <div /> }),
);
