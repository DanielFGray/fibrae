describe("Debug Rendering", () => {
  it("dumps the actual DOM structure", () => {
    cy.visit("http://localhost:5173");
    
    cy.wait(1000); // Give it time to render
    
    // Check if app-title exists
    cy.getCy("app-title").should("exist");
    
    // Get and log the root element HTML
    cy.get("#root").invoke("html").then((html) => {
      // Write to a fixture file so we can read it
      cy.writeFile("cypress/fixtures/dom-dump.html", html);
    });
    
    // Count all data-cy elements
    cy.get("[data-cy]").then((elements) => {
      const dataCyValues = Array.from(elements).map((el) => el.getAttribute("data-cy"));
      cy.writeFile("cypress/fixtures/data-cy-elements.json", dataCyValues);
    });
  });
});
