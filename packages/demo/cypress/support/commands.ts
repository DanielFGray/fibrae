/// <reference types="cypress" />

type Chainable<Subject = any> = Cypress.Chainable<Subject>;

type CyGetOpts = Prettify<Parameters<typeof cy.get>["1"]>;

function getCy(
  cyName: string,
  opts?: CyGetOpts,
): Chainable<JQuery<HTMLElement>> {
  return cy.get(`[data-cy=${cyName}]`, opts);
}
Cypress.Commands.add("getCy", getCy);

export {}; // Make this a module so we can `declare global`

declare global {
  namespace Cypress {
    interface Chainable {
      getCy: typeof getCy;
    }
  }
}
