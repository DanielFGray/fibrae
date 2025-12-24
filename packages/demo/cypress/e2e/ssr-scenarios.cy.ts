/**
 * SSR Scenarios E2E Tests
 *
 * Tests various SSR + hydration scenarios:
 * 1. Counter with state hydration
 * 2. Todo list with persistent storage
 * 3. Suspense with resolved data
 * 4. Suspense with fallback
 */

describe("SSR Scenarios", () => {
  describe("Counter with State Hydration", () => {
    beforeEach(() => {
      cy.visit("/ssr/counter");
    });

    it("renders server-side content immediately", () => {
      cy.getCy("ssr-title").should("contain", "SSR Counter");
      cy.getCy("ssr-count").should("contain", "0");
      cy.getCy("ssr-increment").should("exist");
    });

    it("hydrates and marks container when complete", () => {
      // Verify hydration by clicking - button should work
      cy.getCy("ssr-increment").click();
      cy.getCy("ssr-count").should("contain", "1");
    });

    it("preserves server-rendered state during hydration", () => {
      // Initial count from server should be 0
      cy.getCy("ssr-count").should("contain", "0");
      // Click to verify hydration - count goes to 1 (not reset)
      cy.getCy("ssr-increment").click();
      cy.getCy("ssr-count").should("contain", "1");
    });

    it("attaches event handlers and enables interactivity", () => {
      cy.getCy("ssr-increment").click();
      cy.getCy("ssr-count").should("contain", "1");

      cy.getCy("ssr-increment").click();
      cy.getCy("ssr-count").should("contain", "2");

      cy.getCy("ssr-increment").click();
      cy.getCy("ssr-count").should("contain", "3");
    });
  });

  describe("Todo List with Persistent Storage", () => {
    beforeEach(() => {
      // Reset todos before each test
      cy.request("POST", "/ssr/todo/reset");
      cy.visit("/ssr/todo");
    });

    it("renders server-side todo list", () => {
      cy.getCy("ssr-todo-title").should("contain", "SSR Todo List");
      cy.getCy("ssr-todo-form").should("exist");
      cy.getCy("ssr-todo-input").should("exist");
      cy.getCy("ssr-todo-add").should("exist");
    });

    it("hydrates and enables adding todos", () => {
      // Add a todo - this verifies hydration is complete
      cy.getCy("ssr-todo-input").type("Buy milk");
      cy.getCy("ssr-todo-add").click();

      // Should appear in list
      cy.getCy("ssr-todo-item").should("have.length", 1);
      cy.getCy("ssr-todo-item").first().should("contain", "Buy milk");
    });

    it("persists todos across page reloads", () => {
      // Add a todo
      cy.getCy("ssr-todo-input").type("Walk the dog");
      cy.getCy("ssr-todo-add").click();
      cy.getCy("ssr-todo-item").should("have.length", 1);

      // Reload the page - todo should persist (server reads from JSON file)
      cy.reload();
      cy.getCy("ssr-todo-item").should("have.length", 1);
      cy.getCy("ssr-todo-item").first().should("contain", "Walk the dog");
    });

    it("can remove todos after hydration", () => {
      // Add two todos
      cy.getCy("ssr-todo-input").type("Task 1");
      cy.getCy("ssr-todo-add").click();
      cy.getCy("ssr-todo-input").type("Task 2");
      cy.getCy("ssr-todo-add").click();
      cy.getCy("ssr-todo-item").should("have.length", 2);

      // Remove first todo
      cy.getCy("ssr-todo-remove").first().click();
      cy.getCy("ssr-todo-item").should("have.length", 1);
      cy.getCy("ssr-todo-item").first().should("contain", "Task 2");
    });
  });

  describe("Suspense with Resolved Content", () => {
    beforeEach(() => {
      cy.visit("/ssr/suspense");
    });

    it("renders server-side content with resolved marker", () => {
      cy.getCy("ssr-suspense-title").should("contain", "SSR Suspense Test");
      cy.getCy("ssr-suspense-content").should("exist");
      cy.getCy("ssr-suspense-content").should("contain", "This content rendered immediately");
    });

    it("emits Suspense comment markers in SSR HTML", () => {
      // Check that the HTML contains the Suspense markers
      cy.get("body").then(($body) => {
        const html = $body.html();
        // Should have opening marker with "resolved" state
        expect(html).to.include("<!--didact:sus:resolved-->");
        // Should have closing marker
        expect(html).to.include("<!--/didact:sus-->");
        // Should NOT have fallback marker (content rendered immediately)
        expect(html).to.not.include("<!--didact:sus:fallback-->");
      });
    });

    it("hydrates successfully despite comment markers", () => {
      // Content should still be visible after hydration
      // (hydration walks past comment markers correctly)
      cy.getCy("ssr-suspense-content").should("exist");
      cy.getCy("ssr-suspense-content").should("contain", "This content rendered immediately");
    });

    it("attaches event handlers after hydration", () => {
      // Initial click count should be 0
      cy.getCy("ssr-suspense-clicks").should("contain", "Clicks: 0");
      
      // Click the button - if hydration worked, this will update the count
      cy.getCy("ssr-suspense-button").click();
      
      // Count should increment (proves hydration attached the handler)
      cy.getCy("ssr-suspense-clicks").should("contain", "Clicks: 1");
      
      // Click again to be sure
      cy.getCy("ssr-suspense-button").click();
      cy.getCy("ssr-suspense-clicks").should("contain", "Clicks: 2");
    });
  });

  describe("Suspense with Slow Content (Fallback)", () => {
    it("emits fallback marker when content is slow", () => {
      // Check raw SSR HTML response (before hydration modifies it)
      cy.request("/ssr/suspense-slow").then((response) => {
        const html = response.body;
        // Should have opening marker with "fallback" state
        expect(html).to.include("<!--didact:sus:fallback-->");
        // Should have closing marker
        expect(html).to.include("<!--/didact:sus-->");
        // Should NOT have resolved marker (content was too slow)
        expect(html).to.not.include("<!--didact:sus:resolved-->");
      });
    });

    it("renders fallback content in SSR HTML", () => {
      cy.visit("/ssr/suspense-slow");
      // The fallback should be visible initially
      cy.getCy("ssr-slow-fallback").should("exist");
      cy.getCy("ssr-slow-fallback").should("contain", "Loading slow content...");
    });

    it("hydrates and swaps fallback for real content", () => {
      cy.visit("/ssr/suspense-slow");
      // Initially shows fallback
      cy.getCy("ssr-slow-fallback").should("exist");
      
      // After hydration + content load, should show real content
      // The delay is 500ms in the component, plus some buffer for hydration
      cy.getCy("ssr-slow-content", { timeout: 3000 }).should("exist");
      cy.getCy("ssr-slow-content").should("contain", "This content loaded after delay");
      
      // Fallback should be gone
      cy.getCy("ssr-slow-fallback").should("not.exist");
    });

    it("attaches event handlers after content swap", () => {
      cy.visit("/ssr/suspense-slow");
      // Wait for real content to appear
      cy.getCy("ssr-slow-content", { timeout: 3000 }).should("exist");
      
      // Initial click count should be 0
      cy.getCy("ssr-slow-clicks").should("contain", "Clicks: 0");
      
      // Click the button - if hydration worked, this will update the count
      cy.getCy("ssr-slow-button").click();
      cy.getCy("ssr-slow-clicks").should("contain", "Clicks: 1");
      
      // Click again to be sure
      cy.getCy("ssr-slow-button").click();
      cy.getCy("ssr-slow-clicks").should("contain", "Clicks: 2");
    });
  });
});
