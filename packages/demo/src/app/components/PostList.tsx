/**
 * PostList component - displays list of posts with Suspense
 */

import type { VElement } from "fibrae";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { PostsClient, type Post } from "../../api/index.js";
import { Link } from "../routes.js";

// =============================================================================
// PostList with Suspense (Effect-based)
// =============================================================================

/**
 * PostList - fetches posts from API and renders as list.
 * Returns an Effect that yields a VElement.
 * Wrap in Suspense for loading state.
 */
export function PostList(): Effect.Effect<VElement, never, PostsClient> {
  return Effect.gen(function* () {
    const client = yield* PostsClient;
    const posts = yield* client.list();

    return (
      <div data-cy="post-list">
        <h2>Posts</h2>
        {posts.length === 0 ? (
          <p data-cy="no-posts">No posts yet. Create your first post!</p>
        ) : (
          <ul data-cy="posts-ul">
            {posts.map((post) => (
              <li key={post.id} data-cy={`post-item-${post.id}`}>
                <Link to="post" params={{ id: post.id }} data-cy={`post-link-${post.id}`}>
                  <strong>{post.title}</strong>
                </Link>
                <span class="post-meta"> by {post.authorId}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  });
}

// =============================================================================
// PostList with Stream (for demonstrating progressive loading)
// =============================================================================

/**
 * PostListStream - returns a Stream that progressively emits posts.
 * Useful for demonstrating Suspense with incremental updates.
 */
export function PostListStream(): Stream.Stream<VElement, never, PostsClient> {
  return Stream.unwrap(
    Effect.gen(function* () {
      const client = yield* PostsClient;
      const posts = yield* client.list();

      // Emit posts one at a time with delay for demo purposes
      return Stream.fromIterable(posts).pipe(
        Stream.scan([] as readonly Post[], (acc, post) => [...acc, post]),
        Stream.tap(() => Effect.sleep("200 millis")),
        Stream.map((currentPosts) => (
          <div data-cy="post-list-stream">
            <h2>Posts (streaming...)</h2>
            <ul data-cy="posts-ul">
              {currentPosts.map((post) => (
                <li key={post.id} data-cy={`post-item-${post.id}`}>
                  <Link to="post" params={{ id: post.id }}>
                    {post.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )),
      );
    }),
  );
}
