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
    // Wait for hydration to complete (root element gets data-hydrated="true")
    cy.get("#root", { timeout: 5000 }).should("have.attr", "data-hydrated", "true");
  });

  it("preserves server-rendered state during hydration", () => {
    // Initial count from server should be 0
    cy.getCy("ssr-count").should("contain", "0");

    // Wait for hydration
    cy.get("#root", { timeout: 5000 }).should("have.attr", "data-hydrated", "true");

    // Count should still be 0 after hydration (state preserved)
    cy.getCy("ssr-count").should("contain", "0");
  });

  it("attaches event handlers and enables interactivity", () => {
    // Wait for hydration
    cy.get("#root", { timeout: 5000 }).should("have.attr", "data-hydrated", "true");

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
