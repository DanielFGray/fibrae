describe("Error Boundaries", () => {
  beforeEach(() => {
    cy.visit("/examples.html");
  });

  it("shows fallback for render-time crash", () => {
    cy.getCy("fallback-render", { timeout: 5000 }).should("exist");
    cy.getCy("fallback-render").should("contain", "Render Error");
  });

  it("shows fallback when event handler Effect fails", () => {
    // Initially the button should be visible (no error yet)
    cy.getCy("fail-event", { timeout: 5000 }).should("exist");
    
    // Click the button that returns a failing Effect
    cy.getCy("fail-event").click();
    
    // ErrorBoundary should catch and show fallback
    cy.getCy("fallback-event", { timeout: 5000 }).should("exist");
    cy.getCy("fallback-event").should("contain", "Event Error");
  });

  it("shows fallback when stream fails after first emission", () => {
    // Stream emits once successfully first
    cy.getCy("stream-ok", { timeout: 5000 }).should("exist");
    cy.getCy("stream-ok").should("contain", "Stream OK once");
    
    // After 300ms delay, stream fails - ErrorBoundary should catch
    cy.getCy("fallback-stream", { timeout: 5000 }).should("exist");
    cy.getCy("fallback-stream").should("contain", "Stream Error");
  });

  it("shows fallback when stream fails before first emission", () => {
    // Stream fails immediately before emitting anything
    // ErrorBoundary should catch and show fallback
    cy.getCy("fallback-stream-immediate", { timeout: 5000 }).should("exist");
    cy.getCy("fallback-stream-immediate").should("contain", "Stream Immediate Error");
  });

  it("ErrorBoundary takes precedence over Suspense fallback when child fails", () => {
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
