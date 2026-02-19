/**
 * Type-safe API endpoint definitions using @effect/platform HttpApi
 *
 * These definitions are shared between server (handlers) and client (ApiClient).
 * The types flow automatically - no manual duplication needed.
 */

import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "@effect/platform";
import * as Schema from "effect/Schema";
import {
  Post,
  CreatePostPayload,
  UpdatePostPayload,
  PostNotFoundError,
  ValidationError,
  User,
  LoginPayload,
  UnauthorizedError,
} from "./schemas.js";

// =============================================================================
// Path Parameters
// =============================================================================

const postIdParam = HttpApiSchema.param("id", Schema.NumberFromString);

// =============================================================================
// Posts API Group
// =============================================================================

export class PostsApi extends HttpApiGroup.make("posts")
  .add(
    HttpApiEndpoint.get("list", "/")
      .addSuccess(Schema.Array(Post))
  )
  .add(
    HttpApiEndpoint.get("findById")`/${postIdParam}`
      .addSuccess(Post)
      .addError(PostNotFoundError, { status: 404 })
  )
  .add(
    HttpApiEndpoint.post("create", "/")
      .setPayload(CreatePostPayload)
      .addSuccess(Post, { status: 201 })
      .addError(ValidationError, { status: 400 })
      .addError(UnauthorizedError, { status: 401 })
  )
  .add(
    HttpApiEndpoint.put("update")`/${postIdParam}`
      .setPayload(UpdatePostPayload)
      .addSuccess(Post)
      .addError(PostNotFoundError, { status: 404 })
      .addError(ValidationError, { status: 400 })
      .addError(UnauthorizedError, { status: 401 })
  )
  .add(
    HttpApiEndpoint.del("delete")`/${postIdParam}`
      .addSuccess(Schema.Void)
      .addError(PostNotFoundError, { status: 404 })
      .addError(UnauthorizedError, { status: 401 })
  )
  .prefix("/api/posts")
{}

// =============================================================================
// Auth API Group
// =============================================================================

export class AuthApi extends HttpApiGroup.make("auth")
  .add(
    HttpApiEndpoint.post("login", "/login")
      .setPayload(LoginPayload)
      .addSuccess(User)
      .addError(ValidationError, { status: 400 })
  )
  .add(
    HttpApiEndpoint.post("logout", "/logout")
      .addSuccess(Schema.Void)
  )
  .add(
    HttpApiEndpoint.get("me", "/me")
      .addSuccess(User)
      .addError(UnauthorizedError, { status: 401 })
  )
  .prefix("/api/auth")
{}

// =============================================================================
// Combined API
// =============================================================================

export class Api extends HttpApi.make("fibrae-notes")
  .add(PostsApi)
  .add(AuthApi)
{}
