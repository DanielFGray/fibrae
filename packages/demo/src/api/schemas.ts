/**
 * Shared API schemas - types used by both server and client
 */

import * as Schema from "effect/Schema";

// =============================================================================
// Data Models
// =============================================================================

/**
 * Post entity
 */
export class Post extends Schema.Class<Post>("Post")({
  id: Schema.Int,
  title: Schema.String,
  content: Schema.String,
  authorId: Schema.String,
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
}) {}

/**
 * User entity (from auth cookie)
 */
export class User extends Schema.Class<User>("User")({
  username: Schema.String,
}) {}

/**
 * Create post request payload
 */
export class CreatePostPayload extends Schema.Class<CreatePostPayload>("CreatePostPayload")({
  title: Schema.String.pipe(Schema.minLength(1)),
  content: Schema.String,
}) {}

/**
 * Update post request payload
 */
export class UpdatePostPayload extends Schema.Class<UpdatePostPayload>("UpdatePostPayload")({
  title: Schema.String.pipe(Schema.minLength(1)),
  content: Schema.String,
}) {}

/**
 * Login request payload
 */
export class LoginPayload extends Schema.Class<LoginPayload>("LoginPayload")({
  username: Schema.String.pipe(Schema.minLength(1)),
}) {}

// =============================================================================
// Error Types
// =============================================================================

/**
 * Post not found error (404)
 */
export class PostNotFoundError extends Schema.TaggedClass<PostNotFoundError>()(
  "PostNotFoundError",
  { id: Schema.Int },
  { description: "Post with the given ID was not found" },
) {}

/**
 * Validation error (400)
 */
export class ValidationError extends Schema.TaggedClass<ValidationError>()(
  "ValidationError",
  { message: Schema.String },
  { description: "Request validation failed" },
) {}

/**
 * Unauthorized error (401)
 */
export class UnauthorizedError extends Schema.TaggedClass<UnauthorizedError>()(
  "UnauthorizedError",
  {},
  { description: "Authentication required" },
) {}
