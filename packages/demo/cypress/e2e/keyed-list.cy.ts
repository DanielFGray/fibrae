/**
 * Keyed List Reconciliation E2E Tests
 *
 * Verifies that keyed elements maintain DOM identity across reorders,
 * insertions, and removals. The key test: type text into inputs, reorder,
 * and confirm the typed text follows its keyed element.
 */

describe("Keyed List Reconciliation", () => {
  beforeEach(() => {
    cy.visit("/keyed-list-test.html");
    cy.getCy("controls", { timeout: 5000 }).should("exist");
  });

  // =========================================================================
  // Helpers
  // =========================================================================

  /** Get ordered item IDs from the DOM. */
  const getItemIds = () =>
    cy
      .getCy("list-item")
      .then(($items) => [...$items].map((el) => Number(el.getAttribute("data-item-id"))));

  /** Get ordered labels from the DOM. */
  const getLabels = () =>
    cy.getCy("item-label").then(($labels) => [...$labels].map((el) => el.textContent));

  /** Type into the input for a specific item by data-item-id. */
  const typeInItem = (id: number, text: string) =>
    cy.get(`[data-item-id="${id}"] [data-cy="item-input"]`).type(text);

  /** Assert the input value for a specific item. */
  const assertInputValue = (id: number, expected: string) =>
    cy.get(`[data-item-id="${id}"] [data-cy="item-input"]`).should("have.value", expected);

  // =========================================================================
  // Initial render
  // =========================================================================

  it("renders initial items in order", () => {
    getLabels().should("deep.equal", ["Alpha", "Beta", "Gamma"]);
    getItemIds().should("deep.equal", [1, 2, 3]);
    cy.getCy("item-count").should("contain", "Items: 3");
  });

  // =========================================================================
  // Reorder operations — DOM identity preservation
  // =========================================================================

  describe("reorder preserves DOM identity", () => {
    beforeEach(() => {
      // Type unique text into each input to test DOM identity
      typeInItem(1, "aaa");
      typeInItem(2, "bbb");
      typeInItem(3, "ccc");
    });

    it("reverse preserves input values", () => {
      cy.getCy("btn-reverse").click();

      // Order should be reversed
      getLabels().should("deep.equal", ["Gamma", "Beta", "Alpha"]);
      getItemIds().should("deep.equal", [3, 2, 1]);

      // Input values should follow their keyed elements
      assertInputValue(1, "aaa");
      assertInputValue(2, "bbb");
      assertInputValue(3, "ccc");
    });

    it("first-to-end preserves input values", () => {
      cy.getCy("btn-first-to-end").click();

      getLabels().should("deep.equal", ["Beta", "Gamma", "Alpha"]);
      getItemIds().should("deep.equal", [2, 3, 1]);

      assertInputValue(1, "aaa");
      assertInputValue(2, "bbb");
      assertInputValue(3, "ccc");
    });

    it("last-to-start preserves input values", () => {
      cy.getCy("btn-last-to-start").click();

      getLabels().should("deep.equal", ["Gamma", "Alpha", "Beta"]);
      getItemIds().should("deep.equal", [3, 1, 2]);

      assertInputValue(1, "aaa");
      assertInputValue(2, "bbb");
      assertInputValue(3, "ccc");
    });

    it("swap first two preserves input values", () => {
      cy.getCy("btn-swap-12").click();

      getLabels().should("deep.equal", ["Beta", "Alpha", "Gamma"]);
      getItemIds().should("deep.equal", [2, 1, 3]);

      assertInputValue(1, "aaa");
      assertInputValue(2, "bbb");
      assertInputValue(3, "ccc");
    });

    it("double reverse returns to original order", () => {
      cy.getCy("btn-reverse").click();
      cy.getCy("btn-reverse").click();

      getLabels().should("deep.equal", ["Alpha", "Beta", "Gamma"]);

      assertInputValue(1, "aaa");
      assertInputValue(2, "bbb");
      assertInputValue(3, "ccc");
    });
  });

  // =========================================================================
  // Insertion
  // =========================================================================

  describe("insertion", () => {
    it("prepend adds item at start without disrupting existing", () => {
      typeInItem(1, "aaa");
      cy.getCy("btn-prepend").click();

      cy.getCy("item-count").should("contain", "Items: 4");
      getItemIds().then((ids) => {
        expect(ids[0]).to.equal(4); // New item at start
        expect(ids[1]).to.equal(1);
        expect(ids[2]).to.equal(2);
        expect(ids[3]).to.equal(3);
      });

      // Existing item's input preserved
      assertInputValue(1, "aaa");
    });

    it("append adds item at end without disrupting existing", () => {
      typeInItem(3, "ccc");
      cy.getCy("btn-append").click();

      cy.getCy("item-count").should("contain", "Items: 4");
      getItemIds().then((ids) => {
        expect(ids[0]).to.equal(1);
        expect(ids[1]).to.equal(2);
        expect(ids[2]).to.equal(3);
        expect(ids[3]).to.equal(4); // New item at end
      });

      assertInputValue(3, "ccc");
    });

    it("insert middle adds item between existing", () => {
      typeInItem(1, "aaa");
      typeInItem(2, "bbb");
      cy.getCy("btn-insert-middle").click();

      cy.getCy("item-count").should("contain", "Items: 4");
      // New item should be between position 1 and 2 (index-wise between Alpha and Beta)
      getItemIds().then((ids) => {
        expect(ids[0]).to.equal(1);
        expect(ids[1]).to.equal(4); // New item inserted at middle
        expect(ids[2]).to.equal(2);
        expect(ids[3]).to.equal(3);
      });

      assertInputValue(1, "aaa");
      assertInputValue(2, "bbb");
    });
  });

  // =========================================================================
  // Removal
  // =========================================================================

  describe("removal", () => {
    it("remove first preserves remaining items", () => {
      typeInItem(2, "bbb");
      typeInItem(3, "ccc");
      cy.getCy("btn-remove-first").click();

      cy.getCy("item-count").should("contain", "Items: 2");
      getLabels().should("deep.equal", ["Beta", "Gamma"]);

      assertInputValue(2, "bbb");
      assertInputValue(3, "ccc");
    });

    it("remove middle preserves surrounding items", () => {
      typeInItem(1, "aaa");
      typeInItem(3, "ccc");
      cy.getCy("btn-remove-middle").click();

      cy.getCy("item-count").should("contain", "Items: 2");
      getLabels().should("deep.equal", ["Alpha", "Gamma"]);

      assertInputValue(1, "aaa");
      assertInputValue(3, "ccc");
    });

    it("remove last preserves remaining items", () => {
      typeInItem(1, "aaa");
      typeInItem(2, "bbb");
      cy.getCy("btn-remove-last").click();

      cy.getCy("item-count").should("contain", "Items: 2");
      getLabels().should("deep.equal", ["Alpha", "Beta"]);

      assertInputValue(1, "aaa");
      assertInputValue(2, "bbb");
    });

    it("remove all items renders empty list", () => {
      cy.getCy("btn-remove-first").click();
      cy.getCy("btn-remove-first").click();
      cy.getCy("btn-remove-first").click();

      cy.getCy("item-count").should("contain", "Items: 0");
      cy.getCy("list-item").should("not.exist");
    });
  });

  // =========================================================================
  // Combined operations
  // =========================================================================

  describe("combined operations", () => {
    it("insert then reorder maintains all identities", () => {
      typeInItem(1, "aaa");
      typeInItem(2, "bbb");
      typeInItem(3, "ccc");

      // Prepend a new item
      cy.getCy("btn-prepend").click();
      typeInItem(4, "ddd");

      // Reverse the whole list
      cy.getCy("btn-reverse").click();

      // All input values should be preserved
      assertInputValue(1, "aaa");
      assertInputValue(2, "bbb");
      assertInputValue(3, "ccc");
      assertInputValue(4, "ddd");

      // Order should be reversed: [3, 2, 1, 4] from [4, 1, 2, 3]
      getItemIds().should("deep.equal", [3, 2, 1, 4]);
    });

    it("remove then insert reuses no stale DOM", () => {
      // Remove first item
      cy.getCy("btn-remove-first").click();
      getLabels().should("deep.equal", ["Beta", "Gamma"]);

      // Prepend new item
      cy.getCy("btn-prepend").click();
      cy.getCy("item-count").should("contain", "Items: 3");

      // New item should have a fresh input (not Alpha's old input)
      getItemIds().then((ids) => {
        expect(ids[0]).to.equal(4);
        cy.get(`[data-item-id="4"] [data-cy="item-input"]`).should("have.value", "");
      });
    });

    it("reset restores original state", () => {
      cy.getCy("btn-reverse").click();
      cy.getCy("btn-prepend").click();
      cy.getCy("btn-remove-last").click();

      cy.getCy("btn-reset").click();

      getLabels().should("deep.equal", ["Alpha", "Beta", "Gamma"]);
      getItemIds().should("deep.equal", [1, 2, 3]);
      cy.getCy("item-count").should("contain", "Items: 3");
    });
  });
});
