// Canonical entry exports core renderer
export type * from "./core.js";
export * from "./core.js";

// Re-export upstream Effect Atom APIs for consumers
export { Atom, Registry as AtomRegistry } from "@effect-atom/atom";
