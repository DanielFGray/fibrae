/**
 * Server-side rendering for Fibrae
 *
 * Renders VElement trees to HTML strings for SSR.
 * Integrates with @effect-atom/atom's Hydration module for state serialization.
 *
 * Key design decisions (see docs/ssr-hydration-design.md):
 * - Streams restart on client (no server continuation)
 * - Atoms must use Atom.serializable() for state transfer
 * - Same components work on server and client
 */
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Option from "effect/Option";
import * as Deferred from "effect/Deferred";
// Import Layer type for declaration file emission
import type * as Layer from "effect/Layer";

import { Atom, Registry as AtomRegistry, Hydration } from "@effect-atom/atom";
import { type VElement, type ElementType, type Primitive, isStream, isProperty, RenderError } from "./shared.js";

// Re-export to satisfy declaration file requirements
export type { Layer };

// =============================================================================
// Types
// =============================================================================

/**
 * Result of renderToString - HTML plus serialized state
 *
 * The dehydratedState should be embedded as a JSON script tag:
 * <script type="application/json" id="__fibrae-state__">${JSON.stringify(dehydratedState)}</script>
 * The HydrationState service auto-discovers this tag during render().
 */
export interface RenderResult {
  readonly html: string;
  readonly dehydratedState: ReadonlyArray<Hydration.DehydratedAtom>;
}

/**
 * Options for SSR rendering
 */
export interface RenderOptions {
  /**
   * Initial atom values to use during rendering.
   * These will be set on the registry before rendering begins.
   */
  readonly initialValues?: Iterable<readonly [Atom.Atom<unknown>, unknown]>;
}

// =============================================================================
// SSR Registry Layer
// =============================================================================

/**
 * Create a synchronous AtomRegistry layer for SSR.
 * Uses synchronous task scheduling since we're not in a browser.
 */
const SSRAtomRegistryLayer = AtomRegistry.layerOptions({
  scheduleTask: (f: () => void) => f(),
});

/**
 * Exported for SSR scenarios that need to compose with other layers.
 * Use this when you need to provide additional services (e.g., Navigator, RouterHandlers)
 * alongside the AtomRegistry.
 */
export { SSRAtomRegistryLayer };

// =============================================================================
// HTML Escaping
// =============================================================================

const escapeHtml = (str: string): string => {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};

// =============================================================================
// Attribute Rendering
// =============================================================================

/**
 * JSX camelCase prop names to their HTML attribute equivalents
 */
const jsxToHtmlAttr: Record<string, string> = {
  className: "class",
  htmlFor: "for",
  readOnly: "readonly",
  autoFocus: "autofocus",
  autoPlay: "autoplay",
  noValidate: "novalidate",
  formNoValidate: "formnovalidate",
  allowFullscreen: "allowfullscreen",
  playsInline: "playsinline",
  defaultValue: "value",
  defaultChecked: "checked",
};

/**
 * Convert a prop name to its HTML attribute name
 */
const propToAttr = (prop: string): string => {
  const mapped = jsxToHtmlAttr[prop];
  if (mapped) return mapped;
  // Convert camelCase to kebab-case for data-* and aria-*
  if (prop.startsWith("data") || prop.startsWith("aria")) {
    return prop.replace(/([A-Z])/g, "-$1").toLowerCase();
  }
  return prop;
};

/**
 * Render a single attribute to string
 */
const renderAttribute = (name: string, value: unknown): string => {
  if (value === true) {
    return ` ${name}`;
  }
  if (value === false || value === null || value === undefined) {
    return "";
  }
  return ` ${name}="${escapeHtml(String(value))}"`;
};

/**
 * Render all props as HTML attributes
 */
const renderAttributes = (props: Record<string, unknown>): string => {
  let attrs = "";
  for (const [key, value] of Object.entries(props)) {
    if (isProperty(key)) {
      attrs += renderAttribute(propToAttr(key), value);
    }
  }
  return attrs;
};

// =============================================================================
// Void Elements (self-closing)
// =============================================================================

const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

// =============================================================================
// Core Rendering
// =============================================================================

/**
 * Check if a type is a function component
 */
const isFunctionComponent = (type: ElementType): type is Exclude<ElementType, Primitive> =>
  typeof type === "function";

/**
 * Check if a type is a host element (string tag)
 */
const isHostElement = (type: ElementType): type is Primitive => typeof type === "string";

/**
 * Render a VElement to HTML string.
 * This is an Effect that requires AtomRegistry.
 */
const renderVElementToString = (
  vElement: VElement,
): Effect.Effect<string, unknown, AtomRegistry.AtomRegistry> =>
  Effect.gen(function* () {
    const type = vElement.type;

    if (isFunctionComponent(type)) {
      // Invoke the component, catching synchronous throws
      const outputEffect = Effect.try({
        try: () => type(vElement.props),
        catch: (cause) => new RenderError({ cause }),
      });

      const output = yield* outputEffect;

      // Normalize to get the VElement
      let childVElement: VElement;

      if (isStream(output)) {
        // For streams, take first emission
        const first = yield* Stream.runHead(output);
        if (Option.isNone(first)) {
          return ""; // Empty stream
        }
        childVElement = first.value;
      } else if (Effect.isEffect(output)) {
        // Await the effect
        childVElement = yield* output as Effect.Effect<
          VElement,
          unknown,
          AtomRegistry.AtomRegistry
        >;
      } else {
        // Plain VElement
        childVElement = output as VElement;
      }

      // Recursively render the result
      return yield* renderVElementToString(childVElement);
    } else if (type === "TEXT_ELEMENT") {
      // Text node - escape and return
      return escapeHtml(String(vElement.props.nodeValue ?? ""));
    } else if (type === "FRAGMENT") {
      // Fragment - render children directly
      const children = vElement.props.children ?? [];
      let html = "";
      for (const child of children) {
        html += yield* renderVElementToString(child);
      }
      return html;
    } else if (type === "SUSPENSE") {
      // Suspense boundary - race child rendering against timeout
      // Phase 5: If children complete first → resolved marker
      //          If timeout fires first → fallback marker
      const fallback = vElement.props.fallback as VElement;
      const threshold = (vElement.props.threshold as number) ?? 100;
      const children = vElement.props.children as VElement[];

      // Create a Deferred to signal when children complete
      const childrenComplete = yield* Deferred.make<string, unknown>();

      // Fork: render children to string
      yield* Effect.fork(
        Effect.gen(function* () {
          let childrenHtml = "";
          for (const child of children) {
            childrenHtml += yield* renderVElementToString(child);
          }
          yield* Deferred.succeed(childrenComplete, childrenHtml);
        }).pipe(Effect.catchAll((e) => Deferred.fail(childrenComplete, e))),
      );

      // Race: children completing vs timeout
      const result = yield* Effect.race(
        Deferred.await(childrenComplete).pipe(
          Effect.map((html) => ({ type: "resolved" as const, html })),
        ),
        Effect.sleep(`${threshold} millis`).pipe(Effect.as({ type: "timeout" as const })),
      );

      if (result.type === "resolved") {
        // Children completed before timeout - render with resolved marker
        return `<!--fibrae:sus:resolved-->${result.html}<!--/fibrae:sus-->`;
      } else {
        // Timeout fired first - render fallback with fallback marker
        const fallbackHtml = yield* renderVElementToString(fallback);
        return `<!--fibrae:sus:fallback-->${fallbackHtml}<!--/fibrae:sus-->`;
      }
    } else if (isHostElement(type)) {
      // Regular HTML element
      const attrs = renderAttributes(vElement.props as Record<string, unknown>);

      // Add data-key for keyed elements (needed for hydration)
      const key = vElement.props.key;
      const keyAttr = key != null ? ` data-key="${escapeHtml(String(key))}"` : "";

      if (VOID_ELEMENTS.has(type)) {
        return `<${type}${attrs}${keyAttr} />`;
      }

      const children = vElement.props.children ?? [];
      let childrenHtml = "";
      for (const child of children) {
        childrenHtml += yield* renderVElementToString(child);
      }

      return `<${type}${attrs}${keyAttr}>${childrenHtml}</${type}>`;
    }

    // Unknown type
    return "";
  });

// =============================================================================
// Public API
// =============================================================================

/**
 * Render a VElement tree to an HTML string with serialized state.
 *
 * Returns the HTML and the dehydrated atom state array. Embed the state as:
 * <script type="application/json" id="__fibrae-state__">${JSON.stringify(dehydratedState)}</script>
 *
 * The HydrationState service auto-discovers this tag during client-side render().
 *
 * Note: Atoms must use `Atom.serializable({ key, schema })` to be included
 * in the dehydrated state.
 *
 * @example
 * ```typescript
 * import { renderToString } from "fibrae/server";
 *
 * const program = Effect.gen(function* () {
 *   const { html, dehydratedState } = yield* renderToString(<App />);
 *   const page = `
 *     <!DOCTYPE html>
 *     <html>
 *       <body>
 *         <div id="root">${html}</div>
 *         <script type="application/json" id="__fibrae-state__">${JSON.stringify(dehydratedState)}</script>
 *         <script src="/client.js"></script>
 *       </body>
 *     </html>
 *   `;
 *   return page;
 * });
 * ```
 */
export const renderToString = (
  element: VElement,
  _options?: RenderOptions,
): Effect.Effect<RenderResult, unknown, never> =>
  Effect.gen(function* () {
    const registry = yield* AtomRegistry.AtomRegistry;

    // Render the element
    const html = yield* renderVElementToString(element);

    // Dehydrate the registry state
    const dehydratedState = Hydration.dehydrate(registry);

    return { html, dehydratedState };
  }).pipe(Effect.provide(SSRAtomRegistryLayer));

/**
 * Render a VElement tree to HTML, requiring AtomRegistry and any other
 * services the component tree needs.
 *
 * Use this when your components require additional services (Navigator, RouterHandlers, etc.)
 * that you want to provide yourself.
 *
 * @example
 * ```typescript
 * import { renderToStringWith, SSRAtomRegistryLayer } from "fibrae/server";
 *
 * const program = Effect.gen(function* () {
 *   const { html, dehydratedState } = yield* renderToStringWith(<App />);
 *   return { html, dehydratedState };
 * });
 *
 * // Run with composed layers
 * const result = Effect.runPromise(
 *   program.pipe(
 *     Effect.provide(Layer.mergeAll(
 *       SSRAtomRegistryLayer,
 *       navigatorLayer,
 *       routerHandlersLayer
 *     ))
 *   )
 * );
 * ```
 */
export const renderToStringWith = <R>(
  element: VElement,
  _options?: RenderOptions,
): Effect.Effect<RenderResult, unknown, AtomRegistry.AtomRegistry | R> =>
  Effect.gen(function* () {
    const registry = yield* AtomRegistry.AtomRegistry;

    // Render the element
    const html = yield* renderVElementToString(element);

    // Dehydrate the registry state
    const dehydratedState = Hydration.dehydrate(registry);

    return { html, dehydratedState };
  });

// Re-export Hydration and Result for convenience
export { Hydration, Result } from "@effect-atom/atom";
