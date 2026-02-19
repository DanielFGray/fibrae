/**
 * API module - exports all schemas and the combined Api definition
 */

// Schemas (data models and errors)
export {
  Post,
  User,
  CreatePostPayload,
  UpdatePostPayload,
  LoginPayload,
  PostNotFoundError,
  ValidationError,
  UnauthorizedError,
} from "./schemas.js";

// API definition (used by server handlers and client)
export { Api, PostsApi, AuthApi } from "./endpoints.js";

// Client services (used by components)
export { PostsClient, AuthClient, ApiClientLive } from "./client.js";
