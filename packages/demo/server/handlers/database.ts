/**
 * PostDatabase service - file-based persistence for posts
 */

import * as Effect from "effect/Effect";
import * as FileSystem from "@effect/platform/FileSystem";
import * as Schema from "effect/Schema";
import { DateTime } from "effect";
import { Post, PostNotFoundError } from "../../src/api/index.js";

// =============================================================================
// Internal Types
// =============================================================================

/**
 * Stored post format (dates as ISO strings in JSON)
 */
const StoredPost = Schema.Struct({
  id: Schema.Int,
  title: Schema.String,
  content: Schema.String,
  authorId: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

type StoredPost = typeof StoredPost.Type;

// =============================================================================
// Service Definition
// =============================================================================

const POSTS_FILE = new URL("../data/posts.json", import.meta.url).pathname;

export class PostDatabase extends Effect.Service<PostDatabase>()("PostDatabase", {
  effect: Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    const loadPosts = Effect.fn("loadPosts")(function* () {
      const exists = yield* fs.exists(POSTS_FILE);
      if (!exists) {
        return [] as StoredPost[];
      }
      const content = yield* fs.readFileString(POSTS_FILE);
      return JSON.parse(content) as StoredPost[];
    });

    const savePosts = (posts: StoredPost[]): Effect.Effect<void> =>
      fs.writeFileString(POSTS_FILE, JSON.stringify(posts, null, 2));

    const toPost = (stored: StoredPost): Post =>
      new Post({
        id: stored.id,
        title: stored.title,
        content: stored.content,
        authorId: stored.authorId,
        createdAt: DateTime.unsafeFromDate(new Date(stored.createdAt)),
        updatedAt: DateTime.unsafeFromDate(new Date(stored.updatedAt)),
      });

    const fromPost = (post: Post): StoredPost => ({
      id: post.id,
      title: post.title,
      content: post.content,
      authorId: post.authorId,
      createdAt: DateTime.formatIso(post.createdAt),
      updatedAt: DateTime.formatIso(post.updatedAt),
    });

    return {
      getAll: () =>
        Effect.gen(function* () {
          const stored = yield* loadPosts();
          return stored.map(toPost);
        }),

      findById: (id: number) =>
        Effect.gen(function* () {
          const stored = yield* loadPosts();
          const found = stored.find((p) => p.id === id);
          if (!found) {
            return yield* Effect.fail(new PostNotFoundError({ id }));
          }
          return toPost(found);
        }),

      create: (data: { title: string; content: string; authorId: string }) =>
        Effect.gen(function* () {
          const stored = yield* loadPosts();
          const maxId = stored.reduce((max, p) => Math.max(max, p.id), 0);
          const now = DateTime.unsafeNow();
          const newPost = new Post({
            id: maxId + 1,
            title: data.title,
            content: data.content,
            authorId: data.authorId,
            createdAt: now,
            updatedAt: now,
          });
          yield* savePosts([...stored, fromPost(newPost)]);
          return newPost;
        }),

      update: (id: number, data: { title: string; content: string }) =>
        Effect.gen(function* () {
          const stored = yield* loadPosts();
          const index = stored.findIndex((p) => p.id === id);
          if (index === -1) {
            return yield* Effect.fail(new PostNotFoundError({ id }));
          }
          const existing = stored[index];
          const now = DateTime.unsafeNow();
          const updated = new Post({
            id: existing.id,
            title: data.title,
            content: data.content,
            authorId: existing.authorId,
            createdAt: DateTime.unsafeFromDate(new Date(existing.createdAt)),
            updatedAt: now,
          });
          stored[index] = fromPost(updated);
          yield* savePosts(stored);
          return updated;
        }),

      delete: (id: number) =>
        Effect.gen(function* () {
          const stored = yield* loadPosts();
          const index = stored.findIndex((p) => p.id === id);
          if (index === -1) {
            return yield* Effect.fail(new PostNotFoundError({ id }));
          }
          stored.splice(index, 1);
          yield* savePosts(stored);
        }),
    };
  }),
}) {}

/**
 * Live layer for PostDatabase (requires FileSystem)
 */
export const PostDatabaseLive = PostDatabase.Default;
