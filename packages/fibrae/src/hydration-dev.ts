/**
 * Hydration mismatch detection — dev mode only.
 *
 * All functions in this module are gated behind the DEV flag and will
 * tree-shake to nothing in production builds.
 */

import * as Effect from "effect/Effect";
import type { VElement } from "./shared.js";
import { isProperty } from "./dom.js";

// Same DEV pattern as core.ts — import.meta.hot present = dev mode
const DEV =
  typeof import.meta !== "undefined" && !!(import.meta as unknown as Record<string, unknown>).hot;

// =============================================================================
// Attribute normalization helpers
// =============================================================================

/** Map JSX prop names to their DOM attribute equivalents */
const propToAttr: Record<string, string> = {
  className: "class",
  htmlFor: "for",
  tabIndex: "tabindex",
  readOnly: "readonly",
  autoFocus: "autofocus",
  autoPlay: "autoplay",
  noValidate: "novalidate",
  formNoValidate: "formnovalidate",
  allowFullscreen: "allowfullscreen",
  playsInline: "playsinline",
};

/** Normalize a JSX prop name to the corresponding DOM attribute name */
const normalizeAttrName = (name: string): string =>
  propToAttr[name] ??
  (name.startsWith("data-") || name.startsWith("aria-") ? name : name.toLowerCase());

/** Normalize a style prop (object or string) to a comparable string */
const normalizeStyle = (value: unknown): string => {
  if (typeof value === "string") return value.replace(/\s+/g, " ").trim();
  if (typeof value === "object" && value !== null) {
    return Object.entries(value as Record<string, string | number>)
      .map(([k, v]) => {
        const prop = k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
        return `${prop}: ${v}`;
      })
      .join("; ");
  }
  return "";
};

// =============================================================================
// Mismatch warning helpers
// =============================================================================

const warnMismatch = (message: string): Effect.Effect<void> =>
  Effect.logWarning(`[fibrae] Hydration mismatch: ${message}`);

// =============================================================================
// Public check functions — all no-op in production
// =============================================================================

/**
 * Check if a host element's tag name matches the VElement type.
 * Warns if server rendered a different tag than client expects.
 */
export const checkTagMismatch = (vElement: VElement, domNode: Node): Effect.Effect<void> => {
  if (!DEV) return Effect.void;

  const type = vElement.type;
  if (typeof type !== "string") return Effect.void;
  if (type === "TEXT_ELEMENT" || type === "FRAGMENT" || type === "SUSPENSE" || type === "BOUNDARY")
    return Effect.void;

  if (domNode.nodeType === Node.ELEMENT_NODE) {
    const expected = type.toUpperCase();
    const actual = (domNode as Element).tagName;
    if (expected !== actual) {
      return warnMismatch(`expected <${type}> but found <${actual.toLowerCase()}>`);
    }
  } else if (domNode.nodeType === Node.TEXT_NODE) {
    const text = domNode.textContent?.substring(0, 50) ?? "";
    return warnMismatch(`expected <${type}> but found text node "${text}"`);
  }

  return Effect.void;
};

/**
 * Check if a text node's content matches the VElement's text value.
 * Only compares trimmed content — whitespace differences are expected
 * between SSR serialization and client render.
 */
export const checkTextMismatch = (vElement: VElement, domNode: Node): Effect.Effect<void> => {
  if (!DEV) return Effect.void;

  if (vElement.type !== "TEXT_ELEMENT") return Effect.void;
  if (domNode.nodeType !== Node.TEXT_NODE) return Effect.void;

  const expected = String(vElement.props.nodeValue ?? "");
  const actual = domNode.textContent ?? "";

  // Trim both sides — SSR and client may differ in whitespace
  if (expected.trim() !== actual.trim()) {
    return warnMismatch(
      `text content differs: server "${actual.substring(0, 50)}" vs client "${expected.substring(0, 50)}"`,
    );
  }

  return Effect.void;
};

/**
 * Check key attributes on a host element for mismatches.
 * Compares: class/className, id, style, data-*, aria-* attributes.
 */
export const checkAttributeMismatches = (
  vElement: VElement,
  domNode: Node,
): Effect.Effect<void> => {
  if (!DEV) return Effect.void;

  if (typeof vElement.type !== "string") return Effect.void;
  if (vElement.type === "TEXT_ELEMENT" || vElement.type === "FRAGMENT") return Effect.void;
  if (domNode.nodeType !== Node.ELEMENT_NODE) return Effect.void;

  const el = domNode as Element;
  const props = vElement.props;

  // Collect warnings for all mismatched attributes, then emit them together
  return Effect.forEach(
    Object.keys(props).filter(isProperty),
    (key) => {
      const value = props[key];
      if (value == null || value === false) return Effect.void;

      // Style needs special comparison
      if (key === "style") {
        const expectedStyle = normalizeStyle(value);
        const actualStyle = el.getAttribute("style") ?? "";
        // Only warn if substantially different (ignore trailing semicolons, whitespace)
        if (expectedStyle.replace(/;\s*$/, "").trim() !== actualStyle.replace(/;\s*$/, "").trim()) {
          return warnMismatch(
            `attribute "style" on <${vElement.type}>: server "${actualStyle}" vs client "${expectedStyle}"`,
          );
        }
        return Effect.void;
      }

      const attrName = normalizeAttrName(key);
      const actualValue = el.getAttribute(attrName);
      const expectedValue = value === true ? "" : String(value);

      if (actualValue === null) {
        return warnMismatch(
          `attribute "${attrName}" missing on <${vElement.type}>: expected "${expectedValue}"`,
        );
      }

      if (actualValue !== expectedValue) {
        return warnMismatch(
          `attribute "${attrName}" on <${vElement.type}>: server "${actualValue}" vs client "${expectedValue}"`,
        );
      }

      return Effect.void;
    },
    { discard: true },
  );
};
