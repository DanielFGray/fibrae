import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { type VElement, type ElementType, type Primitive } from "./shared.js";

// =============================================================================
// Element Creation
// =============================================================================

/**
 * Create a text element VNode
 */
export const createTextElement = (text: string): VElement => ({
  type: "TEXT_ELEMENT",
  props: {
    nodeValue: text,
    children: [],
  },
});

/**
 * Create a virtual element (JSX factory)
 */
export function h<T>(
  type: Primitive,
  props?: { [key: string]: unknown },
  children?: (VElement | string)[]
): VElement;
export function h<T>(
  type: (props: T) => VElement | Stream.Stream<VElement, unknown, never>,
  props?: { [key: string]: unknown },
  children?: (VElement | string)[]
): VElement;
export function h<T>(
  type: (props: T) => Effect.Effect<VElement, unknown, never>,
  props?: { [key: string]: unknown },
  children?: (VElement | string)[]
): VElement;
export function h<T>(
  type: ElementType<T>,
  props: { [key: string]: unknown } = {},
  children: (VElement | string)[] = [],
): VElement {
  return {
    type: type as ElementType,
    props: {
      ...props,
      children: children.map((child) =>
        typeof child === "object" ? child : createTextElement(child),
      ),
    },
  };
}
