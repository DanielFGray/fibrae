import { h as H } from "fibrae";
import { Route } from "fibrae/router";

export function RouterRouteDemo() {
  // Test 1: Static route
  const homeRoute = Route.get("home", "/");
  const match1 = homeRoute.match("/");

  // Test 2: Dynamic route with param
  const postRoute = Route.get("post", "/posts/:id");
  const match2 = postRoute.match("/posts/123");

  // Test 3: Interpolate URL
  const url3 = postRoute.interpolate({ id: 456 });

  return H("div", {}, [
    H("h1", {}, ["Route Module Tests"]),
    H("div", {}, [
      H("h2", {}, ["Test 1: Static Route Matching"]),
      H("p", {}, [`Match "/" against "home" route: ${match1.toString()}`]),
    ]),
    H("div", {}, [
      H("h2", {}, ["Test 2: Dynamic Route Matching"]),
      H("p", {}, [`Match "/posts/123" against "post" route: ${match2.toString()}`]),
      match2._tag === "Some" && H("p", {}, [`Extracted ID: ${(match2.value as { id?: string }).id}`]),
    ]),
    H("div", {}, [
      H("h2", {}, ["Test 3: URL Interpolation"]),
      H("p", {}, [`Interpolate {id: 456}: ${url3}`]),
    ]),
  ]);
}
