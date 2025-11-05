describe("Error Boundaries", () => {
  beforeEach(() => {
    cy.visit("/examples.html");
  });

  it("shows fallback for render-time crash", () => {
    cy.getCy("fallback-render", { timeout: 5000 }).should("exist");
  });
});
