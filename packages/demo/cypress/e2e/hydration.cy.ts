describe("Hydration", () => {
  const defaultCommandTimeout = 500;

  describe("basic hydration", () => {
    it("hydrates pre-rendered HTML and attaches event handlers", { defaultCommandTimeout }, () => {
      // Visit a page that will have SSR-like pre-rendered content
      cy.visit("http://localhost:5173/hydration-test.html");

      // Wait for hydration to complete (indicated by data-hydrated attribute)
      cy.getCy("hydration-root").should("have.attr", "data-hydrated", "true");

      // Verify event handler works (proves hydration attached handlers)
      cy.getCy("hydration-button").click();
      cy.getCy("hydration-count").should("contain", "1");
    });
  });
});
