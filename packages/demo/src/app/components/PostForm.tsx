/**
 * PostForm component - create/edit posts with Effect event handlers
 */

import type { VElement } from "fibrae";
import { Atom, AtomRegistry } from "fibrae";
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
export const PostFormSubmittingAtom = Atom.make(false);
export const PostFormErrorAtom = Atom.make<string | null>(null);

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
    const submitting = registry.get(PostFormSubmittingAtom);
    const error = registry.get(PostFormErrorAtom);

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

        registry.set(PostFormSubmittingAtom, true);
        registry.set(PostFormErrorAtom, null);

        const currentTitle = registry.get(PostFormTitleAtom);
        const currentContent = registry.get(PostFormContentAtom);

        if (!currentTitle.trim()) {
          registry.set(PostFormErrorAtom, "Title is required");
          registry.set(PostFormSubmittingAtom, false);
          return;
        }

        const client = yield* PostsClient;

        const result = yield* Effect.either(
          isEdit && post
            ? client.update(post.id, { title: currentTitle, content: currentContent })
            : client.create({ title: currentTitle, content: currentContent }),
        );

        registry.set(PostFormSubmittingAtom, false);

        if (result._tag === "Left") {
          registry.set(PostFormErrorAtom, "Failed to save post");
          return;
        }

        // Clear form on success
        registry.set(PostFormTitleAtom, "");
        registry.set(PostFormContentAtom, "");

        // Navigate to posts list using router
        const navigator = yield* NavigatorTag;
        yield* navigator.go("posts");
      });

    return (
      <form data-cy="post-form" onsubmit={handleSubmit}>
        <h2>{isEdit ? "Edit Post" : "New Post"}</h2>

        {error !== null && (
          <div class="error" data-cy="form-error">
            {error}
          </div>
        )}

        <div class="form-field">
          <label for="title">Title</label>
          <input
            type="text"
            id="title"
            name="title"
            value={title}
            oninput={handleTitleChange}
            disabled={submitting}
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
            disabled={submitting}
            rows={10}
            data-cy="content-input"
          />
        </div>

        <div class="form-actions">
          <button type="submit" disabled={submitting} data-cy="submit-btn">
            {submitting ? "Saving..." : isEdit ? "Update Post" : "Create Post"}
          </button>
          <Link to="posts" data-cy="cancel-link">Cancel</Link>
        </div>
      </form>
    );
  });
}
