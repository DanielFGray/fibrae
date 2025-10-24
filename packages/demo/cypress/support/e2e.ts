/// <reference types="cypress" />
import "./commands";

// Capture and log browser console messages
Cypress.on('window:before:load', (win) => {
  cy.spy(win.console, 'log').as('consoleLog');
});
