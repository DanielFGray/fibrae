/**
 * SSR Scenarios E2E Tests
 *
 * Tests various SSR + hydration scenarios:
 * 1. Counter with state hydration
 * 2. Todo list with persistent storage
 * 3. (Future) Suspense with resolved data
 * 4. (Future) Suspense with fallback
 * 5. (Future) Hydration mismatch recovery
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
      cy.get("#root", { timeout: 5000 }).should("have.attr", "data-hydrated", "true");
    });

    it("preserves server-rendered state during hydration", () => {
      cy.getCy("ssr-count").should("contain", "0");
      cy.get("#root", { timeout: 5000 }).should("have.attr", "data-hydrated", "true");
      cy.getCy("ssr-count").should("contain", "0");
    });

    it("attaches event handlers and enables interactivity", () => {
      cy.get("#root", { timeout: 5000 }).should("have.attr", "data-hydrated", "true");

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
      cy.get("#root", { timeout: 5000 }).should("have.attr", "data-hydrated", "true");

      // Add a todo
      cy.getCy("ssr-todo-input").type("Buy milk");
      cy.getCy("ssr-todo-add").click();

      // Should appear in list
      cy.getCy("ssr-todo-item").should("have.length", 1);
      cy.getCy("ssr-todo-item").first().should("contain", "Buy milk");
    });

    it("persists todos across page reloads", () => {
      cy.get("#root", { timeout: 5000 }).should("have.attr", "data-hydrated", "true");

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
      cy.get("#root", { timeout: 5000 }).should("have.attr", "data-hydrated", "true");

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
});
