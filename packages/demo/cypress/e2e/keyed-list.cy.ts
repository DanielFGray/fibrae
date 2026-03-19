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

  // =========================================================================
  // Cycle operations
  // =========================================================================

  describe("cycle operations", () => {
    beforeEach(() => {
      // Add a 4th item so we can do a full 4-step cycle
      cy.getCy("btn-append").click();
      // Now we have [Alpha(1), Beta(2), Gamma(3), Item-4(4)]
      typeInItem(1, "aaa");
      typeInItem(2, "bbb");
      typeInItem(3, "ccc");
      typeInItem(4, "ddd");
    });

    it("full 4-step cycle rotation preserves input values and returns to original", () => {
      // Step 1: [B, C, D, A]
      cy.getCy("btn-cycle").click();
      getItemIds().should("deep.equal", [2, 3, 4, 1]);
      assertInputValue(1, "aaa");
      assertInputValue(2, "bbb");
      assertInputValue(3, "ccc");
      assertInputValue(4, "ddd");

      // Step 2: [C, D, A, B]
      cy.getCy("btn-cycle").click();
      getItemIds().should("deep.equal", [3, 4, 1, 2]);
      assertInputValue(1, "aaa");
      assertInputValue(2, "bbb");

      // Step 3: [D, A, B, C]
      cy.getCy("btn-cycle").click();
      getItemIds().should("deep.equal", [4, 1, 2, 3]);

      // Step 4: back to original [A, B, C, D]
      cy.getCy("btn-cycle").click();
      getItemIds().should("deep.equal", [1, 2, 3, 4]);

      // All input values intact after full rotation
      assertInputValue(1, "aaa");
      assertInputValue(2, "bbb");
      assertInputValue(3, "ccc");
      assertInputValue(4, "ddd");
    });

    it("reverse cycle rotation preserves input values", () => {
      // [D, A, B, C]
      cy.getCy("btn-cycle-reverse").click();
      getItemIds().should("deep.equal", [4, 1, 2, 3]);

      assertInputValue(1, "aaa");
      assertInputValue(2, "bbb");
      assertInputValue(3, "ccc");
      assertInputValue(4, "ddd");
    });
  });

  // =========================================================================
  // Null / remove edge cases
  // =========================================================================

  describe("null and remove edge cases", () => {
    it("remove first and reorder remaining preserves identity", () => {
      typeInItem(2, "bbb");
      typeInItem(3, "ccc");

      cy.getCy("btn-null-first").click();
      getLabels().should("deep.equal", ["Beta", "Gamma"]);

      // Reverse the remaining
      cy.getCy("btn-reverse").click();
      getLabels().should("deep.equal", ["Gamma", "Beta"]);

      assertInputValue(2, "bbb");
      assertInputValue(3, "ccc");
    });

    it("replace with subset removes items and preserves survivors", () => {
      typeInItem(1, "aaa");
      typeInItem(2, "bbb");
      typeInItem(3, "ccc");

      // Remove middle (Beta), keeping Alpha and Gamma
      cy.getCy("btn-remove-middle").click();
      cy.getCy("item-count").should("contain", "Items: 2");
      getItemIds().should("deep.equal", [1, 3]);

      assertInputValue(1, "aaa");
      assertInputValue(3, "ccc");
    });

    it("remove all then add new — new items have fresh state", () => {
      typeInItem(1, "aaa");

      // Clear all
      cy.getCy("btn-clear-all").click();
      cy.getCy("item-count").should("contain", "Items: 0");
      cy.getCy("list-item").should("not.exist");

      // Add new items
      cy.getCy("btn-append").click();
      cy.getCy("btn-append").click();
      cy.getCy("item-count").should("contain", "Items: 2");

      // New items should have empty inputs (no stale DOM reuse)
      cy.getCy("item-input").each(($input) => {
        expect($input).to.have.value("");
      });
    });

    it("zero children to many children", () => {
      cy.getCy("btn-clear-all").click();
      cy.getCy("list-item").should("not.exist");

      // Grow from zero (reset gives 3 items)
      cy.getCy("btn-reset").click();
      cy.getCy("item-count").should("contain", "Items: 3");
      getLabels().should("deep.equal", ["Alpha", "Beta", "Gamma"]);
    });

    it("many children to zero and back", () => {
      typeInItem(1, "aaa");

      cy.getCy("btn-clear-all").click();
      cy.getCy("item-count").should("contain", "Items: 0");
      cy.getCy("list-item").should("not.exist");

      cy.getCy("btn-reset").click();
      cy.getCy("item-count").should("contain", "Items: 3");
      getLabels().should("deep.equal", ["Alpha", "Beta", "Gamma"]);

      // Input should be fresh (not stale from before clear)
      cy.get(`[data-item-id="1"] [data-cy="item-input"]`).should("have.value", "");
    });
  });

  // =========================================================================
  // Replace operations
  // =========================================================================

  describe("replace operations", () => {
    it("replace all with entirely new keyed items — old DOM gone, new created", () => {
      typeInItem(1, "aaa");
      typeInItem(2, "bbb");

      cy.getCy("btn-replace-all").click();

      // Old items should be gone
      cy.get(`[data-item-id="1"]`).should("not.exist");
      cy.get(`[data-item-id="2"]`).should("not.exist");
      cy.get(`[data-item-id="3"]`).should("not.exist");

      // New items with new IDs
      cy.getCy("item-count").should("contain", "Items: 3");
      getLabels().should("deep.equal", ["Xray", "Yankee", "Zulu"]);

      // New items have empty inputs
      cy.getCy("item-input").each(($input) => {
        expect($input).to.have.value("");
      });
    });

    it("grow from 3 to 7 — original 3 preserve input values", () => {
      typeInItem(1, "aaa");
      typeInItem(2, "bbb");
      typeInItem(3, "ccc");

      cy.getCy("btn-grow").click();

      cy.getCy("item-count").should("contain", "Items: 7");

      // Original items preserve their values
      assertInputValue(1, "aaa");
      assertInputValue(2, "bbb");
      assertInputValue(3, "ccc");

      // 4 new items appended with fresh empty inputs
      cy.getCy("list-item").should("have.length", 7);
    });
  });

  // =========================================================================
  // Stress / complex patterns
  // =========================================================================

  describe("stress and complex patterns", () => {
    it("interleave — add new items between every existing item", () => {
      typeInItem(1, "aaa");
      typeInItem(2, "bbb");
      typeInItem(3, "ccc");

      cy.getCy("btn-interleave").click();

      // Should go from 3 to 6: [A, new, B, new, C, new]
      cy.getCy("item-count").should("contain", "Items: 6");

      // Original items preserve values
      assertInputValue(1, "aaa");
      assertInputValue(2, "bbb");
      assertInputValue(3, "ccc");

      // Verify interleave pattern: originals at even indices (0, 2, 4)
      getItemIds().then((ids) => {
        expect(ids[0]).to.equal(1); // Alpha
        // ids[1] = new item
        expect(ids[2]).to.equal(2); // Beta
        // ids[3] = new item
        expect(ids[4]).to.equal(3); // Gamma
        // ids[5] = new item
      });
    });

    it("remove from middle and prepend simultaneously", () => {
      typeInItem(1, "aaa");
      typeInItem(3, "ccc");

      // Removes Beta (id=2), prepends a new item
      cy.getCy("btn-remove-middle-prepend").click();

      // Beta should be gone
      cy.get(`[data-item-id="2"]`).should("not.exist");

      // New item prepended
      cy.getCy("item-count").should("contain", "Items: 3");
      getItemIds().then((ids) => {
        expect(ids[0]).to.equal(4); // New prepended item
        expect(ids[1]).to.equal(1); // Alpha
        expect(ids[2]).to.equal(3); // Gamma
      });

      // Surviving items preserve input values
      assertInputValue(1, "aaa");
      assertInputValue(3, "ccc");
    });

    it("shuffle preserves DOM identity (deterministic)", () => {
      typeInItem(1, "aaa");
      typeInItem(2, "bbb");
      typeInItem(3, "ccc");

      cy.getCy("btn-shuffle").click();

      // Order changed but all items still present
      cy.getCy("item-count").should("contain", "Items: 3");

      // Input values follow their keyed elements
      assertInputValue(1, "aaa");
      assertInputValue(2, "bbb");
      assertInputValue(3, "ccc");
    });
  });

  // =========================================================================
  // Ref behavior
  // =========================================================================

  describe("ref behavior", () => {
    it("object ref receives DOM element on mount", () => {
      cy.getCy("ref-target").should("exist");

      // queueMicrotask runs after commit — wait for it
      cy.window().its("refTestResults").should("have.property", "objRefExists", true);
      cy.window().its("refTestResults").should("have.property", "objRefTagName", "DIV");
    });

    it("object ref is set to null on unmount", () => {
      cy.getCy("ref-target").should("exist");
      cy.window().its("refTestResults").should("have.property", "objRefExists", true);

      // Unmount ref target
      cy.getCy("ref-toggle").click();
      cy.getCy("ref-placeholder").should("exist");

      // After re-render, microtask reports null
      cy.window().its("refTestResults").should("have.property", "objRefExists", false);
      cy.window().its("refTestResults").should("have.property", "objRefTagName", null);
    });

    it("function ref called with element on mount", () => {
      cy.getCy("fn-ref-target").should("exist");

      cy.window()
        .its("refTestResults")
        .its("callbackLog")
        .should("be.an", "array")
        .and("include", "fn-ref:DIV");
    });

    it("function ref called with null on unmount", () => {
      cy.getCy("fn-ref-target").should("exist");

      // Unmount
      cy.getCy("ref-toggle").click();
      cy.getCy("fn-ref-placeholder").should("exist");

      cy.window()
        .its("refTestResults")
        .its("callbackLog")
        .should("be.an", "array")
        .and("include", "fn-ref:null");
    });

    it("ref hops between elements on re-render", () => {
      // Initially on div1
      cy.getCy("hop-div1").should("exist");
      cy.window().its("refTestResults").should("have.property", "hopRefDataCy", "hop-div1");

      // Hop to div2
      cy.getCy("ref-hop-toggle").click();
      cy.getCy("hop-div2").should("exist");
      cy.window().its("refTestResults").should("have.property", "hopRefDataCy", "hop-div2");
    });
  });
});
