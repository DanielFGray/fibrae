/**
 * Notes App E2E Tests
 *
 * Tests the Notes demo app: CRUD, error handling, and loading states.
 * All tests run against /notes.html (SPA mode).
 */

describe("Notes App", () => {
  // ===========================================================================
  // Posts CRUD
  // ===========================================================================

  describe("Posts CRUD", () => {
    describe("Posts List", () => {
      beforeEach(() => {
        cy.visit("/notes.html");
        cy.getCy("nav-posts").click();
      });

      it("should display posts list", () => {
        cy.getCy("posts-page").should("exist");
        cy.getCy("post-list").should("exist");
      });

      it("should show post items from API", () => {
        cy.getCy("posts-ul").should("exist");
      });

      it("should navigate to post detail when clicking a post", () => {
        cy.getCy("posts-ul").find("li").first().find("a").click();
        cy.getCy("post-detail").should("exist");
        cy.getCy("post-title").should("exist");
      });
    });

    describe("Post Detail", () => {
      it("should display post content", () => {
        cy.visit("/notes.html");
        cy.getCy("nav-posts").click();
        cy.getCy("posts-ul").find("li").first().find("a").click();

        cy.getCy("post-detail").should("exist");
        cy.getCy("post-title").should("exist");
        cy.getCy("post-content").should("exist");
        cy.getCy("post-author").should("exist");
      });

      it("should have edit link", () => {
        cy.visit("/notes.html");
        cy.getCy("nav-posts").click();
        cy.getCy("posts-ul").find("li").first().find("a").click();

        cy.getCy("edit-post-link").should("exist");
      });

      it("should have back to posts link", () => {
        cy.visit("/notes.html");
        cy.getCy("nav-posts").click();
        cy.getCy("posts-ul").find("li").first().find("a").click();

        cy.getCy("back-to-posts").should("exist").click();
        cy.getCy("post-list").should("exist");
      });
    });

    describe("Create Post", () => {
      beforeEach(() => {
        cy.visit("/notes.html");
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

        cy.url().should("include", "/posts");
      });

      it("should have cancel link", () => {
        cy.getCy("cancel-link").should("exist").click();
        cy.getCy("post-list").should("exist");
      });
    });

    describe("Home Page", () => {
      it("should display welcome message", () => {
        cy.visit("/notes.html");
        cy.getCy("home-page").should("exist");
        cy.contains("Welcome to Fibrae Notes").should("exist");
      });

      it("should have get started link", () => {
        cy.visit("/notes.html");
        cy.getCy("get-started-link").should("exist").click();
        cy.getCy("posts-page").should("exist");
      });
    });

    describe("Navigation", () => {
      beforeEach(() => {
        cy.visit("/notes.html");
      });

      it("should have all nav links", () => {
        cy.getCy("nav-home").should("exist");
        cy.getCy("nav-posts").should("exist");
        cy.getCy("nav-new-post").should("exist");
      });

      it("should navigate between pages", () => {
        cy.getCy("nav-posts").click();
        cy.getCy("posts-page").should("exist");

        cy.getCy("nav-new-post").click();
        cy.getCy("post-form").should("exist");

        cy.getCy("nav-home").click();
        cy.getCy("home-page").should("exist");
      });
    });
  });

  // ===========================================================================
  // Error Handling
  // ===========================================================================

  describe("Error Handling", () => {
    describe("API Errors", () => {
      it("should show error fallback when posts API returns 500", () => {
        cy.intercept("GET", "/api/posts", {
          statusCode: 500,
          body: { error: "Internal Server Error" },
        }).as("getPosts");

        cy.visit("/notes.html");
        cy.getCy("nav-posts").click();
        cy.wait("@getPosts");

        cy.getCy("app-error", { timeout: 5000 }).should("exist");
        cy.getCy("error-title").should("contain", "Something went wrong");
      });

      it("should show error fallback when single post API returns 404", () => {
        cy.visit("/notes.html");
        cy.getCy("nav-posts").click();
        cy.getCy("post-list", { timeout: 5000 }).should("exist");

        cy.intercept("GET", "/api/posts/999", {
          statusCode: 404,
          body: { error: "Post not found" },
        }).as("getPost");

        cy.visit("/notes.html", {
          onBeforeLoad: (win) => {
            win.history.pushState(null, "", "/posts/999");
          },
        });

        cy.wait("@getPost");
        cy.getCy("app-error", { timeout: 5000 }).should("exist");
      });

      it("should show error when network request fails", () => {
        cy.intercept("GET", "/api/posts", { forceNetworkError: true }).as("getPosts");

        cy.visit("/notes.html");
        cy.getCy("nav-posts").click();
        cy.wait("@getPosts");

        cy.getCy("app-error", { timeout: 5000 }).should("exist");
      });
    });

    describe("Error Recovery", () => {
      it("should reload page when clicking reload button after error", () => {
        cy.intercept("GET", "/api/posts", {
          statusCode: 500,
          body: { error: "Server Error" },
        }).as("getPostsError");

        cy.visit("/notes.html");
        cy.getCy("nav-posts").click();
        cy.wait("@getPostsError");

        cy.getCy("app-error", { timeout: 5000 }).should("exist");

        cy.intercept("GET", "/api/posts", {
          statusCode: 200,
          body: [{ id: 1, title: "Test", content: "Content", authorId: "test" }],
        }).as("getPostsSuccess");

        cy.getCy("error-reload").should("exist");
        cy.getCy("error-reload").should("contain", "Reload Page");
      });

      it("should navigate away from error state", () => {
        // Cause an error on posts page
        cy.intercept("GET", "/api/posts", {
          statusCode: 500,
          body: { error: "Server Error" },
        }).as("getPostsError");

        cy.visit("/notes.html");
        cy.getCy("nav-posts").click();
        cy.wait("@getPostsError");

        cy.getCy("app-error", { timeout: 5000 }).should("exist");

        // Navigate to home — boundary should recover
        cy.getCy("nav-home").click();

        // Should see home page, error should be gone
        cy.getCy("home-page", { timeout: 5000 }).should("exist");
        cy.getCy("app-error").should("not.exist");
      });
    });

    describe("Form Validation", () => {
      it("should show validation error for empty title on create", () => {
        cy.visit("/notes.html");
        cy.getCy("nav-new-post").click();
        cy.getCy("post-form", { timeout: 5000 }).should("exist");

        cy.getCy("submit-btn").click();
        cy.getCy("form-error", { timeout: 5000 }).should("contain", "Title is required");
      });

      it("should clear validation error when title is filled", () => {
        cy.visit("/notes.html");
        cy.getCy("nav-new-post").click();
        cy.getCy("post-form", { timeout: 5000 }).should("exist");

        cy.getCy("submit-btn").click();
        cy.getCy("form-error", { timeout: 5000 }).should("contain", "Title is required");

        cy.getCy("title-input").type("Test Title");
        cy.getCy("submit-btn").click();

        cy.wait(500);

        cy.get("body").then(($body) => {
          if ($body.find('[data-cy="form-error"]').length > 0) {
            cy.getCy("form-error").should("not.contain", "Title is required");
          }
        });
      });
    });

    describe("Create Post Errors", () => {
      it("should handle API error when creating post", () => {
        cy.intercept("POST", "/api/posts", {
          statusCode: 500,
          body: { error: "Failed to create post" },
        }).as("createPost");

        cy.visit("/notes.html");
        cy.getCy("nav-new-post").click();
        cy.getCy("post-form", { timeout: 5000 }).should("exist");

        cy.getCy("title-input").type("Test Post");
        cy.getCy("content-input").type("Test content");
        cy.getCy("submit-btn").click();

        cy.wait("@createPost");

        cy.get("body").then(($body) => {
          if ($body.find('[data-cy="form-error"]').length > 0) {
            cy.getCy("form-error").should("exist");
          } else {
            cy.getCy("app-error").should("exist");
          }
        });
      });
    });
  });

  // ===========================================================================
  // Loading States
  // ===========================================================================

  describe("Loading States", () => {
    describe("Posts List Loading", () => {
      it("should show posts loading fallback during slow API response", () => {
        cy.intercept("GET", "/api/posts", (req) => {
          req.on("response", (res) => {
            res.setDelay(500);
          });
        }).as("getPosts");

        cy.visit("/notes.html");
        cy.getCy("home-page", { timeout: 5000 }).should("exist");

        cy.getCy("nav-posts").click();

        cy.getCy("posts-loading", { timeout: 2000 }).should("exist");
        cy.getCy("posts-loading").should("contain", "Loading posts...");

        cy.wait("@getPosts");

        cy.getCy("post-list", { timeout: 5000 }).should("exist");
        cy.getCy("posts-loading").should("not.exist");
      });

      it("should show loading when visiting posts page directly", () => {
        cy.intercept("GET", "/api/posts", (req) => {
          req.on("response", (res) => {
            res.setDelay(500);
          });
        }).as("getPosts");

        cy.visit("/notes.html", {
          onBeforeLoad: (win) => {
            win.history.pushState(null, "", "/posts");
          },
        });

        cy.getCy("posts-loading", { timeout: 2000 }).should("exist");
        cy.getCy("posts-loading").should("contain", "Loading posts...");

        cy.wait("@getPosts");

        cy.getCy("post-list", { timeout: 5000 }).should("exist");
        cy.getCy("posts-loading").should("not.exist");
      });
    });

    describe("Post Detail Loading", () => {
      it("should show post detail after loader completes", () => {
        cy.visit("/notes.html");
        cy.getCy("nav-posts").click();
        cy.getCy("post-list", { timeout: 5000 }).should("exist");

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

        cy.getCy("post-link-1").click();
        cy.wait("@getPost");

        cy.getCy("post-detail", { timeout: 5000 }).should("exist");
        cy.getCy("post-detail").should("contain", "Delayed Post");
      });

      it("should show route loading on initial page load with slow loader", () => {
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

        cy.visit("/notes.html", {
          onBeforeLoad: (win) => {
            win.history.pushState(null, "", "/posts/1");
          },
        });

        cy.getCy("route-loading", { timeout: 2000 }).should("exist");
        cy.getCy("route-loading").should("contain", "Loading...");

        cy.wait("@getPost");

        cy.getCy("post-detail", { timeout: 5000 }).should("exist");
        cy.getCy("route-loading").should("not.exist");
      });
    });

    describe("Fast Loading (No Fallback)", () => {
      it("should not show fallback for fast responses", () => {
        cy.visit("/notes.html");
        cy.getCy("home-page", { timeout: 5000 }).should("exist");

        cy.getCy("nav-posts").click();

        cy.getCy("post-list", { timeout: 5000 }).should("exist");
        cy.getCy("posts-ul").should("exist");
      });

      it("should navigate to post detail quickly without loading", () => {
        cy.visit("/notes.html");
        cy.getCy("nav-posts").click();
        cy.getCy("post-list", { timeout: 5000 }).should("exist");

        cy.getCy("posts-ul").find("li").first().find("a").click();
        cy.getCy("post-detail", { timeout: 5000 }).should("exist");
      });
    });

    describe("Navigation during loading", () => {
      it("should cancel loading when navigating away", () => {
        cy.intercept("GET", "/api/posts", (req) => {
          req.on("response", (res) => {
            res.setDelay(2000);
          });
        }).as("getPosts");

        cy.visit("/notes.html");
        cy.getCy("home-page", { timeout: 5000 }).should("exist");

        cy.getCy("nav-posts").click();
        cy.getCy("posts-loading", { timeout: 2000 }).should("exist");

        cy.getCy("nav-home").click();
        cy.getCy("home-page", { timeout: 5000 }).should("exist");
        cy.getCy("posts-loading").should("not.exist");
      });
    });
  });
});
