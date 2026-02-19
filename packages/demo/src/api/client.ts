/**
 * Type-safe API client using @effect/platform HttpApiClient
 *
 * Usage in components:
 * ```ts
 * const posts = yield* PostsClient;
 * const allPosts = yield* posts.list({});
 * const post = yield* posts.findById({ path: { id: 1 } });
 * ```
 */

import * as Effect from "effect/Effect";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import { HttpApiClient, FetchHttpClient } from "@effect/platform";
import { Api } from "./endpoints.js";
import type { Post, User } from "./schemas.js";

// =============================================================================
// Posts Client Service
// =============================================================================

/**
 * PostsClient service - provides type-safe access to posts API
 */
export class PostsClient extends Context.Tag("PostsClient")<
  PostsClient,
  {
    readonly list: () => Effect.Effect<readonly Post[]>;
    readonly findById: (id: number) => Effect.Effect<Post>;
    readonly create: (data: { title: string; content: string }) => Effect.Effect<Post>;
    readonly update: (id: number, data: { title: string; content: string }) => Effect.Effect<Post>;
    readonly delete: (id: number) => Effect.Effect<void>;
  }
>() {}

/**
 * AuthClient service - provides type-safe access to auth API
 */
export class AuthClient extends Context.Tag("AuthClient")<
  AuthClient,
  {
    readonly login: (username: string) => Effect.Effect<User>;
    readonly logout: () => Effect.Effect<void>;
    readonly me: () => Effect.Effect<User>;
  }
>() {}

// =============================================================================
// Client Layer Implementation
// =============================================================================

// Base URL is empty because the Api definition already includes /api prefix on groups
const API_BASE_URL = "";

/**
 * Create the API client and wrap it in our service interfaces
 */
const makeClients = Effect.gen(function* () {
  const client = yield* HttpApiClient.make(Api, { baseUrl: API_BASE_URL });

  const postsClient: Context.Tag.Service<PostsClient> = {
    list: () => client.posts.list({}).pipe(Effect.orDie),
    findById: (id) => client.posts.findById({ path: { id } }).pipe(Effect.orDie),
    create: (data) =>
      client.posts.create({ payload: { title: data.title, content: data.content } }).pipe(Effect.orDie),
    update: (id, data) =>
      client.posts.update({
        path: { id },
        payload: { title: data.title, content: data.content },
      }).pipe(Effect.orDie),
    delete: (id) => client.posts.delete({ path: { id } }).pipe(Effect.orDie),
  };

  const authClient: Context.Tag.Service<AuthClient> = {
    login: (username) => client.auth.login({ payload: { username } }).pipe(Effect.orDie),
    logout: () => client.auth.logout({}).pipe(Effect.orDie),
    me: () => client.auth.me({}).pipe(Effect.orDie),
  };

  return { postsClient, authClient };
});

/**
 * Live layer providing PostsClient and AuthClient
 * Requires HttpClient (e.g., FetchHttpClient)
 */
const PostsClientLive = Layer.effect(
  PostsClient,
  makeClients.pipe(Effect.map(({ postsClient }) => postsClient)),
);

const AuthClientLayerLive = Layer.effect(
  AuthClient,
  makeClients.pipe(Effect.map(({ authClient }) => authClient)),
);

export const ApiClientLive = Layer.mergeAll(PostsClientLive, AuthClientLayerLive).pipe(
  Layer.provide(FetchHttpClient.layer),
);
