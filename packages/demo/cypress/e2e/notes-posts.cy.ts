/**
 * Notes App Posts CRUD E2E Tests
 *
 * Tests the Notes demo app's posts functionality:
 * - List posts from API
 * - View post detail
 * - Create new post
 * - Edit existing post
 *
 * SPA mode tests are active. SSR mode tests are skipped until /ssr/notes route is implemented.
 */

describe("Notes App - Posts CRUD", () => {
  // SPA mode tests
  describe("SPA Mode", () => {
    const baseUrl = "http://localhost:5173/notes.html";

    describe("Posts List", () => {
      beforeEach(() => {
        cy.visit(baseUrl);
        // Navigate to posts page
        cy.getCy("nav-posts").click();
      });

      it("should display posts list", () => {
        cy.getCy("posts-page").should("exist");
        cy.getCy("post-list").should("exist");
      });

      it("should show post items from API", () => {
        // Should have at least one post from the seeded data
        cy.getCy("posts-ul").should("exist");
      });

      it("should navigate to post detail when clicking a post", () => {
        // Wait for posts to load and click first one
        cy.getCy("posts-ul").find("li").first().find("a").click();
        cy.getCy("post-detail").should("exist");
        cy.getCy("post-title").should("exist");
      });
    });

    describe("Post Detail", () => {
      it("should display post content", () => {
        cy.visit(baseUrl);
        cy.getCy("nav-posts").click();
        // Click first post
        cy.getCy("posts-ul").find("li").first().find("a").click();

        cy.getCy("post-detail").should("exist");
        cy.getCy("post-title").should("exist");
        cy.getCy("post-content").should("exist");
        cy.getCy("post-author").should("exist");
      });

      it("should have edit link", () => {
        cy.visit(baseUrl);
        cy.getCy("nav-posts").click();
        cy.getCy("posts-ul").find("li").first().find("a").click();

        cy.getCy("edit-post-link").should("exist");
      });

      it("should have back to posts link", () => {
        cy.visit(baseUrl);
        cy.getCy("nav-posts").click();
        cy.getCy("posts-ul").find("li").first().find("a").click();

        cy.getCy("back-to-posts").should("exist").click();
        cy.getCy("post-list").should("exist");
      });
    });

    describe("Create Post", () => {
      beforeEach(() => {
        cy.visit(baseUrl);
        cy.getCy("nav-new-post").click();
      });

      it("should display post form", () => {
        cy.getCy("post-form").should("exist");
        cy.getCy("title-input").should("exist");
        cy.getCy("content-input").should("exist");
        cy.getCy("submit-btn").should("exist");
      });

      it("should show validation error for empty title", () => {
        cy.getCy("submit-btn").click();
        cy.getCy("form-error").should("contain", "Title is required");
      });

      it("should create a new post", () => {
        const testTitle = `Test Post ${Date.now()}`;
        const testContent = "This is test content for the post.";

        cy.getCy("title-input").type(testTitle);
        cy.getCy("content-input").type(testContent);
        cy.getCy("submit-btn").click();

        // Should redirect to posts list after success
        cy.url().should("include", "/posts");
      });

      it("should have cancel link", () => {
        cy.getCy("cancel-link").should("exist").click();
        cy.getCy("post-list").should("exist");
      });
    });

    describe("Home Page", () => {
      it("should display welcome message", () => {
        cy.visit(baseUrl);
        cy.getCy("home-page").should("exist");
        cy.contains("Welcome to Fibrae Notes").should("exist");
      });

      it("should have get started link", () => {
        cy.visit(baseUrl);
        cy.getCy("get-started-link").should("exist").click();
        cy.getCy("posts-page").should("exist");
      });
    });

    describe("Navigation", () => {
      beforeEach(() => {
        cy.visit(baseUrl);
      });

      it("should have all nav links", () => {
        cy.getCy("nav-home").should("exist");
        cy.getCy("nav-posts").should("exist");
        cy.getCy("nav-new-post").should("exist");
      });

      it("should navigate between pages", () => {
        // Go to posts
        cy.getCy("nav-posts").click();
        cy.getCy("posts-page").should("exist");

        // Go to new post
        cy.getCy("nav-new-post").click();
        cy.getCy("post-form").should("exist");

        // Go home
        cy.getCy("nav-home").click();
        cy.getCy("home-page").should("exist");
      });
    });
  });

  // SSR mode tests - skipped until /ssr/notes route is implemented
  describe.skip("SSR Mode", () => {
    const baseUrl = "http://localhost:5173/ssr/notes";

    describe("Posts List", () => {
      beforeEach(() => {
        cy.visit(baseUrl);
        cy.getCy("nav-posts").click();
      });

      it("should display posts list", () => {
        cy.getCy("posts-page").should("exist");
        cy.getCy("post-list").should("exist");
      });
    });
  });
});
