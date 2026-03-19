/**
 * Transition E2E Tests
 *
 * Verifies the Transition service:
 * - isPending atom reflects loader state
 * - Old content preserved during slow navigation (no Suspense fallback flash)
 * - switchMap cancellation on rapid navigation
 */

describe("Transition", () => {
  beforeEach(() => {
    cy.visit("/transition-test.html");
    cy.getCy("page-content", { timeout: 5000 }).should("exist");
  });

  // =========================================================================
  // Basic rendering
  // =========================================================================

  describe("basic rendering", () => {
    it("renders home page initially", () => {
      cy.getCy("page-content").should("contain", "Home Page");
    });

    it("nav is not pending on initial render", () => {
      cy.getCy("nav").should("have.attr", "data-pending", "false");
    });

    it("loading indicator is not visible initially", () => {
      cy.getCy("nav-loading").should("not.exist");
    });
  });

  // =========================================================================
  // Transition isPending
  // =========================================================================

  describe("isPending during navigation", () => {
    it("shows pending state while slow route loads", () => {
      cy.getCy("nav-slow").click();

      // isPending should become true while the 500ms loader runs
      cy.getCy("nav").should("have.attr", "data-pending", "true");
      cy.getCy("nav-loading").should("exist");
    });

    it("clears pending state after slow route loads", () => {
      cy.getCy("nav-slow").click();

      // Wait for loader to complete
      cy.getCy("page-content", { timeout: 2000 }).should("contain", "Slow Page");

      // isPending should be false after load
      cy.getCy("nav").should("have.attr", "data-pending", "false");
      cy.getCy("nav-loading").should("not.exist");
    });

    it("fast route does not show pending state (or clears instantly)", () => {
      cy.getCy("nav-fast").click();

      // Fast route loads immediately — isPending should be false
      cy.getCy("page-content").should("contain", "Fast Page");
      cy.getCy("nav").should("have.attr", "data-pending", "false");
    });
  });

  // =========================================================================
  // Old content preserved (Suspense fallback suppressed)
  // =========================================================================

  describe("old content preserved during transition", () => {
    it("home content stays visible while slow route loads", () => {
      cy.getCy("page-content").should("contain", "Home Page");

      cy.getCy("nav-slow").click();

      // While pending, home content should STILL be visible
      cy.getCy("nav").should("have.attr", "data-pending", "true");
      cy.getCy("page-content").should("contain", "Home Page");
    });

    it("suspense fallback does NOT appear during transition", () => {
      cy.getCy("nav-slow").click();

      // Suspense fallback should never appear when Transition is provided
      cy.getCy("suspense-fallback").should("not.exist");

      // Home content stays until slow page is ready
      cy.getCy("page-content").should("exist");
    });

    it("slow page replaces home after load completes", () => {
      cy.getCy("nav-slow").click();

      // After load, slow page content appears
      cy.getCy("page-content", { timeout: 2000 }).should("contain", "Slow Page");

      // Home content is gone
      cy.getCy("page-content").should("not.contain", "Home Page");
    });
  });

  // =========================================================================
  // Loader cancellation (switchMap)
  // =========================================================================

  describe("loader cancellation on rapid navigation", () => {
    it("navigating away from slow route cancels its loader", () => {
      // Start navigating to slow route
      cy.getCy("nav-slow").click();

      // Immediately navigate to fast route before slow loader completes
      cy.getCy("nav-fast").click();

      // Fast route should win
      cy.getCy("page-content", { timeout: 2000 }).should("contain", "Fast Page");

      // Should NOT show slow page content
      cy.getCy("page-content").should("not.contain", "Slow Page");
    });

    it("only one page-content element visible after rapid navigation", () => {
      cy.getCy("nav-slow").click();
      cy.getCy("nav-fast").click();

      cy.getCy("page-content", { timeout: 2000 }).should("have.length", 1);
      cy.getCy("page-content").should("contain", "Fast Page");
    });

    it("pending clears after fast route loads (cancelled slow route)", () => {
      cy.getCy("nav-slow").click();
      cy.getCy("nav-fast").click();

      cy.getCy("page-content", { timeout: 2000 }).should("contain", "Fast Page");
      cy.getCy("nav").should("have.attr", "data-pending", "false");
    });
  });

  // =========================================================================
  // Navigation sequences
  // =========================================================================

  describe("navigation sequences", () => {
    it("can navigate home -> slow -> home", () => {
      cy.getCy("nav-slow").click();
      cy.getCy("page-content", { timeout: 2000 }).should("contain", "Slow Page");

      cy.getCy("nav-home").click();
      cy.getCy("page-content").should("contain", "Home Page");
    });

    it("can navigate through all routes", () => {
      cy.getCy("nav-fast").click();
      cy.getCy("page-content").should("contain", "Fast Page");

      cy.getCy("nav-slow").click();
      cy.getCy("page-content", { timeout: 2000 }).should("contain", "Slow Page");

      cy.getCy("nav-home").click();
      cy.getCy("page-content").should("contain", "Home Page");
    });
  });
});
