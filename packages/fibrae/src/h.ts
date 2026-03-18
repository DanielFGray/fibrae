/**
 * Unified hyperscript API with Effect channel propagation.
 *
 * Three calling conventions, one function:
 *
 *   yield* h(Counter, { count: 0 })       // Effect component — preserves E/R
 *   h("div", { class: "app" }, child)     // classic hyperscript
 *   h.div({ class: "app" }, child)        // element factory shorthand
 *
 * Unlike JSX, function calls preserve generic type parameters.
 * Effect errors (E) and requirements (R) propagate through the tree.
 */

import * as Effect from "effect/Effect";
import type * as Stream from "effect/Stream";
import type { VElement, VChild, VNode } from "./shared.js";
import { isStream } from "./shared.js";

// =============================================================================
// Channel Propagation Types
// =============================================================================

/** Extract error channel from a value (never if not Effect/Stream). */
type ExtractE<T> =
  T extends Effect.Effect<any, infer E, any>
    ? E
    : T extends Stream.Stream<any, infer E, any>
      ? E
      : never;

/** Extract requirements channel from a value (never if not Effect/Stream). */
type ExtractR<T> =
  T extends Effect.Effect<any, any, infer R>
    ? R
    : T extends Stream.Stream<any, any, infer R>
      ? R
      : never;

/** VElement when children have no Effect channels, Effect<VElement, E, R> otherwise. */
type MergeChannels<C extends readonly unknown[]> = [
  ExtractE<C[number]>,
  ExtractR<C[number]>,
] extends [never, never]
  ? VElement
  : Effect.Effect<VElement, ExtractE<C[number]>, ExtractR<C[number]>>;

// =============================================================================
// Element Factory Type
// =============================================================================

/** Per-element factory: optional props then variadic children. Propagates Effect channels. */
interface ElementFn {
  (): VElement;
  (child: string): VElement;
  <C extends VChild[]>(props: Record<string, unknown>, ...children: C): MergeChannels<C>;
  <C extends VChild[]>(...children: C): MergeChannels<C>;
}

// =============================================================================
// h() Overloads
// =============================================================================

interface H {
  // --- Function component overloads (preserves Effect/Stream channels) ---

  /** Effect component with props — preserves E and R. */
  <P extends Record<string, unknown>, E, R>(
    type: (props: P) => Effect.Effect<VElement, E, R>,
    props: P,
  ): Effect.Effect<VElement, E, R>;

  /** Effect component, no props. */
  <E, R>(type: (props: {}) => Effect.Effect<VElement, E, R>): Effect.Effect<VElement, E, R>;

  /** Stream component with props — preserves E and R. */
  <P extends Record<string, unknown>, E, R>(
    type: (props: P) => Stream.Stream<VElement, E, R>,
    props: P,
  ): Stream.Stream<VElement, E, R>;

  /** Pure component. */
  <P extends Record<string, unknown>>(type: (props: P) => VElement, props: P): VElement;

  /** Component returning VNode (general). */
  <P extends Record<string, unknown>>(type: (props: P) => VNode, props: P): VNode;

  // --- Intrinsic element overloads ---

  /** Tag + props + children. */
  <C extends VChild[]>(
    type: string,
    props: Record<string, unknown>,
    ...children: C
  ): MergeChannels<C>;

  /** Tag + children only. */
  <C extends VChild[]>(type: string, ...children: C): MergeChannels<C>;

  /** Tag only (self-closing). */
  (type: string): VElement;

  // --- Element factory accessors (h.div, h.span, etc.) ---
  readonly [K: string]: ElementFn;
}

// =============================================================================
// Runtime
// =============================================================================

/** Create a text VElement. */
export const createTextElement = (text: string | number | bigint): VElement => ({
  type: "TEXT_ELEMENT",
  props: { nodeValue: String(text), children: [] },
});

function normalizeChild(child: unknown): VElement | VElement[] | null {
  if (child === null || child === undefined || child === false || child === true) return null;
  if (typeof child === "string" || typeof child === "number" || typeof child === "bigint") {
    return createTextElement(child);
  }
  if (Array.isArray(child)) {
    return child.flatMap((c) => {
      const n = normalizeChild(c);
      return n === null ? [] : Array.isArray(n) ? n : [n];
    });
  }
  return child as VElement;
}

function buildVElement(
  type: string | ((props: Record<string, unknown>) => unknown),
  props: Record<string, unknown>,
  children: unknown[],
): VElement {
  const finalChildren = children.flatMap((c) => {
    const n = normalizeChild(c);
    return n === null ? [] : Array.isArray(n) ? n : [n];
  });
  return {
    type: type as VElement["type"],
    props: { ...props, children: finalChildren },
  };
}

/** Is this value a props object (not a VChild)? */
function isProps(value: unknown): value is Record<string, unknown> {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return false;
  if ("type" in value && "props" in value) return false;
  if (Effect.isEffect(value)) return false;
  if (isStream(value)) return false;
  return true;
}

function hImpl(type: unknown, ...args: unknown[]): unknown {
  // Function component — call directly, return its Effect/Stream/VElement
  if (typeof type === "function") {
    return (type as Function)(args[0] ?? {});
  }
  // Intrinsic element
  if (args.length === 0) return buildVElement(type as string, {}, []);
  if (isProps(args[0])) return buildVElement(type as string, args[0], args.slice(1));
  return buildVElement(type as string, {}, args);
}

function elementFactory(tag: string) {
  return (...args: unknown[]): unknown => {
    if (args.length === 0) return buildVElement(tag, {}, []);
    if (isProps(args[0])) return buildVElement(tag, args[0], args.slice(1));
    return buildVElement(tag, {}, args);
  };
}

const factoryCache = new Map<string, Function>();

/**
 * Unified hyperscript with Effect channel propagation.
 *
 * @example
 * ```tsx
 * // Effect component — channels preserved
 * yield* h(Counter, { count: 0 })
 *
 * // Classic hyperscript
 * h("div", { class: "app" }, h("h1", "Hello"))
 *
 * // Element factory shorthand
 * h.div({ class: "app" }, h.h1("Hello"))
 * ```
 */
export const h: H = new Proxy(hImpl as unknown as H, {
  get(_target, prop) {
    if (typeof prop !== "string") return undefined;
    let factory = factoryCache.get(prop);
    if (!factory) {
      factory = elementFactory(prop);
      factoryCache.set(prop, factory);
    }
    return factory;
  },
});
