/**
 * PostList component - displays list of posts via query atom
 */

import * as Effect from "effect/Effect";
import { Atom } from "fibrae";
import { NotesApi } from "../../api/index.js";
import { Link } from "../routes.js";

// =============================================================================
// Query Atom — auto-fetches, cached, suspends while loading
// =============================================================================

export const postsAtom = NotesApi.query("posts", "list", {});

// =============================================================================
// PostList (reads query atom via Atom.getResult — suspends in Suspense)
// =============================================================================

/**
 * PostList - reads posts from query atom.
 * Wrap in Suspense for loading state.
 */
export function PostList() {
  return Effect.gen(function* () {
    const posts = yield* Atom.getResult(postsAtom);

    return (
      <div data-cy="post-list">
        <h2>Posts</h2>
        {posts.length === 0 ? (
          <p data-cy="no-posts">No posts yet. Create your first post!</p>
        ) : (
          <ul data-cy="posts-ul">
            {posts.map((post) => (
              <li key={post.id} data-cy={`post-item-${post.id}`}>
                <Link href={`/posts/${post.id}`} data-cy={`post-link-${post.id}`}>
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
