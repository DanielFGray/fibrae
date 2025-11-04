describe("Stream Components", () => {
  beforeEach(() => {
    cy.visit("http://localhost:5173");
  });

  it("StreamCounter component", () => {
    it("renders initial loading state", () => {
      cy.getCy("stream-counter").should("exist");
      cy.getCy("stream-status").should("contain", "Loading...");
    });

    it("transitions through stream emissions", () => {
      // Should start with "Loading..."
      cy.getCy("stream-status").should("contain", "Loading...");

      // Should update to "Ready: 3" after ~500ms
      cy.getCy("stream-status", { timeout: 1000 }).should("contain", "Ready: 3");

      // Should update to "Ready: 2" after another ~500ms
      cy.getCy("stream-status", { timeout: 1000 }).should("contain", "Ready: 2");

      // Should update to "Ready: 1"
      cy.getCy("stream-status", { timeout: 1000 }).should("contain", "Ready: 1");

      // Should finally show "Complete!"
      cy.getCy("stream-status", { timeout: 1000 }).should("contain", "Complete!");
    });

    it("completes countdown sequence", () => {
      // Wait for final state
      cy.getCy("stream-status", { timeout: 3000 }).should("contain", "Complete!");

      // Verify it stays in final state
      cy.getCy("stream-status").should("contain", "Complete!");
    });
  });
});
