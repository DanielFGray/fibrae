/**
 * Core Fibrae Features E2E Tests
 *
 * Tests fundamental framework capabilities:
 * - Reactive state (counter, todos)
 * - Stream + Suspense
 * - ErrorBoundary (render/event/stream errors, typed error handling)
 * - Debounced search (Effect.delay in event handlers)
 * - Effect Services (shared state across components)
 * - ComponentScope (cleanup finalizers, LIFO, mounted deferred)
 * - SSR Hydration (event handler attachment)
 */

// =============================================================================
// Examples Page (/examples.html)
// =============================================================================

describe("Core Features", () => {
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

    describe("Counter", () => {
      it("increments, decrements, and resets", () => {
        cy.getCy("example-counter").within(() => {
          cy.getCy("counter-value").should("contain", "Count: 0");
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

    describe("Stream + Suspense", () => {
      it("shows fallback then progresses through stream emissions", () => {
        cy.getCy("stream-loading").should("contain", "Loading stream...");
        cy.getCy("stream-status").contains("Ready: 3");
        cy.getCy("stream-status").contains("Ready: 2");
        cy.getCy("stream-status").contains("Ready: 1");
        cy.getCy("stream-status").contains("Complete!");
      });
    });

    describe("Todo List", () => {
      it("adds and removes todos", () => {
        cy.getCy("todo-input").type("First item");
        cy.getCy("todo-add").click();
        cy.getCy("todo-text").contains("First item");

        cy.getCy("todo-input").type("Second item{enter}");
        cy.getCy("todo-text").contains("Second item");

        cy.getCy("todo-remove").first().click();
        cy.getCy("todo-text").contains("First item").should("not.exist");

        cy.getCy("todo-remove").first().click();
        cy.getCy("todo-text").should("not.exist");
      });

      it("marks todo as completed", () => {
        cy.getCy("todo-input").type("Complete me{enter}");
        cy.getCy("todo-text").contains("Complete me");
        cy.getCy("todo-checkbox").first().click();
        cy.getCy("todo-text")
          .first()
          .should("have.css", "text-decoration")
          .and("include", "line-through");
      });
    });

    describe("Debounced Search", () => {
      it("debounces input and updates results after delay", () => {
        const firstQuery = "hello world";
        cy.getCy("search-input").type(firstQuery, { delay: 50 });

        cy.getCy("search-input").should("have.value", firstQuery);
        cy.contains("Query:").should("contain", firstQuery);

        cy.wait(400);

        cy.contains("Debounced:").should("contain", firstQuery);
        cy.getCy("search-result").should("have.length", 3);

        const secondQuery = "effect typescript";
        cy.getCy("search-input").clear();
        cy.getCy("search-input").type(secondQuery, { delay: 50 });

        cy.getCy("search-input").should("have.value", secondQuery);
        cy.contains("Query:").should("contain", secondQuery);

        cy.wait(400);
        cy.contains("Debounced:").should("contain", secondQuery);
        cy.getCy("search-result").should("have.length", 3);
      });
    });

    describe("Effect Services", () => {
      it("loads user data and toggles theme across components", () => {
        cy.getCy("themed-user-card", { timeout: 10000 }).within(() => {
          cy.contains("Theme:").should("contain", "dark");
          cy.contains("Name:").should("contain", "Alice");
        });

        cy.getCy("user-list", { timeout: 12000 }).contains("All Users");
        cy.getCy("user-list", { timeout: 12000 }).within(() => {
          cy.contains("1. Alice");
          cy.contains("2. Bob");
          cy.contains("3. Charlie");
        });

        cy.getCy("toggle-theme").click();

        cy.getCy("themed-user-card").contains("Theme:").should("contain", "light");
        cy.getCy("user-list").contains("theme: light");
      });
    });
  });

  // ===========================================================================
  // ErrorBoundary (/examples.html)
  // ===========================================================================

  describe("ErrorBoundary", () => {
    beforeEach(() => {
      cy.visit("/examples.html");
    });

    describe("basic error handling", () => {
      it("catches render-time crash and shows fallback", () => {
        cy.getCy("fallback-render", { timeout: 5000 }).should("exist");
        cy.getCy("fallback-render").should("contain", "Render Error");
      });

      it("catches event handler Effect failures", () => {
        cy.getCy("fail-event", { timeout: 5000 }).should("exist");
        cy.getCy("fail-event").click();

        cy.getCy("fallback-event", { timeout: 5000 }).should("exist");
        cy.getCy("fallback-event").should("contain", "EventHandlerError");
        cy.getCy("fallback-event").should("contain", "eventType: click");
      });

      it("catches stream failures after first emission", () => {
        cy.getCy("error-container", { timeout: 5000 }).then(($el) => {
          cy.log("Error container HTML:", $el.html());
        });

        cy.getCy("stream-ok", { timeout: 5000 }).should("exist").and("contain", "Stream OK once");
        cy.getCy("fallback-stream", { timeout: 5000 }).should("exist").and("contain", "Stream Error");
        cy.getCy("stream-ok").should("not.exist");
      });

      it("catches stream failures before first emission", () => {
        cy.getCy("fallback-stream-immediate", { timeout: 5000 }).should("exist");
        cy.getCy("fallback-stream-immediate").should("contain", "Stream Immediate Error");
      });
    });

    describe("Suspense interaction", () => {
      it("takes precedence over Suspense fallback when child fails", () => {
        cy.getCy("suspense-loading", { timeout: 5000 }).should("exist");
        cy.getCy("suspense-loading").should("contain", "Loading slow component");

        cy.getCy("fallback-suspense-error", { timeout: 5000 }).should("exist");
        cy.getCy("fallback-suspense-error").should("contain", "Suspense Error Precedence");

        cy.getCy("suspense-loading").should("not.exist");
      });
    });

    describe("typed error handling with Stream.catchTags", () => {
      it("RenderError includes componentName", () => {
        cy.getCy("boundary-fallback-render", { timeout: 5000 }).should("exist");
        cy.getCy("boundary-fallback-render").should("contain", "Boundary Render Error");
      });

      it("EventHandlerError includes eventType", () => {
        cy.getCy("boundary-fail-event", { timeout: 5000 }).should("exist");
        cy.getCy("boundary-fail-event").click();

        cy.getCy("boundary-fallback-event", { timeout: 5000 }).should("exist");
        cy.getCy("boundary-fallback-event").should("contain", "Boundary Event Error");
        cy.getCy("boundary-fallback-event").should("contain", "click");
      });

      it("StreamError includes phase", () => {
        cy.getCy("boundary-stream-ok", { timeout: 5000 }).should("exist");

        cy.getCy("boundary-fallback-stream", { timeout: 5000 }).should("exist");
        cy.getCy("boundary-fallback-stream").should("contain", "Boundary Stream Error");

        cy.getCy("boundary-stream-ok").should("not.exist");
      });
    });
  });

  // ===========================================================================
  // ComponentScope (/component-scope-test.html)
  // ===========================================================================

  describe("ComponentScope", () => {
    beforeEach(() => {
      cy.visit("/component-scope-test.html");
      cy.getCy("controls", { timeout: 5000 }).should("exist");
      cy.getCy("clear-log").click();
      cy.window().its("cleanupLog").should("deep.equal", []);
    });

    describe("basic cleanup", () => {
      it("cleanup finalizer runs when component unmounts", () => {
        cy.getCy("cleanup-component").should("exist");
        cy.getCy("toggle-cleanup").click();

        cy.getCy("cleanup-component").should("not.exist");
        cy.getCy("component-removed").should("exist");

        cy.window()
          .its("cleanupLog")
          .should("include", "CleanupComponent unmounted");
      });

      it("cleanup runs when parent re-renders with different children", () => {
        cy.getCy("child-a").should("exist");
        cy.getCy("child-b").should("not.exist");

        cy.getCy("switch-child").click();

        cy.getCy("child-b").should("exist");
        cy.getCy("child-a").should("not.exist");

        cy.window().its("cleanupLog").should("include", "ChildA cleanup");

        cy.getCy("switch-child").click();

        cy.getCy("child-a").should("exist");
        cy.getCy("child-b").should("not.exist");

        cy.window().its("cleanupLog").should("include", "ChildB cleanup");
      });
    });

    describe("multiple finalizers", () => {
      it("multiple finalizers run in reverse order (LIFO)", () => {
        cy.getCy("multi-finalizer").should("exist");

        cy.getCy("toggle-mounted").click();
        cy.getCy("mounted-component").should("not.exist");

        cy.wait(100);

        cy.getCy("clear-log").click();
        cy.window().its("cleanupLog").should("deep.equal", []);

        cy.getCy("toggle-multi").click();

        cy.getCy("multi-finalizer").should("not.exist");
        cy.getCy("multi-removed").should("exist");

        cy.window().its("cleanupLog").should("deep.equal", ["multi-3", "multi-2", "multi-1"]);
      });
    });

    describe("mounted deferred", () => {
      it("mounted resolves after DOM is committed", () => {
        cy.getCy("toggle-mounted").click();
        cy.getCy("mounted-component").should("not.exist");

        cy.getCy("clear-log").click();
        cy.window().its("cleanupLog").should("deep.equal", []);

        cy.getCy("toggle-mounted").click();
        cy.getCy("mounted-component").should("exist");

        cy.window()
          .its("cleanupLog")
          .should("include", "mounted: DOM element exists");
      });

      it("mounted cleanup runs on unmount", () => {
        cy.getCy("mounted-component").should("exist");

        cy.getCy("toggle-mounted").click();

        cy.getCy("mounted-component").should("not.exist");

        cy.window()
          .its("cleanupLog")
          .should("include", "mounted cleanup");
      });
    });
  });

  // ===========================================================================
  // Hydration (/hydration-test.html)
  // ===========================================================================

  describe("Hydration", () => {
    it("hydrates pre-rendered HTML and attaches event handlers", () => {
      cy.visit("http://localhost:5173/hydration-test.html");

      cy.getCy("hydration-button").click();
      cy.getCy("hydration-count").should("contain", "1");
    });
  });
});
