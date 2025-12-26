/// <reference types="cypress" />

type Prettify<T> = { [K in keyof T]: T[K] } & {};

type Chainable<Subject = any> = Cypress.Chainable<Subject>;

type CyGetOpts = Prettify<Parameters<typeof cy.get>["1"]>;

function getCy(cyName: string, opts?: CyGetOpts): Chainable<JQuery<HTMLElement>> {
  return cy.get(`[data-cy="${cyName}"]`, opts);
}
Cypress.Commands.add("getCy", getCy);

export {}; // Make this a module so we can `declare global`

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cypress {
    interface Chainable {
      getCy: typeof getCy;
    }
  }
}
