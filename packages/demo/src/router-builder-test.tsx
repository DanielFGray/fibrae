/**
 * RouterBuilder test page.
 *
 * Demonstrates:
 * - RouterBuilder.group for handler implementation
 * - Loaders receiving path/search params
 * - Components receiving loaderData
 * - Type-safe param decoding
 */

import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as BrowserPlatform from "@effect/platform-browser";
import { pipe } from "effect/Function";
import { render } from "fibrae";
import { Route, Router, RouterBuilder } from "fibrae";
import type { VElement } from "fibrae";

// =============================================================================
// Route Definitions
// =============================================================================

const idParam = Route.param("id", Schema.NumberFromString);

// Define routes with schema-validated params
const AppRoutes = Router.group("app")
  .add(Route.get("home", "/"))
  .add(Route.get("posts", "/posts"))
  .add(Route.get("post")`/posts/${idParam}`);

// Create router from groups
const AppRouter = Router.make("AppRouter").add(AppRoutes);

// =============================================================================
// Components
// =============================================================================

// Home component
function HomePage(props: { loaderData: { message: string } }): VElement {
  return (
    <div>
      <h2>Home Page</h2>
      <p data-cy="home-loader-data">{props.loaderData.message}</p>
    </div>
  );
}

// Posts component
function PostsPage(props: {
  loaderData: { posts: Array<{ id: number; title: string }> };
  searchParams: { sort?: string; page?: number };
}): VElement {
  return (
    <div>
      <h2>Posts Page</h2>
      <p data-cy="current-route">posts</p>
      <p data-cy="posts-count">{props.loaderData.posts.length}</p>
      <p data-cy="search-sort">{props.searchParams.sort ?? "none"}</p>
      <p data-cy="search-page">{props.searchParams.page ?? 1}</p>
      <p data-cy="search-page-type">{typeof props.searchParams.page}</p>
    </div>
  );
}

// Post detail component
function PostPage(props: {
  loaderData: { id: number; title: string; content: string };
  path: { id: number };
}): VElement {
  return (
    <div>
      <h2>Post Detail</h2>
      <p data-cy="post-id">{props.path.id}</p>
      <p data-cy="post-id-type">{typeof props.path.id}</p>
      <p data-cy="post-title">{props.loaderData.title}</p>
    </div>
  );
}

// =============================================================================
// Handler Implementation
// =============================================================================

// Create handler layer
const AppRoutesLive = RouterBuilder.group(AppRouter, "app", (handlers) =>
  Effect.succeed(
    handlers
      .handle("home", {
        loader: () => Effect.succeed({ message: "Welcome Home" }),
        component: (props) => <HomePage loaderData={props.loaderData} />,
      })
      .handle("posts", {
        loader: ({ searchParams }) =>
          Effect.succeed({
            posts: [
              { id: 1, title: "First Post" },
              { id: 2, title: "Second Post" },
              { id: 3, title: "Third Post" },
            ],
          }),
        component: (props) => (
          <PostsPage loaderData={props.loaderData} searchParams={props.searchParams} />
        ),
      })
      .handle("post", {
        loader: ({ path }) =>
          Effect.succeed({
            id: path.id,
            title: `Post ${path.id}`,
            content: `Content for post ${path.id}`,
          }),
        component: (props) => <PostPage loaderData={props.loaderData} path={props.path} />,
      }),
  ),
);

// =============================================================================
// Main Entry Point - Actually execute handlers
// =============================================================================

Effect.gen(function* () {
  const root = pipe(document.getElementById("root"), Option.fromNullable, Option.getOrThrow);

  // Get the RouterHandlers service
  const routerHandlers = yield* RouterBuilder.RouterHandlers;

  // Render test sections by executing actual handlers
  const sections: VElement[] = [];

  // Test 1: Home route - execute loader and component
  const homeHandler = routerHandlers.getHandler("home");
  if (Option.isSome(homeHandler)) {
    const homeElement = yield* RouterBuilder.executeRoute(homeHandler.value, {
      path: {},
      searchParams: {},
    });
    sections.push(
      <section id="home-test">
        <h2>Home Route Test</h2>
        {homeElement}
      </section>,
    );
  }

  // Test 2: Posts route with search params
  const postsHandler = routerHandlers.getHandler("posts");
  if (Option.isSome(postsHandler)) {
    const postsElement = yield* RouterBuilder.executeRoute(postsHandler.value, {
      path: {},
      searchParams: { sort: "date", page: 2 },
    });
    sections.push(
      <section id="posts-test">
        <h2>Posts Route Test</h2>
        {postsElement}
      </section>,
    );
  }

  // Test 3: Post detail with path params
  const postHandler = routerHandlers.getHandler("post");
  if (Option.isSome(postHandler)) {
    const postElement = yield* RouterBuilder.executeRoute(postHandler.value, {
      path: { id: 123 },
      searchParams: {},
    });
    sections.push(
      <section id="post-test">
        <h2>Post Detail Test</h2>
        {postElement}
      </section>,
    );
  }

  const TestApp = () => (
    <div>
      <h1>RouterBuilder Test</h1>
      {sections}
    </div>
  );

  yield* render(<TestApp />, root);

  return yield* Effect.never;
}).pipe(
  Effect.provide(AppRoutesLive),
  Effect.catchAllDefect((e) => Effect.log(e)),
  BrowserPlatform.BrowserRuntime.runMain,
);
