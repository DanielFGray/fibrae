describe("Stream Components", () => {
  beforeEach(() => {
    cy.visit("http://localhost:5173");
  });

  it("renders initial loading state", () => {
    cy.getCy("stream-counter").should("exist");
    cy.getCy("stream-status").should("contain", "Loading...");
  });

  it("transitions through stream emissions", { defaultCommandTimeout: 1000 }, () => {
    // Should start with "Loading..."
    // cy.getCy("stream-status").should("contain", "Loading...");

    // Should update to "Ready: 3" after ~500ms
    cy.getCy("stream-status").should("contain", "Ready: 3");

    // Should update to "Ready: 2" after another ~500ms
    cy.getCy("stream-status").should("contain", "Ready: 2");

    // Should update to "Ready: 1"
    cy.getCy("stream-status").should("contain", "Ready: 1");

    // Should finally show "Complete!"
    cy.getCy("stream-status").should("contain", "Complete!");
  });
});
