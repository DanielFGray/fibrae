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
import * as Layer from "effect/Layer";
import type { VElement } from "fibrae";
import { AtomRegistry, Suspense } from "fibrae";
import { RouterBuilder } from "fibrae/router";
import { PostsClient, type Post } from "../api/index.js";
import { AppRouter, Link } from "./routes.js";
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
        <Link to="posts" data-cy="get-started-link">Get Started - View Posts</Link>
      </p>
    </div>
  );
}

/**
 * Posts list page - wrapper for PostList component with Suspense
 */
function PostsPage(): VElement {
  // PostList is an Effect, so wrap in Suspense to show loading state.
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
export function createAppHandlers(isServer: boolean) {
  const source = isServer ? "server" : "client";

  return RouterBuilder.group(AppRouter, "app", (handlers) =>
    handlers
      // Home page - no loader needed
      .handle("home", {
        component: () => <HomePage />,
      })

      // Posts list - PostList component handles its own data fetching
      .handle("posts", {
        component: () => <PostsPage />,
      })

      // Create new post - initialize form atoms
      .handle("postNew", {
        loader: () => {
          // Form will be blank for new posts
          return { source };
        },
        component: () => <PostForm />,
      })

      // Edit post - load post data and pre-fill form
      .handle("postEdit", {
        loader: ({ path }) =>
          Effect.gen(function* () {
            const client = yield* PostsClient;
            const registry = yield* AtomRegistry.AtomRegistry;
            const post = yield* client.findById(path.id as number);

            // Initialize form atoms with post data
            registry.set(PostFormTitleAtom, post.title);
            registry.set(PostFormContentAtom, post.content);

            return { post, source };
          }),
        component: (props) => {
          const loaderData = props.loaderData as { post: Post; source: string };
          return <PostForm post={loaderData.post} />;
        },
      })

      // Post detail - load single post
      .handle("post", {
        loader: ({ path }) =>
          Effect.gen(function* () {
            const client = yield* PostsClient;
            const post = yield* client.findById(path.id as number);
            return post;
          }),
        component: (props) => {
          const pathParams = { id: props.path.id as number };
          return <PostDetail loaderData={props.loaderData} path={pathParams} />;
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
export const AppHandlersLive = (isServer: boolean): Layer.Layer<RouterBuilder.RouterHandlers, never, PostsClient> =>
  createAppHandlers(isServer);
