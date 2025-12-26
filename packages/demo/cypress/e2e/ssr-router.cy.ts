/**
 * SSR Router E2E tests
 *
 * Tests SSR integration with the router:
 * - Router.serverLayer renders route with loader data
 * - Hydration reuses server loader data (no fetch)
 * - Client navigation after hydration runs loader
 */

describe("SSR Router", () => {
  describe("serverLayer - SSR rendering", () => {
    beforeEach(() => {
      // Visit SSR-rendered router page
      cy.visit("http://localhost:5173/ssr/router");
    });

    it("should render route with loader data from server", () => {
      // Server should have matched "/" route and run its loader
      cy.getCy("ssr-router-page").should("exist");
      cy.getCy("current-route-name").should("contain", "home");
      cy.getCy("loader-data-message").should("contain", "Hello from server loader");
    });

    it("should render correct route based on pathname", () => {
      // Navigate to a different SSR route
      cy.visit("http://localhost:5173/ssr/router/posts");
      cy.getCy("current-route-name").should("contain", "posts");
      cy.getCy("loader-data-count").should("contain", "3");
    });

    it("should pass path params to loader", () => {
      cy.visit("http://localhost:5173/ssr/router/posts/42");
      cy.getCy("current-route-name").should("contain", "post");
      cy.getCy("post-id").should("contain", "42");
      // Verify the ID is a number (decoded by schema)
      cy.getCy("post-id-type").should("contain", "number");
    });
  });

  describe("browserLayer - Hydration", () => {
    beforeEach(() => {
      cy.visit("http://localhost:5173/ssr/router");
    });

    it("should hydrate and preserve server-rendered content", () => {
      // Content should match server-rendered
      cy.getCy("current-route-name").should("contain", "home");
      cy.getCy("loader-data-message").should("contain", "Hello from server loader");

      // Links should be interactive after hydration
      cy.getCy("nav-link-posts").should("exist").click();
      cy.getCy("current-route-name").should("contain", "posts");
    });

    it("should not re-run loader during initial hydration", () => {
      // Server provides dehydrated loader data
      // Client hydration should reuse it, not re-fetch
      // The message should still be from server, not client
      cy.getCy("loader-data-message").should("contain", "Hello from server loader");
      cy.getCy("loader-data-source").should("contain", "server");
    });
  });

  describe("Client navigation after hydration", () => {
    beforeEach(() => {
      cy.visit("http://localhost:5173/ssr/router");
      // Wait for links to be interactive (hydration complete)
      cy.getCy("nav-link-posts").should("exist");
    });

    it("should run loader on client navigation", () => {
      // Click link to navigate to posts
      cy.getCy("nav-link-posts").click();

      // Should show posts route
      cy.getCy("current-route-name").should("contain", "posts");

      // Loader should have run on client
      cy.getCy("loader-data-count").should("contain", "3");
    });

    it("should update URL on navigation", () => {
      cy.getCy("nav-link-posts").click();
      cy.url().should("include", "/posts");
    });

    it("should handle back navigation", () => {
      // Navigate to posts
      cy.getCy("nav-link-posts").click();
      cy.getCy("current-route-name").should("contain", "posts");

      // Go back
      cy.go("back");
      cy.getCy("current-route-name").should("contain", "home");
    });
  });
});
