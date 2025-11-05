describe("Basic Rendering", () => {
  beforeEach(() => {
    cy.visit("http://localhost:5173");
  });
  const defaultCommandTimeout = 250
  describe("renders", () => {
    it("renders static components", { defaultCommandTimeout }, () => {
      cy.getCy("app-title").should("exist");
    });

    it("shows initial count value", { defaultCommandTimeout }, () => {
      cy.getCy("counter-value").should("contain", "Count: 0");
    });

    it("renders the entire UI without errors", { defaultCommandTimeout }, () => {
      cy.getCy("app-title").should("exist");
      cy.getCy("todo-list").should("exist");
      cy.getCy("counter-a").should("exist");
      cy.getCy("todo-input").should("exist");
      cy.getCy("todo-add").should("exist");
    });

    it("can click a button without crashing", { defaultCommandTimeout }, () => {
      cy.getCy("counter-a").within(() => {
        cy.getCy("counter-increment").click();
      });
      cy.getCy("counter-a").should("exist");
    });

    it("input field exists and can receive input", { defaultCommandTimeout }, () => {
      cy.getCy("todo-input").should("be.visible");
      cy.getCy("todo-input").focus().type("Test Todo");
      cy.getCy("todo-input").should("have.value", "Test Todo");
    });
  });
});
