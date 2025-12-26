import { type VElement, type ElementType, type Primitive, type VChild, type VNode } from "./shared.js";

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
export function h(
  type: Primitive,
  props?: { [key: string]: unknown },
  children?: VChild[],
): VElement;
export function h<T>(
  type: (props: T) => VNode,
  props?: { [key: string]: unknown },
  children?: VChild[],
): VElement;
export function h<T>(
  type: ElementType<T>,
  props: { [key: string]: unknown } = {},
  children: VChild[] = [],
): VElement {
  return {
    type: type as ElementType,
    props: {
      ...props,
      children: children
        .filter((child) => child !== false && child !== null && child !== undefined)
        .map((child) => {
          if (typeof child === "object" && !Array.isArray(child)) {
            return child as VElement;
          }
          // eslint-disable-next-line @typescript-eslint/no-base-to-string
          return createTextElement(String(child));
        }),
    },
  };
}
