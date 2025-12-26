import type * as Effect from "effect/Effect";
import type * as Stream from "effect/Stream";
import type { VElement, ElementType } from "../shared.js";

// A simple Fragment support for Fibrae
export const Fragment = "FRAGMENT" as const;
export type FragmentType = typeof Fragment;

export type JSXType =
  | typeof Fragment
  | ((props: object) => VElement | Stream.Stream<VElement> | Effect.Effect<VElement>);

export type PropsWithChildren<T = object> = T & {
  children?: VElement | string | (VElement | string)[];
};

function createTextElement(text: string | number | bigint): VElement {
  return {
    type: "TEXT_ELEMENT",
    props: {
      nodeValue: String(text),
      children: [],
    },
  };
}

function normalizeChild(child: unknown): VElement | VElement[] | null {
  if (child === null || child === undefined || typeof child === "boolean") {
    return null;
  }
  if (typeof child === "string" || typeof child === "number" || typeof child === "bigint") {
    return createTextElement(child);
  }
  // Handle arrays of children
  if (Array.isArray(child)) {
    return child.flatMap(c => {
      const normalized = normalizeChild(c);
      return normalized === null ? [] : Array.isArray(normalized) ? normalized : [normalized];
    });
  }
  // Assume it's an already properly shaped VElement
  return child as VElement;
}

export function jsx(
  type: JSXType,
  props: PropsWithChildren<{ [key: string]: unknown }> | null,
  ...children: (VElement | string)[]
): VElement {
  const normalizedProps = props ?? {};

  let finalChildren: VElement[] = [];

  // Prefer children from props (automatic JSX runtime) over rest args (classic runtime)
  if (normalizedProps.children !== undefined) {
    const ch = normalizedProps.children;
    const arr = Array.isArray(ch) ? ch : [ch];

    finalChildren = arr.flatMap(child => {
      const normalized = normalizeChild(child);
      return normalized === null ? [] : Array.isArray(normalized) ? normalized : [normalized];
    });
  } else if (children.length > 0) {
    // Fall back to rest args for classic JSX runtime
    finalChildren = children.flatMap(child => {
      const normalized = normalizeChild(child);
      return normalized === null ? [] : Array.isArray(normalized) ? normalized : [normalized];
    });
  }

  return {
    type: type as ElementType,
    props: {
      ...(normalizedProps as object),
      children: finalChildren,
    },
  };
}

export const jsxs: typeof jsx = jsx;

// Development mode JSX transform (used by Bun and other tools)
export const jsxDEV: typeof jsx = jsx;

// Alias for classic JSX transform (used by esbuild)
export const h = jsx;

// Provide minimal global JSX types for the demo
declare global {
  namespace JSX {
    // JSX.Element is VElement, but we use 'any' to bypass component return type checking
    // This allows components to return Effect<VElement> or Stream<VElement>
    type Element = any;

    // Allow any HTML tag with any props for now
    interface IntrinsicElements {
      [elemName: string]: any;
    }

    // Support an optional key prop
    interface IntrinsicAttributes {
      key?: string | number;
    }

    // Allow function components to accept children by default
    interface ElementChildrenAttribute {
      children: {};
    }
  }
}
