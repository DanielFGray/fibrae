import { describe, test, expect } from "bun:test";
import * as Option from "effect/Option";
import * as Route from "./Route.js";
import * as Router from "./Router.js";

describe("Router module", () => {
  describe("route groups", () => {
    test("Router.group creates a group", () => {
      const appGroup = Router.group("app");
      expect(appGroup.name).toBe("app");
      expect(appGroup.routes.length).toBe(0);
    });

    test("group.add adds routes", () => {
      const home = Route.get("home", "/");
      const appGroup = Router.group("app").add(home);
      expect(appGroup.routes.length).toBe(1);
      expect(appGroup.routes[0]).toBe(home);
    });

    test("group.add is chainable", () => {
      const home = Route.get("home", "/");
      const about = Route.get("about", "/about");
      const appGroup = Router.group("app").add(home).add(about);
      expect(appGroup.routes.length).toBe(2);
    });
  });

  describe("routers", () => {
    test("Router.make creates a router", () => {
      const router = Router.make("app");
      expect(router.name).toBe("app");
      expect(router.groups.length).toBe(0);
    });

    test("router.add adds groups", () => {
      const home = Route.get("home", "/");
      const group = Router.group("app").add(home);
      const router = Router.make("app").add(group);
      expect(router.groups.length).toBe(1);
      expect(router.groups[0]).toBe(group);
    });

    test("router.add is chainable", () => {
      const appGroup = Router.group("app").add(Route.get("home", "/"));
      const apiGroup = Router.group("api").add(Route.get("users", "/api/users"));
      const router = Router.make("root").add(appGroup).add(apiGroup);
      expect(router.groups.length).toBe(2);
    });
  });

  describe("route matching", () => {
    test("router.matchRoute finds matching routes", () => {
      const home = Route.get("home", "/");
      const group = Router.group("app").add(home);
      const router = Router.make("root").add(group);

      const match = router.matchRoute("/");
      expect(Option.isSome(match)).toBe(true);
      expect(match.value.route.name).toBe("home");
      expect(match.value.groupName).toBe("app");
    });

    test("router.matchRoute returns None for unmatched paths", () => {
      const home = Route.get("home", "/");
      const group = Router.group("app").add(home);
      const router = Router.make("root").add(group);

      const match = router.matchRoute("/unknown");
      expect(Option.isNone(match)).toBe(true);
    });

    test("router.matchRoute finds correct route among multiple", () => {
      const home = Route.get("home", "/");
      const about = Route.get("about", "/about");
      const posts = Route.get("posts", "/posts");
      const group = Router.group("app").add(home).add(about).add(posts);
      const router = Router.make("root").add(group);

      const match = router.matchRoute("/about");
      expect(Option.isSome(match)).toBe(true);
      expect(match.value.route.name).toBe("about");
    });

    test("router.matchRoute extracts params", () => {
      const post = Route.get("post", "/posts/:id");
      const group = Router.group("app").add(post);
      const router = Router.make("root").add(group);

      const match = router.matchRoute("/posts/123");
      expect(Option.isSome(match)).toBe(true);
      expect(match.value.params.id).toBe("123");
    });

    test("router.matchRoute searches across multiple groups", () => {
      const home = Route.get("home", "/");
      const appGroup = Router.group("app").add(home);
      const users = Route.get("users", "/api/users");
      const apiGroup = Router.group("api").add(users);
      const router = Router.make("root").add(appGroup).add(apiGroup);

      const match1 = router.matchRoute("/");
      expect(Option.isSome(match1)).toBe(true);
      expect(match1.value.route.name).toBe("home");
      expect(match1.value.groupName).toBe("app");

      const match2 = router.matchRoute("/api/users");
      expect(Option.isSome(match2)).toBe(true);
      expect(match2.value.route.name).toBe("users");
      expect(match2.value.groupName).toBe("api");
    });
  });

  describe("layout groups", () => {
    test("Router.layout creates a layout group", () => {
      const dashboardLayout = Router.layout("dashboard", "/dashboard");
      expect(dashboardLayout.name).toBe("dashboard");
      expect(dashboardLayout.basePath).toBe("/dashboard");
      expect(dashboardLayout._tag).toBe("LayoutGroup");
      expect(dashboardLayout.routes.length).toBe(0);
    });

    test("layout.add adds routes", () => {
      const overview = Route.get("overview", "/overview");
      const dashboardLayout = Router.layout("dashboard", "/dashboard").add(overview);
      expect(dashboardLayout.routes.length).toBe(1);
      expect(dashboardLayout.routes[0]).toBe(overview);
    });

    test("layout.add is chainable", () => {
      const overview = Route.get("overview", "/overview");
      const settings = Route.get("settings", "/settings");
      const dashboardLayout = Router.layout("dashboard", "/dashboard")
        .add(overview)
        .add(settings);
      expect(dashboardLayout.routes.length).toBe(2);
    });

    test("router.matchRoute matches layout routes with basePath prefix", () => {
      const overview = Route.get("overview", "/overview");
      const settings = Route.get("settings", "/settings");
      const dashboardLayout = Router.layout("dashboard", "/dashboard")
        .add(overview)
        .add(settings);
      const router = Router.make("root").add(dashboardLayout);

      // Should match /dashboard/overview
      const match1 = router.matchRoute("/dashboard/overview");
      expect(Option.isSome(match1)).toBe(true);
      expect(match1.value.route.name).toBe("overview");
      expect(match1.value.groupName).toBe("dashboard");
      expect(match1.value.layouts.length).toBe(1);
      expect(match1.value.layouts[0].name).toBe("dashboard");

      // Should match /dashboard/settings
      const match2 = router.matchRoute("/dashboard/settings");
      expect(Option.isSome(match2)).toBe(true);
      expect(match2.value.route.name).toBe("settings");
      expect(match2.value.layouts.length).toBe(1);

      // Should NOT match /overview (without /dashboard prefix)
      const noMatch = router.matchRoute("/overview");
      expect(Option.isNone(noMatch)).toBe(true);
    });

    test("regular routes have empty layouts array", () => {
      const home = Route.get("home", "/");
      const group = Router.group("app").add(home);
      const router = Router.make("root").add(group);

      const match = router.matchRoute("/");
      expect(Option.isSome(match)).toBe(true);
      expect(match.value.layouts.length).toBe(0);
    });

    test("layout basePath is normalized", () => {
      // Without leading slash
      const layout1 = Router.layout("admin", "admin");
      expect(layout1.basePath).toBe("/admin");

      // With trailing slash
      const layout2 = Router.layout("admin", "/admin/");
      expect(layout2.basePath).toBe("/admin");
    });
  });
});
