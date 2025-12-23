describe("Examples Page", () => {
  beforeEach(() => {
    cy.visit("/examples.html");
  });

  it("renders all example sections headers", () => {
    cy.contains("h2", "Example 1: Simple Counter").should("exist");
    cy.contains("h2", "Example 2: Static Components").should("exist");
    cy.contains("h2", "Example 3: Stream with Suspense").should("exist");
    cy.contains("h2", "Example 4: Todo List with Child Components").should("exist");
    cy.contains("h2", "Example 5: Debounced Search").should("exist");
    cy.contains("h2", "Example 6: Effect Services").should("exist");
  });

  describe("Counter Example", () => {
    it("increments, decrements, and resets", () => {
      cy.getCy("example-counter").within(() => {
        cy.getCy("counter-value").should("contain", "Count: 0");
        // Requery between clicks since DOM may be replaced during re-render
        cy.getCy("counter-increment").click();
        cy.getCy("counter-increment").click();
        cy.getCy("counter-value").should("contain", "Count: 2");
        cy.getCy("counter-decrement").click();
        cy.getCy("counter-value").should("contain", "Count: 1");
        cy.getCy("counter-reset").click();
        cy.getCy("counter-value").should("contain", "Count: 0");
      });
    });
  });

  describe("Stream + Suspense Example", () => {
    it("shows fallback then progresses through stream emissions", () => {
      cy.getCy("stream-loading").should("contain", "Loading stream...");
      // After first emission
      cy.getCy("stream-status").contains("Ready: 3");
      cy.getCy("stream-status").contains("Ready: 2");
      cy.getCy("stream-status").contains("Ready: 1");
      cy.getCy("stream-status").contains("Complete!");
    });
  });

  describe("Todo List Example", () => {
    it("adds and removes todos", () => {
      cy.getCy("todo-input").type("First item");
      cy.getCy("todo-add").click();
      cy.getCy("todo-text").contains("First item");

      cy.getCy("todo-input").type("Second item{enter}");
      cy.getCy("todo-text").contains("Second item");

      // Remove first
      cy.getCy("todo-remove").first().click();
      cy.getCy("todo-text").contains("First item").should("not.exist");

      // Remove second
      cy.getCy("todo-remove").first().click();
      cy.getCy("todo-text").should("not.exist");
    });

    it("marks todo as completed", () => {
      cy.getCy("todo-input").type("Complete me{enter}");
      cy.getCy("todo-text").contains("Complete me");
      cy.getCy("todo-checkbox").first().click();
      cy.getCy("todo-text").first().should("have.css", "text-decoration").and("include", "line-through");
    });
  });

  describe("Debounced Search Example", () => {
    it("debounces input and updates results after delay", () => {
      // Type a multi-char query in one go (component will re-render per keystroke)
      // Using delay between keystrokes allows re-renders to complete
      cy.getCy("search-input").type("abc", { delay: 100 });
      
      // Verify query is captured
      cy.contains("Query:").should("contain", "abc");
      
      // Wait for debounce (300ms) plus buffer
      cy.wait(400);
      
      // After debounce, should show results
      cy.contains("Debounced:").should("contain", "abc");
      cy.getCy("search-result").should("have.length", 3);
      
      // Clear and type new query
      cy.getCy("search-input").clear();
      cy.getCy("search-input").type("xyz", { delay: 100 });
      
      // Immediately after typing, debounced should still have old value
      cy.contains("Query:").should("contain", "xyz");
      
      // Wait for new debounce
      cy.wait(400);
      cy.contains("Debounced:").should("contain", "xyz");
      cy.getCy("search-result").should("have.length", 3);
    });
  });

  describe("Service-based Components Example", () => {
    it("loads user data and toggles theme across components", () => {
      // Themed card renders after current user loads (~1s)
      cy.getCy("themed-user-card", { timeout: 10000 }).within(() => {
        cy.contains("Theme:").should("contain", "dark");
        cy.contains("Name:").should("contain", "Alice");
      });

      // User list appears after ~2s
      cy.getCy("user-list", { timeout: 12000 }).contains("All Users");
      cy.getCy("user-list", { timeout: 12000 }).within(() => {
        cy.contains("1. Alice");
        cy.contains("2. Bob");
        cy.contains("3. Charlie");
      });

      // Toggle theme
      cy.getCy("toggle-theme").click();

      cy.getCy("themed-user-card").contains("Theme:").should("contain", "light");
      cy.getCy("user-list").contains("theme: light");
    });
  });
});
