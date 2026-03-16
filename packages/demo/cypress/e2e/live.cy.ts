/**
 * LiveSync E2E Tests
 *
 * Tests SSE-based live data synchronization:
 * - Single channel (connect)
 * - Multi channel (connectGroup)
 * - SSE protocol (monotonic IDs, retry directive)
 */

describe("LiveSync", () => {
  // ===========================================================================
  // connect — single channel
  // ===========================================================================

  describe("connect (single channel)", () => {
    beforeEach(() => {
      cy.visit("/ssr/live-test");
    });

    it("SSR renders placeholder, then hydrates with live data", () => {
      cy.get('[data-cy="single-clock"]', { timeout: 10000 })
        .invoke("text")
        .should("match", /\d{4}-\d{2}-\d{2}/);
    });

    it("atom updates when new SSE events arrive", () => {
      cy.get('[data-cy="single-clock"]', { timeout: 10000 })
        .invoke("text")
        .should("match", /\d{4}-\d{2}-\d{2}/)
        .then((first) => {
          cy.wait(1500);
          cy.get('[data-cy="single-clock"]').invoke("text").should("not.eq", first);
        });
    });
  });

  // ===========================================================================
  // connectGroup — multiple channels over one EventSource
  // ===========================================================================

  describe("connectGroup (multi channel)", () => {
    beforeEach(() => {
      cy.visit("/ssr/live-test");
    });

    it("syncs the clock channel atom", () => {
      cy.get('[data-cy="multi-clock"]', { timeout: 10000 })
        .invoke("text")
        .should("match", /\d{4}-\d{2}-\d{2}/);
    });

    it("syncs the counter channel atom to a value > 0", () => {
      cy.get('[data-cy="multi-counter"]', { timeout: 10000 }).invoke("text").should("not.eq", "0");
    });

    it("counter increments over time", () => {
      cy.get('[data-cy="multi-counter"]', { timeout: 10000 })
        .invoke("text")
        .should("not.eq", "0")
        .then((first) => {
          cy.wait(1500);
          cy.get('[data-cy="multi-counter"]')
            .invoke("text")
            .then((second) => {
              expect(Number(second)).to.be.greaterThan(Number(first));
            });
        });
    });
  });

  // ===========================================================================
  // SSE protocol features — id and retry
  // ===========================================================================

  describe("SSE protocol", () => {
    it("events carry monotonic id field (single channel)", () => {
      cy.visit("/ssr/live-test");
      cy.window()
        .then(
          (win) =>
            new Cypress.Promise<{ id: string; data: string }[]>((resolve, reject) => {
              const events: { id: string; data: string }[] = [];
              const es = new win.EventSource("/api/live/test-clock");

              es.addEventListener("single-clock", ((e: MessageEvent) => {
                events.push({ id: e.lastEventId, data: e.data });
                if (events.length >= 3) {
                  es.close();
                  resolve(events);
                }
              }) as EventListener);

              es.addEventListener("error", () => {
                es.close();
                reject(new Error("SSE connection error"));
              });
              setTimeout(() => {
                es.close();
                reject(new Error("SSE timeout"));
              }, 10000);
            }),
        )
        .then((events) => {
          expect(events[0].id).to.eq("0");
          expect(events[1].id).to.eq("1");
          expect(events[2].id).to.eq("2");
        });
    });

    it("events carry monotonic id field (multi channel)", () => {
      cy.visit("/ssr/live-test");
      cy.window()
        .then(
          (win) =>
            new Cypress.Promise<string[]>((resolve, reject) => {
              const ids: string[] = [];
              const es = new win.EventSource("/api/live/test-multi");

              const handler = ((e: MessageEvent) => {
                ids.push(e.lastEventId);
                if (ids.length >= 4) {
                  es.close();
                  resolve(ids);
                }
              }) as EventListener;

              es.addEventListener("clock", handler);
              es.addEventListener("counter", handler);

              es.addEventListener("error", () => {
                es.close();
                reject(new Error("SSE connection error"));
              });
              setTimeout(() => {
                es.close();
                reject(new Error("SSE timeout"));
              }, 10000);
            }),
        )
        .then((ids) => {
          ids.forEach((id) => expect(Number(id)).to.be.a("number"));
          const nums = ids.map(Number);
          for (let i = 1; i < nums.length; i++) {
            expect(nums[i]).to.be.greaterThan(nums[i - 1]);
          }
        });
    });

    it("stream includes retry directive", () => {
      cy.task("readSSEStream", {
        url: "http://localhost:3015/api/live/test-clock",
        timeoutMs: 5000,
      }).then((raw) => {
        expect(raw).to.include("retry: 5000");
        expect(raw).to.include("id: ");
        expect(raw).to.include("event: single-clock");
      });
    });

    it("multi-channel stream includes retry directive", () => {
      cy.task("readSSEStream", {
        url: "http://localhost:3015/api/live/test-multi",
        waitFor: ["retry:", "event: clock", "event: counter"],
        timeoutMs: 5000,
      }).then((raw) => {
        expect(raw).to.include("retry: 3000");
        expect(raw).to.include("event: clock");
        expect(raw).to.include("event: counter");
      });
    });
  });
});
