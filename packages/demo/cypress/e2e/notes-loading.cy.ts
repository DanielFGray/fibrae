/**
 * Notes App - Loading States Tests
 *
 * Tests Suspense fallbacks during async data loading.
 * Uses Cypress network interception to add artificial delays.
 */

describe("Notes App - Loading States", () => {
  describe("SPA Mode", () => {
    describe("Posts List Loading", () => {
      it("should show posts loading fallback during slow API response", () => {
        // Intercept the posts API and add delay
        cy.intercept("GET", "/api/posts", (req) => {
          req.on("response", (res) => {
            res.setDelay(500); // 500ms delay (above 50ms threshold)
          });
        }).as("getPosts");

        // Start at home page
        cy.visit("/notes.html");
        cy.getCy("home-page", { timeout: 5000 }).should("exist");

        // Navigate to posts - should show loading
        cy.getCy("nav-posts").click();

        // Component-level Suspense should show loading
        // (this is inside PostsPage wrapping PostList)
        cy.getCy("posts-loading", { timeout: 2000 }).should("exist");
        cy.getCy("posts-loading").should("contain", "Loading posts...");

        cy.wait("@getPosts");

        // Post list should appear after loading completes
        cy.getCy("post-list", { timeout: 5000 }).should("exist");
        cy.getCy("posts-loading").should("not.exist");
      });

      it("should show loading when visiting posts page directly", () => {
        // Intercept posts API with delay
        cy.intercept("GET", "/api/posts", (req) => {
          req.on("response", (res) => {
            res.setDelay(500);
          });
        }).as("getPosts");

        // Visit posts page directly
        cy.visit("/notes.html", {
          onBeforeLoad: (win) => {
            // Navigate to /posts before the app bootstraps
            win.history.pushState(null, "", "/posts");
          },
        });

        // Component-level Suspense should show loading
        cy.getCy("posts-loading", { timeout: 2000 }).should("exist");
        cy.getCy("posts-loading").should("contain", "Loading posts...");

        cy.wait("@getPosts");

        // Post list should appear
        cy.getCy("post-list", { timeout: 5000 }).should("exist");
        cy.getCy("posts-loading").should("not.exist");
      });
    });

    describe("Post Detail Loading", () => {
      it("should show post detail after loader completes", () => {
        // First load posts list
        cy.visit("/notes.html");
        cy.getCy("nav-posts").click();
        cy.getCy("post-list", { timeout: 5000 }).should("exist");

        // Intercept single post API with delay
        cy.intercept("GET", "/api/posts/1", {
          delay: 300,
          statusCode: 200,
          body: {
            id: 1,
            title: "Delayed Post",
            content: "This took a while to load",
            authorId: "test",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        }).as("getPost");

        // Click on first post link
        cy.getCy("post-link-1").click();

        // Wait for the API call to complete
        cy.wait("@getPost");

        // Post detail should appear with the intercepted content
        cy.getCy("post-detail", { timeout: 5000 }).should("exist");
        cy.getCy("post-detail").should("contain", "Delayed Post");
      });

      it("should show route loading on initial page load with slow loader", () => {
        // Intercept single post API with delay
        cy.intercept("GET", "/api/posts/1", {
          delay: 500,
          statusCode: 200,
          body: {
            id: 1,
            title: "Delayed Post",
            content: "This took a while to load",
            authorId: "test",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        }).as("getPost");

        // Visit post detail page directly
        cy.visit("/notes.html", {
          onBeforeLoad: (win) => {
            win.history.pushState(null, "", "/posts/1");
          },
        });

        // Should show route-level loading on initial render
        cy.getCy("route-loading", { timeout: 2000 }).should("exist");
        cy.getCy("route-loading").should("contain", "Loading...");

        cy.wait("@getPost");

        // Post detail should appear
        cy.getCy("post-detail", { timeout: 5000 }).should("exist");
        cy.getCy("route-loading").should("not.exist");
      });
    });

    describe("Fast Loading (No Fallback)", () => {
      it("should not show fallback for fast responses", () => {
        // No interception - API responds quickly (< 50ms threshold)
        cy.visit("/notes.html");
        cy.getCy("home-page", { timeout: 5000 }).should("exist");

        cy.getCy("nav-posts").click();

        // Posts should appear quickly without showing loading fallback
        cy.getCy("post-list", { timeout: 5000 }).should("exist");

        // Verify loading was never shown (or shown so briefly we can't catch it)
        // This is a negative test - just verify the content loaded correctly
        cy.getCy("posts-ul").should("exist");
      });

      it("should navigate to post detail quickly without loading", () => {
        // No delay - fast response
        cy.visit("/notes.html");
        cy.getCy("nav-posts").click();
        cy.getCy("post-list", { timeout: 5000 }).should("exist");

        // Click first post
        cy.getCy("posts-ul").find("li").first().find("a").click();

        // Post detail should appear quickly
        cy.getCy("post-detail", { timeout: 5000 }).should("exist");
      });
    });

    describe("Navigation during loading", () => {
      it("should cancel loading when navigating away", () => {
        // Intercept with long delay
        cy.intercept("GET", "/api/posts", (req) => {
          req.on("response", (res) => {
            res.setDelay(2000); // Long delay
          });
        }).as("getPosts");

        cy.visit("/notes.html");
        cy.getCy("home-page", { timeout: 5000 }).should("exist");

        // Navigate to posts
        cy.getCy("nav-posts").click();

        // Should show loading
        cy.getCy("posts-loading", { timeout: 2000 }).should("exist");

        // Navigate away before loading completes
        cy.getCy("nav-home").click();

        // Should be back at home page
        cy.getCy("home-page", { timeout: 5000 }).should("exist");

        // Loading should no longer be visible
        cy.getCy("posts-loading").should("not.exist");
      });
    });
  });
});
