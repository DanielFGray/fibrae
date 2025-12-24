describe("Hydration", () => {
  describe("basic hydration", () => {
    it("hydrates pre-rendered HTML and attaches event handlers", () => {
      // Visit a page that will have SSR-like pre-rendered content
      cy.visit("http://localhost:5173/hydration-test.html");

      // Verify event handler works (proves hydration attached handlers)
      // Cypress will retry until the click succeeds and count updates
      cy.getCy("hydration-button").click();
      cy.getCy("hydration-count").should("contain", "1");
    });
  });
});
