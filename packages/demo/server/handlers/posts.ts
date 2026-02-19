/**
 * Posts API handlers using HttpApiBuilder
 */

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpApiBuilder, HttpServerRequest } from "@effect/platform";
import { Api, UnauthorizedError, ValidationError } from "../../src/api/index.js";
import { PostDatabase } from "./database.js";
import { CurrentUser } from "./auth.js";

// =============================================================================
// Delay Middleware Helper
// =============================================================================

/**
 * Apply artificial delay if ?delay=ms query parameter is present
 */
const maybeDelay = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const url = new URL(request.url, "http://localhost");
  const delayMs = url.searchParams.get("delay");
  if (delayMs) {
    const ms = parseInt(delayMs, 10);
    if (!isNaN(ms) && ms > 0) {
      yield* Effect.sleep(`${ms} millis`);
    }
  }
});

// =============================================================================
// Posts Handlers
// =============================================================================

export const PostsHandlersLive = HttpApiBuilder.group(Api, "posts", (handlers) =>
  Effect.gen(function* () {
    const db = yield* PostDatabase;

    return handlers
      .handle("list", () =>
        Effect.gen(function* () {
          yield* maybeDelay;
          return yield* db.getAll();
        }),
      )
      .handle("findById", ({ path }) =>
        Effect.gen(function* () {
          yield* maybeDelay;
          return yield* db.findById(path.id);
        }),
      )
      .handle("create", ({ payload }) =>
        Effect.gen(function* () {
          yield* maybeDelay;
          const user = yield* Effect.either(CurrentUser);
          if (user._tag === "Left") {
            return yield* Effect.fail(new UnauthorizedError());
          }
          if (!payload.title.trim()) {
            return yield* Effect.fail(new ValidationError({ message: "Title is required" }));
          }
          return yield* db.create({
            title: payload.title,
            content: payload.content,
            authorId: user.right.username,
          });
        }),
      )
      .handle("update", ({ path, payload }) =>
        Effect.gen(function* () {
          yield* maybeDelay;
          const user = yield* Effect.either(CurrentUser);
          if (user._tag === "Left") {
            return yield* Effect.fail(new UnauthorizedError());
          }
          if (!payload.title.trim()) {
            return yield* Effect.fail(new ValidationError({ message: "Title is required" }));
          }
          return yield* db.update(path.id, {
            title: payload.title,
            content: payload.content,
          });
        }),
      )
      .handle("delete", ({ path }) =>
        Effect.gen(function* () {
          yield* maybeDelay;
          const user = yield* Effect.either(CurrentUser);
          if (user._tag === "Left") {
            return yield* Effect.fail(new UnauthorizedError());
          }
          yield* db.delete(path.id);
        }),
      );
  }),
).pipe(
  Layer.provide(PostDatabase.Default),
  // PostDatabase requires FileSystem - provided by consumer
);
