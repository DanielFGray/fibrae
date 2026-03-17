/**
 * PostForm component - create/edit posts via mutation atoms
 */

import { Atom, AtomRegistry, Result } from "fibrae";
import { NavigatorTag } from "fibrae/router";
import * as Effect from "effect/Effect";
import { NotesApi, type Post } from "../../api/index.js";
import { Link } from "../routes.js";

// =============================================================================
// Mutation Atoms
// =============================================================================

const createPostMutation = NotesApi.mutation("posts", "create");
const updatePostMutation = NotesApi.mutation("posts", "update");

// =============================================================================
// Form Atoms
// =============================================================================

export const PostFormTitleAtom = Atom.make("");
export const PostFormContentAtom = Atom.make("");
const PostFormErrorAtom = Atom.make<string | null>(null);

// =============================================================================
// PostForm Component
// =============================================================================

export interface PostFormProps {
  /** Post to edit (undefined for create mode) */
  post?: Post;
}

/**
 * PostForm - create or edit a post via mutation atoms.
 */
export function PostForm(props: PostFormProps) {
  const { post } = props;
  const isEdit = post !== undefined;
  const mutationAtom = isEdit ? updatePostMutation : createPostMutation;

  return Effect.gen(function* () {
    const registry = yield* AtomRegistry.AtomRegistry;

    const title = yield* Atom.get(PostFormTitleAtom);
    const content = yield* Atom.get(PostFormContentAtom);
    const submitResult = yield* Atom.get(mutationAtom);
    const isSubmitting = Result.isWaiting(submitResult);
    const validationError = yield* Atom.get(PostFormErrorAtom);

    const handleTitleChange = (e: Event) => {
      const target = e.target as HTMLInputElement;
      registry.set(PostFormTitleAtom, target.value);
      if (target.value.trim()) registry.set(PostFormErrorAtom, null);
    };

    const handleContentChange = (e: Event) => {
      const target = e.target as HTMLTextAreaElement;
      registry.set(PostFormContentAtom, target.value);
    };

    const handleSubmit = (e: Event) =>
      Effect.gen(function* () {
        e.preventDefault();

        const currentTitle = registry.get(PostFormTitleAtom);
        const currentContent = registry.get(PostFormContentAtom);

        if (!currentTitle.trim()) {
          registry.set(PostFormErrorAtom, "Title is required");
          return;
        }
        registry.set(PostFormErrorAtom, null);

        // Trigger mutation by writing the request payload to the mutation atom
        if (isEdit && post) {
          registry.set(updatePostMutation, {
            path: { id: post.id },
            payload: { title: currentTitle, content: currentContent },
          });
        } else {
          registry.set(createPostMutation, {
            payload: { title: currentTitle, content: currentContent },
          });
        }

        // Wait for mutation result
        const result = yield* Atom.getResult(mutationAtom);

        // Clear form and navigate on success
        registry.set(PostFormTitleAtom, "");
        registry.set(PostFormContentAtom, "");

        void result; // result is the saved Post
        const navigator = yield* NavigatorTag;
        yield* navigator.go("/posts");
      });

    const validationEl = validationError
      ? <div class="error" data-cy="form-error">{validationError}</div>
      : null;

    const statusEl = Result.builder(submitResult)
      .onWaiting(() => <span class="status">Saving...</span>)
      .onError(() => <div class="error" data-cy="form-error">Failed to save post</div>)
      .onSuccess((savedPost: Post) => <span class="success">Saved: {savedPost.title}</span>)
      .orNull();

    return (
      <form data-cy="post-form" onsubmit={handleSubmit}>
        <h2>{isEdit ? "Edit Post" : "New Post"}</h2>

        {validationEl}
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
          <Link href="/posts" data-cy="cancel-link">
            Cancel
          </Link>
        </div>
      </form>
    );
  });
}
