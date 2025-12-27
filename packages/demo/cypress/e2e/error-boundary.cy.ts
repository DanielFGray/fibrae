describe("ErrorBoundary", () => {
  beforeEach(() => {
    cy.visit("/examples.html");
  });

  describe("basic error handling", () => {
    it("catches render-time crash and shows fallback", () => {
      cy.getCy("fallback-render", { timeout: 5000 }).should("exist");
      cy.getCy("fallback-render").should("contain", "Render Error");
    });

    it("catches event handler Effect failures", () => {
      // Initially the button should be visible (no error yet)
      cy.getCy("fail-event", { timeout: 5000 }).should("exist");

      // Click the button that returns a failing Effect
      cy.getCy("fail-event").click();

      // ErrorBoundary should catch and show fallback with typed EventHandlerError info
      cy.getCy("fallback-event", { timeout: 5000 }).should("exist");
      // Verify the error handler received EventHandlerError with correct eventType
      cy.getCy("fallback-event").should("contain", "EventHandlerError");
      cy.getCy("fallback-event").should("contain", "eventType: click");
    });

    it("catches stream failures after first emission", () => {
      // Debug: log what's in the error container
      cy.getCy("error-container", { timeout: 5000 }).then(($el) => {
        cy.log("Error container HTML:", $el.html());
      });

      // Stream emits once successfully first - should see "Stream OK once" before error
      cy.getCy("stream-ok", { timeout: 5000 }).should("exist").and("contain", "Stream OK once");

      // After 300ms delay, stream fails - ErrorBoundary should catch
      cy.getCy("fallback-stream", { timeout: 5000 }).should("exist").and("contain", "Stream Error");

      // The stream-ok should be gone once fallback appears
      cy.getCy("stream-ok").should("not.exist");
    });

    it("catches stream failures before first emission", () => {
      // Stream fails immediately before emitting anything
      // ErrorBoundary should catch and show fallback
      cy.getCy("fallback-stream-immediate", { timeout: 5000 }).should("exist");
      cy.getCy("fallback-stream-immediate").should("contain", "Stream Immediate Error");
    });
  });

  describe("Suspense interaction", () => {
    it("takes precedence over Suspense fallback when child fails", () => {
      // First, Suspense should show loading (component takes 200ms > 100ms threshold)
      cy.getCy("suspense-loading", { timeout: 5000 }).should("exist");
      cy.getCy("suspense-loading").should("contain", "Loading slow component");

      // After ~200ms, component fails - ErrorBoundary should take over
      // Suspense loading should be GONE, replaced by ErrorBoundary fallback
      cy.getCy("fallback-suspense-error", { timeout: 5000 }).should("exist");
      cy.getCy("fallback-suspense-error").should("contain", "Suspense Error Precedence");

      // Critically: Suspense loading should no longer be visible
      cy.getCy("suspense-loading").should("not.exist");
    });
  });

  describe("typed error handling with Stream.catchTags", () => {
    it("RenderError includes componentName", () => {
      // The boundary-wrapped component that crashes during render should show fallback
      cy.getCy("boundary-fallback-render", { timeout: 5000 }).should("exist");
      cy.getCy("boundary-fallback-render").should("contain", "Boundary Render Error");
    });

    it("EventHandlerError includes eventType", () => {
      // Initially the button should be visible (no error yet)
      cy.getCy("boundary-fail-event", { timeout: 5000 }).should("exist");

      // Click the button that returns a failing Effect
      cy.getCy("boundary-fail-event").click();

      // ErrorBoundary should catch and show fallback via Stream.catchTags
      cy.getCy("boundary-fallback-event", { timeout: 5000 }).should("exist");
      cy.getCy("boundary-fallback-event").should("contain", "Boundary Event Error");
      cy.getCy("boundary-fallback-event").should("contain", "click");
    });

    it("StreamError includes phase", () => {
      // Stream emits once successfully first
      cy.getCy("boundary-stream-ok", { timeout: 5000 }).should("exist");

      // After delay, stream fails - ErrorBoundary should catch
      cy.getCy("boundary-fallback-stream", { timeout: 5000 }).should("exist");
      cy.getCy("boundary-fallback-stream").should("contain", "Boundary Stream Error");

      // The original content should be gone
      cy.getCy("boundary-stream-ok").should("not.exist");
    });
  });
});
