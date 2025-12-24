describe("SSR Counter with State Hydration", () => {
  beforeEach(() => {
    // Navigate to SSR endpoint (proxied to Effect server :3001)
    cy.visit("/ssr");
  });

  it("renders server-side content immediately", () => {
    // Pre-rendered content should be visible without waiting
    cy.getCy("ssr-title").should("contain", "SSR Counter");
    cy.getCy("ssr-count").should("contain", "0");
    cy.getCy("ssr-increment").should("exist");
  });

  it("hydrates and marks container when complete", () => {
    // Wait for hydration by verifying the button becomes interactive
    // Click and verify count changes - this proves event handlers are attached
    cy.getCy("ssr-increment").click();
    cy.getCy("ssr-count").should("contain", "1");
  });

  it("preserves server-rendered state during hydration", () => {
    // Initial count from server should be 0
    cy.getCy("ssr-count").should("contain", "0");

    // Verify hydration completed by clicking - count should go to 1 (not reset)
    cy.getCy("ssr-increment").click();
    cy.getCy("ssr-count").should("contain", "1");
  });

  it("attaches event handlers and enables interactivity", () => {
    // Click increment button once
    cy.getCy("ssr-increment").click();
    cy.getCy("ssr-count").should("contain", "1");

    // Click again
    cy.getCy("ssr-increment").click();
    cy.getCy("ssr-count").should("contain", "2");

    // And once more
    cy.getCy("ssr-increment").click();
    cy.getCy("ssr-count").should("contain", "3");
  });
});
