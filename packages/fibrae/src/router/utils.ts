/**
 * Shared router utilities.
 *
 * Consolidates duplicated helpers from Router, Navigator, and Link modules.
 */

import * as Option from "effect/Option";
import type { Route } from "./Route.js";
import type { Router, AnyGroup } from "./Router.js";

/**
 * Parse URL search string to a record.
 * Handles both "?foo=bar" and "foo=bar" formats.
 */
export const parseSearchParams = (search: string): Record<string, string> =>
  Object.fromEntries(new URLSearchParams(search));

/**
 * Build a search string from a params record.
 * Returns "" if no params, or "?key=value&..." otherwise.
 * Filters out null and undefined values.
 */
export const buildSearchString = (params: Record<string, unknown>): string => {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null);
  if (entries.length === 0) return "";
  const sp = new URLSearchParams(entries.map(([k, v]) => [k, String(v)]));
  return `?${sp.toString()}`;
};

/**
 * Strip basePath prefix from pathname for route matching.
 * Returns "/" (not "") when pathname exactly equals basePath.
 */
export const stripBasePath = (pathname: string, basePath: string): string => {
  if (!basePath || basePath === "/") return pathname;
  const normalizedBase = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;
  if (pathname.startsWith(normalizedBase)) {
    return pathname.slice(normalizedBase.length) || "/";
  }
  return pathname;
};

/**
 * Find a route by name across all groups in a router.
 * Returns the route and its group's basePath (empty string for non-layout groups).
 */
export const findRouteByName = (
  router: Router,
  name: string,
): Option.Option<{ route: Route; group: AnyGroup }> =>
  Option.fromNullable(
    router.groups
      .flatMap((group) =>
        group.routes.filter((route) => route.name === name).map((route) => ({ route, group })),
      )
      .at(0),
  );

/**
 * Get the basePath for a group (layout groups have one, regular groups don't).
 */
export const groupBasePath = (group: AnyGroup): string =>
  group._tag === "LayoutGroup" ? group.basePath : "";
