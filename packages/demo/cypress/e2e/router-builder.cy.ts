/**
 * RouterBuilder E2E tests
 *
 * Tests the handler implementation pattern:
 * - RouterBuilder.group(router, "groupName", (handlers) => ...)
 * - handlers.handle("routeName", { loader, component })
 * - Loaders receive { path, searchParams } and return Effect<TData>
 * - Components receive { loaderData, path, searchParams } props
 */

describe("RouterBuilder module", () => {
  beforeEach(() => {
    cy.visit("http://localhost:5173/router-builder-test.html");
  });

  describe("loader execution", () => {
    it("should execute loader and pass data to component", () => {
      // Verify component receives loader data
      cy.getCy("home-loader-data").should("contain", "Welcome Home");
    });

    it("should pass path params to loader", () => {
      // The test page should show a post with ID from path
      cy.getCy("post-id").should("contain", "123");
    });

    it("should pass decoded path params to component", () => {
      // Component should receive typed params (number, not string)
      cy.getCy("post-id-type").should("contain", "number");
    });
  });

  describe("search params", () => {
    it("should pass search params to loader", () => {
      // Test page renders with search params
      cy.getCy("search-sort").should("contain", "date");
    });

    it("should pass decoded search params to component", () => {
      cy.getCy("search-page").should("contain", "2");
      cy.getCy("search-page-type").should("contain", "number");
    });
  });

  describe("component rendering", () => {
    it("should render component with loaderData prop", () => {
      cy.getCy("posts-count").should("contain", "3");
    });

    it("should render component from matched route", () => {
      cy.getCy("current-route").should("contain", "posts");
    });
  });
});
