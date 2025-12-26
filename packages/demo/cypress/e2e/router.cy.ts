/**
 * Router E2E tests - tests against the main demo app
 *
 * Consolidates tests for:
 * - Link component (href rendering, SPA navigation, active states)
 * - Navigator service (programmatic navigation, back/forward)
 * - Route matching (static routes, dynamic params, search params)
 * - RouterBuilder (loaders, components)
 */

describe("Router", () => {
  beforeEach(() => {
    cy.visit("http://localhost:5173/");
  });

  describe("navigation links", () => {
    it("should render nav links with correct hrefs", () => {
      cy.getCy("nav-home").should("have.attr", "href", "/");
      cy.getCy("nav-counter").should("have.attr", "href", "/counter");
      cy.getCy("nav-todos").should("have.attr", "href", "/todos");
      cy.getCy("nav-posts").should("have.attr", "href", "/posts");
    });

    it("should have active class on current route", () => {
      cy.getCy("nav-home").should("have.class", "active");
      cy.getCy("nav-counter").should("not.have.class", "active");
    });

    it("should update active class on navigation", () => {
      cy.getCy("nav-counter").click();
      cy.getCy("nav-home").should("not.have.class", "active");
      cy.getCy("nav-counter").should("have.class", "active");
    });

    it("should navigate without page reload (SPA)", () => {
      cy.getCy("nav-counter").click();
      cy.url().should("include", "/counter");
      cy.getCy("page-title").should("contain", "Counter");
    });
  });

  describe("route matching", () => {
    it("should match home route", () => {
      cy.getCy("page-title").should("contain", "Home");
    });

    it("should match counter route", () => {
      cy.getCy("nav-counter").click();
      cy.getCy("page-title").should("contain", "Counter");
    });

    it("should match todos route", () => {
      cy.getCy("nav-todos").click();
      cy.getCy("page-title").should("contain", "Todos");
    });

    it("should match posts route", () => {
      cy.getCy("nav-posts").click();
      cy.getCy("page-title").should("contain", "Posts");
    });
  });

  describe("dynamic routes", () => {
    it("should navigate to post detail with params", () => {
      cy.getCy("nav-posts").click();
      cy.getCy("post-link-1").click();
      cy.url().should("include", "/posts/1");
      cy.getCy("page-title").should("contain", "Post");
      cy.getCy("post-id").should("contain", "1");
    });

    it("should extract typed params from URL", () => {
      cy.getCy("nav-posts").click();
      cy.getCy("post-link-2").click();
      cy.getCy("post-id").should("contain", "2");
      cy.getCy("post-id-type").should("contain", "number");
    });
  });

  describe("search params", () => {
    it("should navigate with search params", () => {
      cy.getCy("nav-posts").click();
      cy.getCy("sort-by-date").click();
      cy.url().should("include", "sort=date");
      cy.getCy("current-sort").should("contain", "date");
    });
  });

  describe("history navigation", () => {
    it("should go back to previous route", () => {
      cy.getCy("nav-counter").click();
      cy.getCy("page-title").should("contain", "Counter");
      cy.getCy("nav-todos").click();
      cy.getCy("page-title").should("contain", "Todos");
      cy.getCy("back-btn").click();
      cy.getCy("page-title").should("contain", "Counter");
    });

    it("should go forward after back", () => {
      cy.getCy("nav-counter").click();
      cy.getCy("nav-todos").click();
      cy.getCy("back-btn").click();
      cy.getCy("page-title").should("contain", "Counter");
      cy.getCy("forward-btn").click();
      cy.getCy("page-title").should("contain", "Todos");
    });
  });

  describe("counter page", () => {
    beforeEach(() => {
      cy.getCy("nav-counter").click();
    });

    it("should render counter with initial value", () => {
      cy.getCy("counter-value").should("contain", "0");
    });

    it("should increment counter", () => {
      cy.getCy("counter-increment").click();
      cy.getCy("counter-value").should("contain", "1");
    });

    it("should decrement counter", () => {
      cy.getCy("counter-increment").click();
      cy.getCy("counter-increment").click();
      cy.getCy("counter-decrement").click();
      cy.getCy("counter-value").should("contain", "1");
    });
  });

  describe("todos page", () => {
    beforeEach(() => {
      cy.getCy("nav-todos").click();
    });

    it("should add a todo", () => {
      cy.getCy("todo-input").type("Buy milk");
      cy.getCy("todo-add").click();
      cy.getCy("todo-item").should("contain", "Buy milk");
    });

    it("should toggle todo completion", () => {
      cy.getCy("todo-input").type("Test todo");
      cy.getCy("todo-add").click();
      cy.getCy("todo-checkbox").first().click();
      cy.getCy("todo-text").first().should("have.css", "text-decoration-line", "line-through");
    });

    it("should remove a todo", () => {
      cy.getCy("todo-input").type("Delete me");
      cy.getCy("todo-add").click();
      cy.getCy("todo-item").should("have.length", 1);
      cy.getCy("todo-remove").first().click();
      cy.getCy("todo-item").should("have.length", 0);
    });
  });

  describe("posts page", () => {
    beforeEach(() => {
      cy.getCy("nav-posts").click();
    });

    it("should display list of posts", () => {
      cy.getCy("post-link").should("have.length.at.least", 1);
    });

    it("should navigate to post detail", () => {
      cy.getCy("post-link-1").click();
      cy.getCy("post-id").should("contain", "1");
    });

    it("should go back from post detail to posts list", () => {
      cy.getCy("post-link-1").click();
      cy.getCy("back-btn").click();
      cy.getCy("page-title").should("contain", "Posts");
    });
  });
});
