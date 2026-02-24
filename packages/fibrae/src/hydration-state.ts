/**
 * HydrationState service — provides dehydrated atom state for client-side hydration.
 *
 * The default layer auto-discovers state from a <script type="application/json" id="__fibrae-state__">
 * tag in the DOM. This avoids polluting window with globals.
 *
 * For testing or custom transport, provide your own HydrationState layer.
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as S from "effect/Schema";
import { Hydration } from "@effect-atom/atom";

// =============================================================================
// Service
// =============================================================================

/**
 * Service that provides the dehydrated atom state array.
 * yield* HydrationState from any component or effect to access it.
 */
export class HydrationState extends Context.Tag("fibrae/HydrationState")<
  HydrationState,
  ReadonlyArray<Hydration.DehydratedAtom>
>() {}

// =============================================================================
// Schema
// =============================================================================

const DehydratedAtomSchema = S.Struct({
  "~@effect-atom/atom/DehydratedAtom": S.Literal(true),
  key: S.String,
  value: S.Unknown,
  dehydratedAt: S.Number,
  resultPromise: S.optional(S.Unknown),
});

const DehydratedStateSchema = S.Array(DehydratedAtomSchema);

const ParseDehydratedState = S.decodeUnknownSync(S.parseJson(DehydratedStateSchema));

// =============================================================================
// DOM element ID
// =============================================================================

const SCRIPT_ID = "__fibrae-state__";

// =============================================================================
// Layers
// =============================================================================

/**
 * Default layer: reads and parses <script type="application/json" id="__fibrae-state__">
 * from the current document. Returns [] if the element is missing.
 */
export const HydrationStateLive = Layer.effect(
  HydrationState,
  Effect.sync(() => {
    const el = document.getElementById(SCRIPT_ID);
    if (!el?.textContent) return [] as ReadonlyArray<Hydration.DehydratedAtom>;
    return ParseDehydratedState(el.textContent) as ReadonlyArray<Hydration.DehydratedAtom>;
  }),
);

/**
 * Empty layer for non-SSR renders or testing.
 */
export const HydrationStateEmpty = Layer.succeed(
  HydrationState,
  [] as ReadonlyArray<Hydration.DehydratedAtom>,
);
