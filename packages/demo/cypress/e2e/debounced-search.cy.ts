describe("Debounced Search Example", () => {
  beforeEach(() => {
    cy.visit("/examples.html");
  });

  it("debounces input and updates results after delay", () => {
    // Type a longer query string to stress test controlled input handling
    const firstQuery = "hello world";
    cy.getCy("search-input").type(firstQuery, { delay: 50 });

    // Verify input has the typed value
    cy.getCy("search-input").should("have.value", firstQuery);

    // Verify query is captured in state
    cy.contains("Query:").should("contain", firstQuery);

    // Wait for debounce (300ms) plus buffer
    cy.wait(400);

    // After debounce, should show results
    cy.contains("Debounced:").should("contain", firstQuery);
    cy.getCy("search-result").should("have.length", 3);

    // Clear and type new query
    const secondQuery = "effect typescript";
    cy.getCy("search-input").clear();
    cy.getCy("search-input").type(secondQuery, { delay: 50 });

    // Verify input has the new typed value
    cy.getCy("search-input").should("have.value", secondQuery);

    // Verify query state is updated
    cy.contains("Query:").should("contain", secondQuery);

    // Wait for new debounce
    cy.wait(400);
    cy.contains("Debounced:").should("contain", secondQuery);
    cy.getCy("search-result").should("have.length", 3);
  });
});
