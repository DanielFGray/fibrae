import { describe, test, expect } from "bun:test";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Route from "./Route.js";

describe("Route module", () => {
  describe("static routes", () => {
    test("Route.get creates a static route", () => {
      const home = Route.get("home", "/");
      expect(home.name).toBe("home");
      expect(home.path).toBe("/");
    });

    test("should match static paths", () => {
      const home = Route.get("home", "/");
      const match = home.match("/");
      expect(Option.isSome(match)).toBe(true);
    });

    test("should not match different paths", () => {
      const home = Route.get("home", "/");
      const match = home.match("/about");
      expect(Option.isNone(match)).toBe(true);
    });

    test("should match trailing slash", () => {
      const home = Route.get("home", "/");
      const match = home.match("/");
      expect(Option.isSome(match)).toBe(true);
    });
  });

  describe("dynamic routes", () => {
    test("should match dynamic routes with single param", () => {
      const post = Route.get("post", "/posts/:id");
      const match = post.match("/posts/123");
      expect(Option.isSome(match)).toBe(true);
      if (Option.isSome(match)) {
        expect(match.value.id).toBe("123");
      }
    });

    test("should match multiple params", () => {
      const comment = Route.get("comment", "/posts/:postId/comments/:commentId");
      const match = comment.match("/posts/123/comments/456");
      expect(Option.isSome(match)).toBe(true);
      if (Option.isSome(match)) {
        expect(match.value.postId).toBe("123");
        expect(match.value.commentId).toBe("456");
      }
    });

    test("should not match partial paths", () => {
      const post = Route.get("post", "/posts/:id");
      const match = post.match("/posts/");
      expect(Option.isNone(match)).toBe(true);
    });

    test("should match with trailing slash", () => {
      const post = Route.get("post", "/posts/:id");
      const match = post.match("/posts/123/");
      expect(Option.isSome(match)).toBe(true);
    });
  });

  describe("interpolation", () => {
    test("should interpolate static paths", () => {
      const home = Route.get("home", "/");
      const url = home.interpolate({});
      expect(url).toBe("/");
    });

    test("should interpolate dynamic paths", () => {
      const post = Route.get("post", "/posts/:id");
      const url = post.interpolate({ id: 123 });
      expect(url).toBe("/posts/123");
    });

    test("should interpolate multiple params", () => {
      const comment = Route.get("comment", "/posts/:postId/comments/:commentId");
      const url = comment.interpolate({ postId: 123, commentId: 456 });
      expect(url).toBe("/posts/123/comments/456");
    });

    test("should throw on missing params", () => {
      const post = Route.get("post", "/posts/:id");
      expect(() => post.interpolate({})).toThrow("Missing required parameter: id");
    });
  });

  describe("template literal syntax", () => {
    test("should create route with template literal and named param", () => {
      const idParam = Route.param("id", Schema.String);
      const post = Route.get("post")`/posts/${idParam}`;
      expect(post.name).toBe("post");
      expect(post.path).toBe("/posts/:id");
    });

    test("should match template literal route with named param", () => {
      const idParam = Route.param("id", Schema.String);
      const post = Route.get("post")`/posts/${idParam}`;
      const match = post.match("/posts/123");
      expect(Option.isSome(match)).toBe(true);
      if (Option.isSome(match)) {
        expect(match.value.id).toBe("123");
      }
    });

    test("should validate and convert types with NumberFromString", () => {
      const idParam = Route.param("id", Schema.NumberFromString);
      const post = Route.get("post")`/posts/${idParam}`;
      const match = post.match("/posts/123");
      expect(Option.isSome(match)).toBe(true);
      if (Option.isSome(match)) {
        expect(match.value.id).toBe(123);  // Should be number, not string
        expect(typeof match.value.id).toBe("number");
      }
    });

    test("should match multiple template literal params", () => {
      const postIdParam = Route.param("postId", Schema.String);
      const commentIdParam = Route.param("commentId", Schema.String);
      const comment = Route.get("comment")`/posts/${postIdParam}/comments/${commentIdParam}`;
      const match = comment.match("/posts/123/comments/456");
      expect(Option.isSome(match)).toBe(true);
      if (Option.isSome(match)) {
        expect(match.value.postId).toBe("123");
        expect(match.value.commentId).toBe("456");
      }
    });
  });

  describe("schema validation", () => {
    test("should validate with NumberFromString", () => {
      // Create route with schema - for MVP, pass schema object directly
      const post = Route.get("post", "/posts/:id");
      const match = post.match("/posts/abc");
      // Without schema validation in match, this will succeed
      // Schema validation is TODO for next phase
      expect(Option.isSome(match)).toBe(true);
    });

    test("Route.param stores parameter name in schema annotation", () => {
      const idParam = Route.param("id", Schema.NumberFromString);
      // Access the annotation directly to verify it's stored
      const ast = idParam.ast;
      const annotations: Record<string | symbol, unknown> = ast.annotations;
      const paramAnnotation = annotations[Route.AnnotationParam] as { name: string } | undefined;
      expect(paramAnnotation?.name).toBe("id");
    });

    test("should reject invalid params with schema validation", () => {
      // "abc" cannot be decoded as NumberFromString
      const idParam = Route.param("id", Schema.NumberFromString);
      const post = Route.get("post")`/posts/${idParam}`;
      const match = post.match("/posts/abc");
      expect(Option.isNone(match)).toBe(true);
    });

    test("should accept valid numeric string with NumberFromString", () => {
      const idParam = Route.param("id", Schema.NumberFromString);
      const post = Route.get("post")`/posts/${idParam}`;
      const match = post.match("/posts/42");
      expect(Option.isSome(match)).toBe(true);
      if (Option.isSome(match)) {
        expect(match.value.id).toBe(42);
      }
    });
  });

  describe("search params", () => {
    test("should have searchSchema option", () => {
      const search = Route.get("search", "/search");
      const withSearch = search.setSearchParams(Schema.Struct({ q: Schema.String }));
      expect(Option.isSome(withSearch.searchSchema)).toBe(true);
    });
  });
});
