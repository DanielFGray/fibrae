# Effect Platform: Type-Safe HTTP Client/Server APIs for E2E Type Safety

## Overview

Effect's `@effect/platform` provides a comprehensive, type-safe HTTP API framework where types flow from endpoint definitions through both server implementations and generated clients. This ensures compile-time safety across your entire stack.

## Architecture Layers

```
HttpApi (API specification)
  ├── HttpApiGroup (logical endpoint groupings)
  │   └── HttpApiEndpoint (individual routes)
  │
├── Server Implementation
│   └── HttpApiBuilder.group() → handler implementations
│
└── Client Generation
    └── HttpApiClient.make() → type-safe client object
```

## Key APIs & Imports

### Core Imports

```typescript
import {
  HttpApi, // API container
  HttpApiGroup, // Endpoint groups
  HttpApiEndpoint, // Individual endpoints
  HttpApiBuilder, // Server implementation
  HttpApiClient, // Client generation
  HttpApiSchema, // Schema utilities
  HttpApiMiddleware, // Middleware system
  HttpApiSecurity, // Security/auth
  Schema, // Effect schemas
} from "@effect/platform";
```

## 1. Defining Typed API Endpoints

### Basic Structure: HttpApi → HttpApiGroup → HttpApiEndpoint

```typescript
// Define error types as Schema classes
class GlobalError extends Schema.TaggedClass<GlobalError>()("GlobalError", {}) {}
class GroupError extends Schema.TaggedClass<GroupError>()("GroupError", {}) {}

// Define data types
class Group extends Schema.Class<Group>("Group")({
  id: Schema.Int,
  name: Schema.String,
}) {}

class User extends Schema.Class<User>("User")({
  id: Schema.Int,
  name: Schema.String,
  createdAt: Schema.DateTimeUtc,
}) {}

// Define individual endpoints
class GroupsApi extends HttpApiGroup.make("groups")
  .add(
    HttpApiEndpoint.get("findById")`/${HttpApiSchema.param("id", Schema.NumberFromString)}`
      .addSuccess(Group)
      .addError(GroupError),
  )
  .add(
    HttpApiEndpoint.post("create")`/`
      .setPayload(Schema.Struct({ name: Schema.String }))
      .addSuccess(Group),
  )
  .add(
    HttpApiEndpoint.post("upload")`/upload`
      .setPayload(
        HttpApiSchema.Multipart(
          Schema.Struct({
            file: Multipart.SingleFileSchema,
          }),
        ),
      )
      .addSuccess(
        Schema.Struct({
          contentType: Schema.String,
          length: Schema.Int,
        }),
      ),
  )
  .prefix("/groups") {}

// Combine groups into API
class Api extends HttpApi.make("api").add(GroupsApi).addError(GlobalError, { status: 413 }) {}
```

### Endpoint Definition Details

#### HTTPApiEndpoint Methods

- **HTTP Method Constructors**: `get()`, `post()`, `put()`, `patch()`, `delete()`, etc.
- **Path Definition**: Template string with optional path parameters
- **Schema Methods**:
  - `.setPayload(schema)` - Request body validation
  - `.setUrlParams(schema)` - Query string validation
  - `.setHeaders(schema)` - Header validation
  - `.setPath(schema)` - Path parameter validation
  - `.addSuccess(schema, { status?: number })` - Success response (defaults to 200)
  - `.addError(schema, { status?: number })` - Error response (defaults to 500)
  - `.prefix(path)` - Add path prefix
  - `.middleware(tag)` - Add middleware

#### Path Parameters with HttpApiSchema.param()

```typescript
// Type-safe parameter definition
HttpApiSchema.param("id", Schema.NumberFromString);

// Path template - use template string syntax
HttpApiEndpoint.get("getUser")`/users/${HttpApiSchema.param("id", Schema.NumberFromString)}`;

// Optional parameters
HttpApiEndpoint.post("upload")`/upload/${Schema.optional(Schema.String)}`;

// Multiple parameters
class UsersApi extends HttpApiGroup.make("users").add(
  HttpApiEndpoint.get("search")`/search`
    .setUrlParams(
      Schema.Struct({
        query: Schema.optional(Schema.String),
        limit: Schema.NumberFromString.pipe(Schema.optionalWith({ default: () => 10 })),
      }),
    )
    .addSuccess(Schema.Array(User)),
) {}
```

#### Multipart File Upload

```typescript
// Single file with metadata
.setPayload(HttpApiSchema.Multipart(Schema.Struct({
  file: Multipart.SingleFileSchema,
  metadata: Schema.optional(Schema.String)
})))

// Streaming multipart
.setPayload(HttpApiSchema.MultipartStream(Schema.Struct({
  file: Multipart.SingleFileSchema
})))
```

#### Custom Encodings

```typescript
// Form URL-encoded payload (for GET with no body)
HttpApiSchema.withEncoding({ kind: "UrlParams" });

// Plain text response
HttpApiSchema.withEncoding({ kind: "Text" })

  // Multiple payload types (polymorphic)
  .setPayload(
    Schema.Union(
      Schema.Struct({ name: Schema.String }),
      Schema.Struct({ foo: Schema.String }).pipe(HttpApiSchema.withEncoding({ kind: "UrlParams" })),
      HttpApiSchema.Multipart(Schema.Struct({ name: Schema.String })),
    ),
  );
```

## 2. Implementing Handlers on Server (HttpApiBuilder)

### Handler Registration

```typescript
const HttpGroupsLive = HttpApiBuilder.group(
  Api, // Which API
  "groups", // Which group
  (
    handlers, // Handler builder
  ) =>
    Effect.gen(function* () {
      // Initialize any dependencies
      const fs = yield* FileSystem.FileSystem;

      return (
        handlers
          // Basic handler
          .handle("findById", ({ path }) => Effect.succeed(new Group({ id: path.id, name: "foo" })))

          // Handler with payload validation
          .handle("create", ({ payload }) =>
            Effect.succeed(new Group({ id: 1, name: payload.name })),
          )

          // Async handler with Error
          .handle("findById", ({ path }) =>
            path.id === 0
              ? Effect.fail(new GroupError())
              : Effect.succeed(new Group({ id: path.id, name: "foo" })),
          )

          // Handler returning raw HttpServerResponse
          .handle("handle", ({ path, payload }) =>
            HttpServerResponse.unsafeJson({
              id: path.id,
              name: payload.name,
            }),
          )

          // Raw request handler (manual body parsing)
          .handleRaw("handleRaw", ({ path, request }) =>
            Effect.gen(function* () {
              const body = yield* Effect.orDie(request.json);
              return HttpServerResponse.unsafeJson({ id: path.id, ...body });
            }),
          )
      );
    }),
).pipe(
  // Provide required dependencies to handlers
  Layer.provide([UserRepo.Live, FileSystem.layer, AuthorizationLive]),
);
```

### Handler Signature

```typescript
type Handler<Endpoint> = (request: {
  // Decoded and validated path parameters
  path?: PathParams;

  // Decoded and validated query parameters
  urlParams?: QueryParams;

  // Decoded and validated request body
  payload?: RequestBody;

  // Decoded and validated headers
  headers?: Headers;

  // Raw HttpServerRequest
  request: HttpServerRequest;
}) => Effect.Effect<SuccessType | HttpServerResponse, ErrorType, RequiredContext>;
```

### Key Features

- **Automatic Validation**: Payloads/params/headers validated against schemas before handler
- **Type Inference**: Handler receives fully typed parameters
- **Error Handling**: Return `Effect.fail()` to send error response with status code
- **Raw Response**: Return `HttpServerResponse` for full control
- **Middleware**: Handlers can depend on middleware-provided services

## 3. Type-Safe Client Generation

### Creating a Client

```typescript
// Simple client creation
const client = yield * HttpApiClient.make(Api);

// Client structure mirrors API:
const user =
  yield *
  client.users.findById({
    path: { id: 123 },
  });

const group =
  yield *
  client.groups.create({
    payload: { name: "New Group" },
  });

// With response object
const [user, response] =
  yield *
  client.users.list({
    headers: { page: 1 },
    urlParams: {},
    withResponse: true, // Get both response and status
  });
```

### Client Type Inference

The client type structure is automatically generated:

```typescript
export type Client<Groups> = {
  // Non-top-level groups become properties
  groups: {
    // Each endpoint becomes a method
    findById: (request: { path: { id: number } }) => Effect.Effect<Group, ...>
    create: (request: { payload: { name: string } }) => Effect.Effect<Group, ...>
  }
  users: {
    list: (request: { headers?: { page?: number } }) => Effect.Effect<User[], ...>
  }

  // Top-level endpoints become direct methods
  healthz: () => Effect.Effect<void, ...>
}
```

### Client Options

```typescript
// Custom HTTP client with middleware
const client =
  yield *
  HttpApiClient.makeWith(Api, {
    httpClient: (yield * HttpClient.HttpClient).pipe(
      HttpClient.tapRequest(/* logging */),
      HttpClient.withCookiesRef(/* cookies */),
    ),
  });

// Custom base URL
const client =
  yield *
  HttpApiClient.makeWith(Api, {
    httpClient: yield * HttpClient.HttpClient,
    baseUrl: "https://api.example.com",
  });

// Specific endpoint access
const endpoint =
  yield *
  HttpApiClient.endpoint(Api, {
    httpClient: yield * HttpClient.HttpClient,
    group: "users",
    endpoint: "findById",
  });

// Specific group access
const group =
  yield *
  HttpApiClient.group(Api, {
    httpClient: yield * HttpClient.HttpClient,
    group: "users",
  });
```

## 4. How Client & Server Share Types

### Type Flow

```
Endpoint Definition
  ├─ Path Type: extracted from path schema & parameters
  ├─ Payload Type: from setPayload()
  ├─ Success Type: from addSuccess()
  └─ Error Type: from addError()
       ↓
Server Implementation
  ├─ Handler receives typed parameters
  ├─ Must return Success or Error type
  └─ Validation automatic
       ↓
Client Generation
  ├─ Method signature derived from endpoint
  ├─ Request param types enforced
  └─ Response type guaranteed
```

### Concrete Example

```typescript
// Endpoint Definition
class Api extends HttpApi.make("api")
  .add(
    HttpApiGroup.make("users").add(
      HttpApiEndpoint.get("findById")`/${HttpApiSchema.param("id", Schema.NumberFromString)}`
        .addSuccess(User)                              // ← Success type
        .addError(UserNotFoundError)                   // ← Error type
    )
  )
{}

// Server Handler
const handler = (request: {
  path: { id: number }  // ← Extracted from param
}) =>
  id === 0
    ? Effect.fail(new UserNotFoundError())  // ← Error type enforced
    : Effect.succeed(new User(...))         // ← Success type enforced

// Client Usage
const user = yield* client.users.findById({ path: { id: 123 } })
// user is typed as User
// Error type is UserNotFoundError | ParseError

// Compile error (type safety):
const user = yield* client.users.findById({ path: { id: "123" } })  // ❌ string not number
const user = yield* client.users.findById({})  // ❌ missing path
```

## 5. Best Practices for Project Organization

### Directory Structure

```
src/
├── api/
│   ├── schemas/
│   │   ├── errors.ts       # Error definitions
│   │   ├── models.ts       # Data model classes
│   │   └── index.ts        # Re-exports
│   ├── endpoints/
│   │   ├── users.ts        # UsersApi group
│   │   ├── posts.ts        # PostsApi group
│   │   └── index.ts        # Combined Api
│   └── middleware/
│       ├── auth.ts         # Auth middleware
│       └── logging.ts      # Logging middleware
├── server/
│   ├── handlers/
│   │   ├── users.ts        # User handlers
│   │   ├── posts.ts        # Post handlers
│   │   └── index.ts        # All handler layers
│   └── index.ts            # Server entry
└── client/
    └── api.ts              # Client instantiation
```

### Schema Organization

```typescript
// api/schemas/errors.ts
export class NotFoundError extends Schema.TaggedClass<NotFoundError>()("NotFoundError", {}) {}

export class ValidationError extends Schema.TaggedClass<ValidationError>()("ValidationError", {
  message: Schema.String,
}) {}

// api/schemas/models.ts
export class User extends Schema.Class<User>("User")({
  id: Schema.Int,
  email: Schema.String,
  name: Schema.String,
}) {}

// api/endpoints/users.ts
import * as Schemas from "../schemas/index.js";

export class UsersApi extends HttpApiGroup.make("users")
  .add(
    HttpApiEndpoint.get("findById")`/${HttpApiSchema.param("id", Schema.Int)}`
      .addSuccess(Schemas.User)
      .addError(Schemas.NotFoundError),
  )
  .add(
    HttpApiEndpoint.post("create")`/`
      .setPayload(
        Schema.Struct({
          email: Schema.String,
          name: Schema.String,
        }),
      )
      .addSuccess(Schemas.User)
      .addError(Schemas.ValidationError),
  )
  .prefix("/users") {}
```

### Handler Organization

```typescript
// server/handlers/users.ts
import { Api } from "../api/index.js";

export const UsersLive = HttpApiBuilder.group(Api, "users", (handlers) =>
  Effect.gen(function* () {
    const db = yield* Database;
    return handlers
      .handle("findById", ({ path }) =>
        db.users.findById(path.id).pipe(Effect.orElse(() => Effect.fail(new NotFoundError()))),
      )
      .handle("create", ({ payload }) => db.users.create(payload));
  }),
).pipe(Layer.provide(Database.layer));

// server/handlers/index.ts
export const AllHandlers = Layer.mergeAll(UsersLive, PostsLive, CommentsLive);
```

### Client Usage Pattern

```typescript
// client/api.ts
import { Api } from "../api/index.js";

export const createClient = Effect.gen(function* () {
  const httpClient = yield* HttpClient.HttpClient;
  return yield* HttpApiClient.make(Api, { httpClient });
});

// In your code
const client = yield * createClient;
const user = yield * client.users.findById({ path: { id: 1 } });
```

## 6. Security & Middleware

### API Key Security

```typescript
const securityHeader = HttpApiSecurity.apiKey({
  in: "header",
  key: "x-api-key",
});

const securityQuery = HttpApiSecurity.apiKey({
  in: "query",
  key: "api_key",
});

const securityCookie = HttpApiSecurity.apiKey({
  in: "cookie",
  key: "token",
});
```

### Middleware Definition

```typescript
class Authorization extends HttpApiMiddleware.Tag<Authorization>()(
  "Authorization",
  {
    security: {
      cookie: HttpApiSecurity.apiKey({
        in: "cookie",
        key: "token"
      })
    },
    provides: CurrentUser  // Context tag provided to handlers
  }
) {}

// Apply to group
class ProtectedApi extends HttpApiGroup.make("protected")
  .add(...)
  .middleware(Authorization)
{}

// Handlers receive CurrentUser:
handlers.handle("getProfile", Effect.gen(function*() {
  const user = yield* CurrentUser  // Injected by middleware
  return user
}))
```

## 7. Complete Working Example

From priorart/effect test suite:

```typescript
// 1. Define schemas
class User extends Schema.Class<User>("User")({
  id: Schema.Int,
  name: Schema.String,
  createdAt: Schema.DateTimeUtc,
}) {}

class UserError extends Schema.TaggedClass<UserError>()("UserError", {}) {}

// 2. Define endpoints
class UsersApi extends HttpApiGroup.make("users")
  .add(
    HttpApiEndpoint.get(
      "findById",
    )`/${HttpApiSchema.param("id", Schema.NumberFromString)}`.addSuccess(User),
  )
  .add(
    HttpApiEndpoint.post("create")`/`
      .setPayload(Schema.Struct(Struct.pick(User.fields, "name")))
      .setUrlParams(Schema.Struct({ id: Schema.NumberFromString }))
      .addSuccess(User)
      .addError(UserError),
  )
  .middleware(Authorization)
  .prefix("/users") {}

// 3. Create API
class Api extends HttpApi.make("api").add(UsersApi) {}

// 4. Implement handlers
const HttpUsersLive = HttpApiBuilder.group(Api, "users", (handlers) =>
  Effect.gen(function* () {
    const repo = yield* UserRepo;
    return handlers
      .handle("findById", ({ path }) =>
        repo.findById(path.id).pipe(Effect.orElse(() => Effect.fail(new UserError()))),
      )
      .handle("create", ({ payload, urlParams }) =>
        repo.create({
          id: urlParams.id,
          name: payload.name,
          createdAt: new Date(),
        }),
      );
  }),
).pipe(Layer.provide(UserRepo.Live));

// 5. Use client
const client = yield * HttpApiClient.make(Api);
const user = yield * client.users.findById({ path: { id: 123 } });
const newUser =
  yield *
  client.users.create({
    urlParams: { id: 1 },
    payload: { name: "John" },
  });
```

## Summary

**Key Takeaways:**

1. **Type Safety**: Types flow from endpoint definitions → server → client automatically
2. **No Duplication**: Define schemas once; used everywhere
3. **Validation Built-in**: Automatic codec generation from schemas
4. **Composable**: Mix APIs, groups, and endpoints flexibly
5. **Middleware**: Security, logging, etc. as first-class concerns
6. **Client Gen**: Full type-safe client with no code generation step
7. **Errors**: First-class error types with HTTP status codes
8. **Flexibility**: Return typed responses or raw HttpServerResponse

This is production-ready and used extensively in the Effect/io ecosystem.
