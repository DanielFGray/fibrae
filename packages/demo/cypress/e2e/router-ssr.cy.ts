/**
 * SSR Router & RouterBuilder E2E Tests
 *
 * Tests SSR integration with the router and the RouterBuilder handler pattern.
 */

describe("SSR Router", () => {
  // ===========================================================================
  // serverLayer - SSR rendering
  // ===========================================================================

  describe("serverLayer - SSR rendering", () => {
    beforeEach(() => {
      cy.visit("http://localhost:5173/ssr/router");
    });

    it("should render route with loader data from server", () => {
      cy.getCy("ssr-router-page").should("exist");
      cy.getCy("current-route-name").should("contain", "home");
      cy.getCy("loader-data-message").should("contain", "Hello from server loader");
    });

    it("should render correct route based on pathname", () => {
      cy.visit("http://localhost:5173/ssr/router/posts");
      cy.getCy("current-route-name").should("contain", "posts");
      cy.getCy("loader-data-count").should("contain", "3");
    });

    it("should pass path params to loader", () => {
      cy.visit("http://localhost:5173/ssr/router/posts/42");
      cy.getCy("current-route-name").should("contain", "post");
      cy.getCy("post-id").should("contain", "42");
      cy.getCy("post-id-type").should("contain", "number");
    });
  });

  // ===========================================================================
  // browserLayer - Hydration
  // ===========================================================================

  describe("browserLayer - Hydration", () => {
    beforeEach(() => {
      cy.visit("http://localhost:5173/ssr/router");
    });

    it("should hydrate and preserve server-rendered content", () => {
      cy.getCy("current-route-name").should("contain", "home");
      cy.getCy("loader-data-message").should("contain", "Hello from server loader");

      cy.getCy("nav-link-posts").should("exist").click();
      cy.getCy("current-route-name").should("contain", "posts");
    });

    it("should not re-run loader during initial hydration", () => {
      cy.getCy("loader-data-message").should("contain", "Hello from server loader");
      cy.getCy("loader-data-source").should("contain", "server");
    });
  });

  // ===========================================================================
  // Client navigation after hydration
  // ===========================================================================

  describe("Client navigation after hydration", () => {
    beforeEach(() => {
      cy.visit("http://localhost:5173/ssr/router");
      cy.getCy("nav-link-posts").should("exist");
    });

    it("should run loader on client navigation", () => {
      cy.getCy("nav-link-posts").click();

      cy.getCy("current-route-name").should("contain", "posts");
      cy.getCy("loader-data-count").should("contain", "3");
    });

    it("should update URL on navigation", () => {
      cy.getCy("nav-link-posts").click();
      cy.url().should("include", "/posts");
    });

    it("should handle back navigation", () => {
      cy.getCy("nav-link-posts").click();
      cy.getCy("current-route-name").should("contain", "posts");

      cy.go("back");
      cy.getCy("current-route-name").should("contain", "home");
    });
  });
});

// =============================================================================
// RouterBuilder handler pattern
// =============================================================================

describe("RouterBuilder", () => {
  beforeEach(() => {
    cy.visit("http://localhost:5173/router-builder-test.html");
  });

  describe("loader execution", () => {
    it("should execute loader and pass data to component", () => {
      cy.getCy("home-loader-data").should("contain", "Welcome Home");
    });

    it("should pass path params to loader", () => {
      cy.getCy("post-id").should("contain", "123");
    });

    it("should pass decoded path params to component", () => {
      cy.getCy("post-id-type").should("contain", "number");
    });
  });

  describe("search params", () => {
    it("should pass search params to loader", () => {
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
