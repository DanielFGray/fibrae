/**
 * PostDetail component - shows a single post with loader data
 */

import type { VElement } from "fibrae";
import type { Post } from "../../api/index.js";
import { Link } from "../routes.js";

// =============================================================================
// PostDetail (receives data from loader)
// =============================================================================

export interface PostDetailProps {
  loaderData: Post;
  path: { id: number };
}

/**
 * PostDetail - displays a single post.
 * Expects loaderData from the router loader.
 */
export function PostDetail(props: PostDetailProps): VElement {
  const { loaderData: post, path } = props;

  return (
    <article data-cy="post-detail">
      <header>
        <h1 data-cy="post-title">{post.title}</h1>
        <div class="post-meta">
          <span data-cy="post-author">By {post.authorId}</span>
          {" | "}
          <span data-cy="post-id">Post #{path.id}</span>
        </div>
      </header>
      <div class="post-content" data-cy="post-content">
        {post.content}
      </div>
      <footer class="post-actions">
        <Link to="postEdit" params={{ id: post.id }} data-cy="edit-post-link">
          Edit
        </Link>
        {" | "}
        <Link to="posts" data-cy="back-to-posts">
          Back to Posts
        </Link>
      </footer>
    </article>
  );
}
