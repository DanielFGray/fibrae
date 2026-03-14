import { h as H } from "fibrae";
import { Route } from "fibrae/router";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

export function RouterRouteDemo() {
  return Effect.gen(function* () {
    // Test 1: Static route
    const homeRoute = Route.get("home", "/");
    const match1 = yield* homeRoute.match("/");

    // Test 2: Dynamic route with param
    const postRoute = Route.get("post", "/posts/:id");
    const match2 = yield* postRoute.match("/posts/123");

    // Test 3: Interpolate URL
    const url3 = yield* postRoute.interpolate({ id: 456 });

    return H("div", {}, [
      H("h1", {}, ["Route Module Tests"]),
      H("div", {}, [
        H("h2", {}, ["Test 1: Static Route Matching"]),
        H("p", {}, [`Match "/" against "home" route: ${match1.toString()}`]),
      ]),
      H("div", {}, [
        H("h2", {}, ["Test 2: Dynamic Route Matching"]),
        H("p", {}, [`Match "/posts/123" against "post" route: ${match2.toString()}`]),
        Option.isSome(match2) &&
          H("p", {}, [`Extracted ID: ${(match2.value as { id?: string }).id}`]),
      ]),
      H("div", {}, [
        H("h2", {}, ["Test 3: URL Interpolation"]),
        H("p", {}, [`Interpolate {id: 456}: ${url3}`]),
      ]),
    ]);
  });
}
