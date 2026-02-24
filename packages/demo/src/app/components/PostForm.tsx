/**
 * PostForm component - create/edit posts with Effect event handlers
 *
 * Uses Result<Post, string> to unify loading/error/success state into a single atom.
 */

import type { VElement } from "fibrae";
import { Atom, AtomRegistry, Result } from "fibrae";
import { NavigatorTag } from "fibrae/router";
import * as Effect from "effect/Effect";
import { PostsClient, type Post } from "../../api/index.js";
import { Link } from "../routes.js";

// =============================================================================
// Form Atoms
// =============================================================================

/**
 * Form state atoms
 */
export const PostFormTitleAtom = Atom.make("");
export const PostFormContentAtom = Atom.make("");
export const PostFormResultAtom = Atom.make<Result.Result<Post, string>>(Result.initial());

// =============================================================================
// PostForm Component
// =============================================================================

export interface PostFormProps {
  /** Post to edit (undefined for create mode) */
  post?: Post;
  /** Callback after successful submit - receives created/updated post */
  onSuccess?: (post: Post) => void;
}

/**
 * PostForm - create or edit a post.
 * Uses Effect event handlers for form submission.
 */
export function PostForm(props: PostFormProps): Effect.Effect<VElement, never, AtomRegistry.AtomRegistry | PostsClient> {
  const { post } = props;
  const isEdit = post !== undefined;

  return Effect.gen(function* () {
    const registry = yield* AtomRegistry.AtomRegistry;

    const title = registry.get(PostFormTitleAtom);
    const content = registry.get(PostFormContentAtom);
    const submitResult = registry.get(PostFormResultAtom);
    const isSubmitting = Result.isWaiting(submitResult);

    const handleTitleChange = (e: Event) => {
      const target = e.target as HTMLInputElement;
      registry.set(PostFormTitleAtom, target.value);
    };

    const handleContentChange = (e: Event) => {
      const target = e.target as HTMLTextAreaElement;
      registry.set(PostFormContentAtom, target.value);
    };

    const handleSubmit = (e: Event) =>
      Effect.gen(function* () {
        e.preventDefault();

        const current = registry.get(PostFormResultAtom);
        registry.set(PostFormResultAtom, Result.waiting(current));

        const currentTitle = registry.get(PostFormTitleAtom);
        const currentContent = registry.get(PostFormContentAtom);

        if (!currentTitle.trim()) {
          registry.set(PostFormResultAtom, Result.fail("Title is required"));
          return;
        }

        const client = yield* PostsClient;

        const result = yield* Effect.either(
          isEdit && post
            ? client.update(post.id, { title: currentTitle, content: currentContent })
            : client.create({ title: currentTitle, content: currentContent }),
        );

        if (result._tag === "Left") {
          registry.set(PostFormResultAtom, Result.fail("Failed to save post"));
          return;
        }

        registry.set(PostFormResultAtom, Result.success(result.right));

        // Clear form on success
        registry.set(PostFormTitleAtom, "");
        registry.set(PostFormContentAtom, "");

        // Navigate to posts list using router
        const navigator = yield* NavigatorTag;
        yield* navigator.go("posts");
      });

    const statusEl = Result.builder(submitResult)
      .onWaiting(() => <span class="status">Saving...</span>)
      .onError((err) => <div class="error" data-cy="form-error">{err}</div>)
      .onSuccess((savedPost) => <span class="success">Saved: {savedPost.title}</span>)
      .orNull();

    return (
      <form data-cy="post-form" onsubmit={handleSubmit}>
        <h2>{isEdit ? "Edit Post" : "New Post"}</h2>

        {statusEl}

        <div class="form-field">
          <label for="title">Title</label>
          <input
            type="text"
            id="title"
            name="title"
            value={title}
            oninput={handleTitleChange}
            disabled={isSubmitting}
            data-cy="title-input"
          />
        </div>

        <div class="form-field">
          <label for="content">Content</label>
          <textarea
            id="content"
            name="content"
            value={content}
            oninput={handleContentChange}
            disabled={isSubmitting}
            rows={10}
            data-cy="content-input"
          />
        </div>

        <div class="form-actions">
          <button type="submit" disabled={isSubmitting} data-cy="submit-btn">
            {isSubmitting ? "Saving..." : isEdit ? "Update Post" : "Create Post"}
          </button>
          <Link to="posts" data-cy="cancel-link">Cancel</Link>
        </div>
      </form>
    );
  });
}
