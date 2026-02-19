/**
 * Auth handlers - simple cookie-based authentication
 */

import * as Effect from "effect/Effect";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { HttpApiBuilder, HttpServerRequest } from "@effect/platform";
import { Api, User, UnauthorizedError, ValidationError } from "../../src/api/index.js";

// =============================================================================
// CurrentUser Context
// =============================================================================

/**
 * Context tag for the current authenticated user
 * Components and handlers can yield* CurrentUser to access the user
 */
export class CurrentUser extends Context.Tag("CurrentUser")<CurrentUser, User>() {}

/**
 * Extract current user from request cookies
 */
export const getCurrentUserFromCookies = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const cookies = request.cookies;
  const usernameOpt = Option.fromNullable(cookies["username"]);
  if (Option.isNone(usernameOpt)) {
    return yield* Effect.fail(new UnauthorizedError());
  }
  return new User({ username: usernameOpt.value });
});

/**
 * Layer that provides CurrentUser from cookies (may fail with UnauthorizedError)
 */
export const CurrentUserFromCookies = Layer.effect(
  CurrentUser,
  getCurrentUserFromCookies,
);

// =============================================================================
// Auth Handlers
// =============================================================================

export const AuthHandlersLive = HttpApiBuilder.group(Api, "auth", (handlers) =>
  handlers
    .handle("login", ({ payload }) =>
      Effect.gen(function* () {
        if (!payload.username.trim()) {
          return yield* Effect.fail(new ValidationError({ message: "Username is required" }));
        }
        const user = new User({ username: payload.username.trim() });
        // Note: Cookie setting happens via HttpApiBuilder response
        return user;
      }),
    )
    .handle("logout", () => Effect.void)
    .handle("me", () =>
      Effect.gen(function* () {
        return yield* getCurrentUserFromCookies;
      }),
    ),
);
