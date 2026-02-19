describe("ComponentScope", () => {
  beforeEach(() => {
    cy.visit("/component-scope-test.html");
    // Wait for app to render
    cy.getCy("controls", { timeout: 5000 }).should("exist");
    // Clear the log before each test
    cy.getCy("clear-log").click();
    cy.window().its("cleanupLog").should("deep.equal", []);
  });

  describe("basic cleanup", () => {
    it("cleanup finalizer runs when component unmounts", () => {
      // Verify component is rendered
      cy.getCy("cleanup-component").should("exist");

      // Toggle to remove the component
      cy.getCy("toggle-cleanup").click();

      // Verify component is removed
      cy.getCy("cleanup-component").should("not.exist");
      cy.getCy("component-removed").should("exist");

      // Verify cleanup was called
      cy.window()
        .its("cleanupLog")
        .should("include", "CleanupComponent unmounted");
    });

    it("cleanup runs when parent re-renders with different children", () => {
      // Verify Child A is rendered
      cy.getCy("child-a").should("exist");
      cy.getCy("child-b").should("not.exist");

      // Switch to Child B
      cy.getCy("switch-child").click();

      // Verify Child B is now rendered
      cy.getCy("child-b").should("exist");
      cy.getCy("child-a").should("not.exist");

      // Verify Child A's cleanup was called
      cy.window().its("cleanupLog").should("include", "ChildA cleanup");

      // Switch back to Child A
      cy.getCy("switch-child").click();

      // Verify Child A is back
      cy.getCy("child-a").should("exist");
      cy.getCy("child-b").should("not.exist");

      // Verify Child B's cleanup was called
      cy.window().its("cleanupLog").should("include", "ChildB cleanup");
    });
  });

  describe("multiple finalizers", () => {
    it("multiple finalizers run in reverse order (LIFO)", () => {
      // Verify multi-finalizer component is rendered
      cy.getCy("multi-finalizer").should("exist");

      // Hide mounted component first to avoid its logs interfering
      cy.getCy("toggle-mounted").click();
      cy.getCy("mounted-component").should("not.exist");

      // Wait a moment for any pending effects to complete
      cy.wait(100);

      // Clear log
      cy.getCy("clear-log").click();
      cy.window().its("cleanupLog").should("deep.equal", []);

      // Toggle to remove the component
      cy.getCy("toggle-multi").click();

      // Verify component is removed
      cy.getCy("multi-finalizer").should("not.exist");
      cy.getCy("multi-removed").should("exist");

      // Verify all finalizers were called in LIFO order (3, 2, 1)
      cy.window().its("cleanupLog").should("deep.equal", ["multi-3", "multi-2", "multi-1"]);
    });
  });

  describe("mounted deferred", () => {
    it("mounted resolves after DOM is committed", () => {
      // Toggle off first to ensure clean state
      cy.getCy("toggle-mounted").click();
      cy.getCy("mounted-component").should("not.exist");

      // Clear log
      cy.getCy("clear-log").click();
      cy.window().its("cleanupLog").should("deep.equal", []);

      // Toggle on - this should mount and trigger the mounted effect
      cy.getCy("toggle-mounted").click();
      cy.getCy("mounted-component").should("exist");

      // Verify mounted callback ran and could access DOM
      cy.window()
        .its("cleanupLog")
        .should("include", "mounted: DOM element exists");
    });

    it("mounted cleanup runs on unmount", () => {
      // Verify component is rendered
      cy.getCy("mounted-component").should("exist");

      // Toggle to remove the component
      cy.getCy("toggle-mounted").click();

      // Verify component is removed
      cy.getCy("mounted-component").should("not.exist");

      // Verify cleanup was called (registered in the mounted callback)
      cy.window()
        .its("cleanupLog")
        .should("include", "mounted cleanup");
    });
  });
});
