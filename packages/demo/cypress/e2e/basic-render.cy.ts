describe("Basic Rendering", () => {
  beforeEach(() => {
    cy.visit("http://localhost:5173");
  });

  describe("renders", () => {
    it("renders static components", () => {
      cy.getCy("app-title").should("exist");
    });

    it("renders the entire UI without errors", () => {
      cy.getCy("app-title").should("exist");
      cy.getCy("todo-list").should("exist");
      cy.getCy("counter-a").should("exist");
      cy.getCy("todo-input").should("exist");
      cy.getCy("todo-add").should("exist");
    });

    it("shows initial count value", () => {
      cy.getCy("counter-value").should("contain", "Count: 0");
    });

    it("can click a button without crashing", () => {
      cy.getCy("counter-a").within(() => {
        cy.getCy("counter-increment").click();
      });
      cy.getCy("counter-a").should("exist");
    });

    it("input field exists and can receive input", () => {
      cy.getCy("todo-input").should("be.visible");
      cy.getCy("todo-input").focus().type("Test Todo");
      cy.getCy("todo-input").should("have.value", "Test Todo");
    });
  });
});
