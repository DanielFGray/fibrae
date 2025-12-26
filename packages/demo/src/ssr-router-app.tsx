/**
 * SSR Router App - shared component for testing SSR/hydration.
 *
 * Used by both server and client:
 * - Server: imports this, uses serverLayer to render
 * - Client: imports this, uses browserLayer to hydrate
 */

import * as Schema from "effect/Schema";
import type { VElement } from "fibrae";
import { Route, Router, RouterBuilder, createLink, RouterOutlet } from "fibrae";

// =============================================================================
// Route Definitions
// =============================================================================

const idParam = Route.param("id", Schema.NumberFromString);

// Define routes with schema-validated params
export const SSRRouterRoutes = Router.group("ssr")
  .add(Route.get("home", "/"))
  .add(Route.get("posts", "/posts"))
  .add(Route.get("post")`/posts/${idParam}`);

// Create router from groups
export const SSRRouter = Router.make("SSRRouter").add(SSRRouterRoutes);

// Create Link component for this router
export const Link = createLink(SSRRouter);

// Re-export RouterOutlet for use in App
export { RouterOutlet };

// =============================================================================
// Components
// =============================================================================

/**
 * Home page component
 */
export function HomePage(props: { loaderData: { message: string; source: string } }): VElement {
  return (
    <div>
      <h2>Home Page</h2>
      <p data-cy="current-route-name">home</p>
      <p data-cy="loader-data-message">{props.loaderData.message}</p>
      <p data-cy="loader-data-source">{props.loaderData.source}</p>
    </div>
  );
}

/**
 * Posts list page component
 */
export function PostsPage(props: {
  loaderData: { posts: Array<{ id: number; title: string }>; source: string };
}): VElement {
  return (
    <div>
      <h2>Posts Page</h2>
      <p data-cy="current-route-name">posts</p>
      <p data-cy="loader-data-count">{props.loaderData.posts.length}</p>
      <p data-cy="loader-data-source">{props.loaderData.source}</p>
      <ul>
        {props.loaderData.posts.map((post) => (
          <li key={post.id}>
            <Link to="post" params={{ id: post.id }} data-cy={`post-link-${post.id}`}>
              {post.title}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Post detail page component
 */
export function PostPage(props: {
  loaderData: { id: number; title: string; content: string; source: string };
  path: { id: number };
}): VElement {
  return (
    <div>
      <h2>Post Detail</h2>
      <p data-cy="current-route-name">post</p>
      <p data-cy="post-id">{props.path.id}</p>
      <p data-cy="post-id-type">{typeof props.path.id}</p>
      <p data-cy="post-title">{props.loaderData.title}</p>
      <p data-cy="loader-data-source">{props.loaderData.source}</p>
    </div>
  );
}

/**
 * Navigation component - used in the app shell
 */
export function Navigation(): VElement {
  return (
    <nav>
      <Link to="home" data-cy="nav-link-home">
        Home
      </Link>
      {" | "}
      <Link to="posts" data-cy="nav-link-posts">
        Posts
      </Link>
    </nav>
  );
}

// =============================================================================
// Handler Implementation - Creates Layer with loaders/components
// =============================================================================

/**
 * Create the handler layer for the router.
 *
 * @param isServer - Whether this is running on the server (affects loader source)
 */
export function createSSRRouterHandlers(isServer: boolean) {
  const source = isServer ? "server" : "client";

  return RouterBuilder.group(SSRRouter, "ssr", (handlers) =>
    handlers
      .handle("home", {
        loader: () => ({
          message: `Hello from ${source} loader`,
          source,
        }),
        component: (props) => <HomePage loaderData={props.loaderData} />,
      })
      .handle("posts", {
        loader: () => ({
          posts: [
            { id: 1, title: "First Post" },
            { id: 2, title: "Second Post" },
            { id: 3, title: "Third Post" },
          ],
          source,
        }),
        component: (props) => <PostsPage loaderData={props.loaderData} />,
      })
      .handle("post", {
        loader: ({ path }) => ({
          id: path.id as number,
          title: `Post ${path.id}`,
          content: `Content for post ${path.id}`,
          source,
        }),
        component: (props) => (
          <PostPage loaderData={props.loaderData} path={props.path as { id: number }} />
        ),
      }),
  );
}

// =============================================================================
// App Shell
// =============================================================================

/**
 * Main App component that wraps route content with navigation
 */
export function App(props: { children: VElement }): VElement {
  return (
    <div data-cy="ssr-router-page">
      <h1>SSR Router Test</h1>
      <Navigation />
      <hr />
      {props.children}
    </div>
  );
}
