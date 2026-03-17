/**
 * NotesApi — AtomHttpApi client for the demo app.
 *
 * Replaces the manual PostsClient/AuthClient wrappers with a single
 * AtomHttpApi.Tag that provides the typed HttpApiClient plus .query()
 * and .mutation() atom factories.
 *
 * Usage in Effect components:
 * ```ts
 * const api = yield* NotesApi;
 * const posts = yield* api.posts.list({});
 * const post = yield* api.posts.findById({ path: { id: 1 } });
 * ```
 *
 * Usage as atoms (for Suspense / live updates):
 * ```ts
 * const postsAtom = NotesApi.query("posts", "list", {});
 * const createPost = NotesApi.mutation("posts", "create");
 * ```
 */

import { AtomHttpApi } from "@effect-atom/atom";
import { FetchHttpClient } from "@effect/platform";
import { Api } from "./endpoints.js";

export interface NotesApi {
  readonly _: unique symbol;
}

export const NotesApi = AtomHttpApi.Tag<NotesApi>()("NotesApi", {
  api: Api,
  httpClient: FetchHttpClient.layer,
});
