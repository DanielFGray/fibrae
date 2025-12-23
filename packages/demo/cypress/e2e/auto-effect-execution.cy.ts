beforeEach(() => {
  cy.visit("/");
});
describe("can click counters", () => {

  it("automatically executes Effects from counter buttons", () => {
    cy.getCy("counter-a").within(() => {
      cy.getCy("counter-value").should("contain", "Count: 0");
      cy.getCy("counter-increment").click();
      cy.getCy("counter-value").should("contain", "Count: 1");
      cy.getCy("counter-increment").click();
      cy.getCy("counter-value").should("contain", "Count: 2");
    });
  });

  it("handles multiple rapid clicks", () => {
    cy.getCy("counter-b").within(() => {
      cy.getCy("counter-value").should("contain", "Count: 0");
      // Requery between clicks since DOM may be replaced during re-render
      cy.getCy("counter-increment").click();
      cy.getCy("counter-increment").click();
      cy.getCy("counter-increment").click();
      cy.getCy("counter-value").should("contain", "Count: 3");
    });
  });

  it("counter decrement and reset work", () => {
    cy.getCy("counter-a").within(() => {
      // Requery between clicks since DOM may be replaced during re-render
      cy.getCy("counter-increment").click();
      cy.getCy("counter-increment").click();
      cy.getCy("counter-increment").click();
      cy.getCy("counter-value").should("contain", "Count: 3");
      cy.getCy("counter-decrement").click();
      cy.getCy("counter-value").should("contain", "Count: 2");
      cy.getCy("counter-reset").click();
      cy.getCy("counter-value").should("contain", "Count: 0");
    });
  });
})

describe("Todo List Functionality", () => {
  it("todo list adds and removes items", () => {
    cy.getCy("todo-input").type("Test todo 1");
    cy.getCy("todo-add").click();
    cy.getCy("todo-text").should("contain", "Test todo 1");

    cy.getCy("todo-input").type("Test todo 2{enter}");
    cy.getCy("todo-text").should("contain", "Test todo 2");

    cy.getCy("todo-text").contains("Test todo 1");

    // Click the first todo-remove button
    cy.getCy("todo-remove").first().click();
    cy.getCy("todo-text").contains("Test todo 1").should("not.exist");
  });

  it("todo items can be marked as completed", () => {
    cy.getCy("todo-input").type("Complete me{enter}");
    cy.getCy("todo-text").contains("Complete me");
    cy.getCy("todo-checkbox").first().click();
    cy.getCy("todo-text")
      .first()
      .should("have.css", "text-decoration")
      .and("include", "line-through");
  });

  it("can add a todo item", () => {
    cy.getCy("todo-input").type("Test todo 1");
    cy.getCy("todo-add").click();
    cy.getCy("todo-text").should("contain", "Test todo 1");
  });

  it("shows test counter button works in TodoItem", () => {
    cy.getCy("todo-input").type("Test todo 1");
    cy.getCy("todo-add").click();

    // Find the orange test button and verify it works
    cy.getCy("todo-text").contains("Test todo 1");
    cy.getCy("todo-test-button").should("contain", "Test: 0").click();
    cy.getCy("todo-test-button").should("contain", "Test: 1");
  });

  it("can remove a todo item", () => {
    cy.getCy("todo-input").type("Test todo 1");
    cy.getCy("todo-add").click();
    cy.getCy("todo-text").should("contain", "Test todo 1");

    cy.getCy("todo-remove").click();

    // After removing the only todo, there should be no todo-text elements at all
    cy.getCy("todo-text").should("not.exist");
  });

  it("multiple todos - test counter works for each", () => {
    cy.getCy("todo-input").type("First todo");
    cy.getCy("todo-add").click();
    cy.getCy("todo-input").type("Second todo");
    cy.getCy("todo-add").click();

    // Test that both todo items have working test counters
    cy.getCy("todo-text").contains("First todo");
    cy.getCy("todo-test-button").first().should("contain", "Test: 0").click();
    cy.getCy("todo-test-button").first().should("contain", "Test: 1");

    cy.getCy("todo-text").contains("Second todo");
    cy.getCy("todo-test-button").eq(1).should("contain", "Test: 0").click();
    cy.getCy("todo-test-button").eq(1).should("contain", "Test: 1");
  });

  it("multiple todos - can remove each individually", () => {
    cy.getCy("todo-input").type("First todo");
    cy.getCy("todo-add").click();
    cy.getCy("todo-input").type("Second todo");
    cy.getCy("todo-add").click();

    // Both should exist initially
    cy.getCy("todo-text").should("contain", "First todo");
    cy.getCy("todo-text").should("contain", "Second todo");

    // Click remove on first todo
    cy.getCy("todo-text").contains("First todo");
    cy.getCy("todo-remove").first().click();

    cy.getCy("todo-text").contains("First todo").should("not.exist");
    cy.getCy("todo-text").should("contain", "Second todo"); // Should still exist

    // Click remove on second todo (now it's the first/only one)
    cy.getCy("todo-remove").first().click();

    // After removing all todos, there should be no todo-text elements
    cy.getCy("todo-text").should("not.exist");
  });
});
