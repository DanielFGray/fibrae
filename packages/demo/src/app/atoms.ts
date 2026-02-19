/**
 * Shared atoms for the app
 */

import * as Schema from "effect/Schema";
import { Atom } from "fibrae";

// =============================================================================
// Theme Atom
// =============================================================================

export type Theme = "light" | "dark";

const ThemeSchema = Schema.Literal("light", "dark");

/**
 * Theme atom - persisted to localStorage
 */
export const ThemeAtom = Atom.make<Theme>("light").pipe(
  Atom.serializable({ key: "app-theme", schema: ThemeSchema }),
);

// =============================================================================
// Auth Atoms
// =============================================================================

const NullableStringSchema = Schema.NullOr(Schema.String);

/**
 * Current user - null when not logged in
 */
export const CurrentUserAtom = Atom.make<string | null>(null).pipe(
  Atom.serializable({ key: "current-user", schema: NullableStringSchema }),
);

/**
 * Auth loading state
 */
export const AuthLoadingAtom = Atom.make(false);
