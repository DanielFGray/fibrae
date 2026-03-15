/**
 * Route declaration module for Fibrae router.
 *
 * Mirrors Effect HttpApiEndpoint patterns:
 * - Route.get("name", "/path") for static routes
 * - Route.get("name")`/path/${param}` for dynamic routes with template literals
 * - Route.param for schema-validated path parameters
 * - .setSearchParams for query string validation
 */

import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import * as Effect from "effect/Effect";

/**
 * Annotation symbol for storing parameter name in schema metadata.
 * Mirrors HttpApiSchema.AnnotationParam pattern.
 */
export const AnnotationParam: unique symbol = Symbol.for("fibrae/Route/AnnotationParam");

/**
 * Typed error for route operations (interpolation, matching failures).
 */
export class RouteError extends Schema.TaggedError<RouteError>()("RouteError", {
  message: Schema.String,
}) {}

/**
 * Represents a single route with path and optional search params validation.
 * This is immutable data that describes a route.
 */
export interface Route<
  Name extends string = string,
  PathParams extends Record<string, unknown> = Record<string, unknown>,
  SearchParams extends Record<string, unknown> = Record<string, unknown>,
> {
  readonly name: Name;
  readonly path: string;
  readonly pathSchema: Option.Option<Schema.Schema<PathParams>>;
  readonly searchSchema: Option.Option<Schema.Schema<SearchParams>>;

  /**
   * Match a pathname against this route.
   * Returns the decoded path parameters if matched, None otherwise.
   * Uses Schema.decodeUnknown (Effect-returning) for path param validation.
   */
  readonly match: (pathname: string) => Effect.Effect<Option.Option<PathParams>>;

  /**
   * Build a URL from path parameters.
   * Fails with RouteError if required params are missing.
   */
  readonly interpolate: (params: PathParams) => Effect.Effect<string, RouteError>;

  /**
   * Set search parameter schema for this route.
   */
  readonly setSearchParams: <NewSearch extends Record<string, unknown>>(
    schema: Schema.Schema<NewSearch>,
  ) => Route<Name, PathParams, NewSearch>;
}

/**
 * Parse path template to extract param names and build a URL pattern.
 *
 * Example: "/posts/:id/comments/:commentId" → { paramNames: ["id", "commentId"], pattern: ... }
 */
function parsePathTemplate(
  segments: TemplateStringsArray,
  schemas: ReadonlyArray<Schema.Schema.Any>,
): {
  path: string;
  paramNames: string[];
  pathSchema: Option.Option<Schema.Schema.Any>;
} {
  const paramNames = schemas.map((schema, i) => getParamName(schema) ?? String(i));

  const path = segments[0] + schemas.map((_, i) => `:${paramNames[i]}${segments[i + 1]}`).join("");

  const pathSchemaObj = Object.fromEntries(paramNames.map((name, i) => [name, schemas[i]]));

  const pathSchema =
    paramNames.length > 0
      ? Option.some(Schema.Struct(pathSchemaObj as Record<string, Schema.Schema.Any>))
      : Option.none<Schema.Schema.Any>();

  return { path, paramNames, pathSchema };
}

/**
 * Get param name from a Schema's annotations.
 * Mirrors HttpApiSchema.getParam pattern.
 */
function getParamName(schema: Schema.Schema.Any): string | undefined {
  const ast = schema.ast;
  const annotations: Record<string | symbol, unknown> = ast.annotations;
  const paramAnnotation = annotations[AnnotationParam] as { name: string } | undefined;
  return paramAnnotation?.name;
}

/**
 * Match a pathname against a route pattern.
 * Pattern: "/posts/:id/comments/:commentId"
 * Pathname: "/posts/123/comments/456"
 * Returns: { id: "123", commentId: "456" }
 *
 * Uses Schema.decodeUnknown (Effect-returning) for path param validation.
 */
function matchPath(
  pattern: string,
  pathname: string,
  pathSchema: Option.Option<Schema.Schema.Any>,
): Effect.Effect<Option.Option<Record<string, unknown>>> {
  // Convert pattern with :params to regex
  const regexPattern = pattern.replace(/:(\w+)/g, "(?<$1>[^/]+)");
  const regex = new RegExp(`^${regexPattern}/?$`);
  const match = pathname.match(regex);

  if (!match) {
    return Effect.succeed(Option.none());
  }

  const params = match.groups ?? {};

  // Decode and validate with schema if present.
  // Cast to Effect<unknown, unknown> to erase the Schema.Any's `any` R parameter,
  // since route schemas never have Effect requirements.
  if (Option.isSome(pathSchema)) {
    return (Schema.decodeUnknown(pathSchema.value)(params) as Effect.Effect<unknown, unknown>).pipe(
      Effect.map((decoded) => Option.some(decoded as Record<string, unknown>)),
      Effect.catchAll(() => Effect.succeed(Option.none<Record<string, unknown>>())),
    );
  }

  return Effect.succeed(Option.some(params));
}

/**
 * Build a URL from a route pattern and parameters.
 * Pattern: "/posts/:id/comments/:commentId"
 * Params: { id: 123, commentId: 456 }
 * Returns: "/posts/123/comments/456"
 */
function interpolatePath(
  pattern: string,
  params: Record<string, unknown>,
): Effect.Effect<string, RouteError> {
  const segments: string[] = [];
  const paramPattern = /:(\w+)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = paramPattern.exec(pattern)) !== null) {
    segments.push(pattern.slice(lastIndex, match.index));
    const key = match[1];
    const value = params[key];
    if (value === undefined) {
      return Effect.fail(new RouteError({ message: `Missing required parameter: ${key}` }));
    }
    segments.push(String(value));
    lastIndex = paramPattern.lastIndex;
  }
  segments.push(pattern.slice(lastIndex));

  return Effect.succeed(segments.join(""));
}

/**
 * Constructor for building routes with different method types.
 * Supports both static paths and template literal syntax.
 */
export interface RouteConstructor {
  <const Name extends string>(name: Name, path: string): Route<Name, {}, {}>;

  <const Name extends string>(
    name: Name,
  ): <const T extends readonly any[]>(
    segments: TemplateStringsArray,
    ...params: T
  ) => Route<Name, Record<string, unknown>, {}>;
}

/**
 * Create a route with static path.
 */
function makeRoute<
  Name extends string,
  PathParams extends Record<string, unknown> = {},
  SearchParams extends Record<string, unknown> = {},
>(
  _name: Name,
  path: string,
  pathSchema: Option.Option<Schema.Schema<PathParams>> = Option.none(),
  searchSchema: Option.Option<Schema.Schema<SearchParams>> = Option.none(),
): Route<Name, PathParams, SearchParams> {
  return {
    name: _name,
    path,
    pathSchema,
    searchSchema,
    match: (pathname) =>
      matchPath(path, pathname, pathSchema as Option.Option<Schema.Schema.Any>) as Effect.Effect<
        Option.Option<PathParams>
      >,
    interpolate: (params) => interpolatePath(path, params) as Effect.Effect<string, RouteError>,
    setSearchParams: (schema) => makeRoute(_name, path, pathSchema, Option.some(schema)),
  };
}

/**
 * Create a route getter function supporting both static and template literal syntax.
 */
function makeGetter(): RouteConstructor {
  return ((name: string, path?: string) => {
    // Static path case
    if (typeof path === "string") {
      return makeRoute(name, path);
    }

    // Return template literal handler
    return (segments: TemplateStringsArray, ...schemas: readonly Schema.Schema.Any[]) => {
      const { path: parsedPath, pathSchema } = parsePathTemplate(segments, Array.from(schemas));
      return makeRoute(
        name,
        parsedPath,
        pathSchema as Option.Option<Schema.Schema<Record<string, unknown>>>,
      );
    };
  }) as RouteConstructor;
}

/**
 * Route.get("name", "/path") creates a GET route
 * Route.get("name")`/path/${param}` creates a GET route with typed path params
 */
export const get = makeGetter();

/**
 * Route.post("name", "/path") creates a POST route
 * Route.post("name")`/path/${param}` creates a POST route with typed path params
 */
export const post = makeGetter();

/**
 * Route.param("name", schema) creates a path parameter with validation.
 * Use in template literals: Route.get("name")`/posts/${Route.param("id", Schema.NumberFromString)}`
 *
 * Stores the parameter name in the schema's annotations for extraction during template literal parsing.
 */
export function param<A, I, R>(
  name: string,
  schema: Schema.Schema<A, I, R>,
): Schema.Schema<A, I, R> {
  const annotations: Record<string | symbol, unknown> = {
    [AnnotationParam]: { name, schema },
  };
  return schema.annotations(annotations);
}
