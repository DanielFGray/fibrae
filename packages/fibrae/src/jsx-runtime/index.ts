import type * as Effect from "effect/Effect";
import type * as Stream from "effect/Stream";
import type { VElement, ElementType, VChild, VNode } from "../shared.js";

// A simple Fragment support for Fibrae
export const Fragment = "FRAGMENT" as const;
export type FragmentType = typeof Fragment;

export type JSXType =
  | typeof Fragment
  | ((props: object) => VElement | Stream.Stream<VElement> | Effect.Effect<VElement>);

export type PropsWithChildren<T = object> = T & {
  children?: VChild;
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
  if (child === null || child === undefined || child === false || child === true) {
    return null;
  }
  if (typeof child === "string" || typeof child === "number" || typeof child === "bigint") {
    return createTextElement(child);
  }
  // Handle arrays of children
  if (Array.isArray(child)) {
    return child.flatMap((c) => {
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
  ...children: VChild[]
): VElement {
  const normalizedProps = props ?? {};

  let finalChildren: VElement[] = [];

  // Prefer children from props (automatic JSX runtime) over rest args (classic runtime)
  if (normalizedProps.children !== undefined) {
    const ch = normalizedProps.children;
    const arr = Array.isArray(ch) ? ch : [ch];

    finalChildren = arr.flatMap((child) => {
      const normalized = normalizeChild(child);
      return normalized === null ? [] : Array.isArray(normalized) ? normalized : [normalized];
    });
  } else if (children.length > 0) {
    // Fall back to rest args for classic JSX runtime
    finalChildren = children.flatMap((child) => {
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

// =============================================================================
// JSX Event & Element Types
// =============================================================================

/**
 * Map DOM event names (lowercase) to camelCase prop names.
 * Handles compound words: "keydown" → "KeyDown", "pointerenter" → "PointerEnter", etc.
 */
type CamelCaseEventName = {
  // Keyboard
  keydown: "KeyDown";
  keyup: "KeyUp";
  keypress: "KeyPress";
  // Mouse
  mousedown: "MouseDown";
  mouseup: "MouseUp";
  mouseover: "MouseOver";
  mouseout: "MouseOut";
  mouseenter: "MouseEnter";
  mouseleave: "MouseLeave";
  mousemove: "MouseMove";
  dblclick: "DblClick";
  // Pointer
  pointerdown: "PointerDown";
  pointerup: "PointerUp";
  pointermove: "PointerMove";
  pointerover: "PointerOver";
  pointerout: "PointerOut";
  pointerenter: "PointerEnter";
  pointerleave: "PointerLeave";
  pointercancel: "PointerCancel";
  gotpointercapture: "GotPointerCapture";
  lostpointercapture: "LostPointerCapture";
  // Touch
  touchstart: "TouchStart";
  touchend: "TouchEnd";
  touchmove: "TouchMove";
  touchcancel: "TouchCancel";
  // Focus
  focusin: "FocusIn";
  focusout: "FocusOut";
  // Drag
  dragenter: "DragEnter";
  dragleave: "DragLeave";
  dragover: "DragOver";
  dragstart: "DragStart";
  dragend: "DragEnd";
  // Animation / Transition
  animationstart: "AnimationStart";
  animationend: "AnimationEnd";
  animationiteration: "AnimationIteration";
  animationcancel: "AnimationCancel";
  transitionstart: "TransitionStart";
  transitionend: "TransitionEnd";
  transitionrun: "TransitionRun";
  transitioncancel: "TransitionCancel";
  // Composition
  compositionstart: "CompositionStart";
  compositionend: "CompositionEnd";
  compositionupdate: "CompositionUpdate";
  // Selection
  selectstart: "SelectStart";
  selectionchange: "SelectionChange";
  // Media
  canplay: "CanPlay";
  canplaythrough: "CanPlayThrough";
  durationchange: "DurationChange";
  loadeddata: "LoadedData";
  loadedmetadata: "LoadedMetadata";
  loadstart: "LoadStart";
  ratechange: "RateChange";
  timeupdate: "TimeUpdate";
  volumechange: "VolumeChange";
  // Misc
  contextmenu: "ContextMenu";
  beforeinput: "BeforeInput";
  fullscreenchange: "FullscreenChange";
  fullscreenerror: "FullscreenError";
};

/**
 * Convert a DOM event name to its `on`-prefixed camelCase form.
 * Uses CamelCaseEventName for compound words, Capitalize for simple ones.
 */
type OnEventName<K extends string> = K extends keyof CamelCaseEventName
  ? `on${CamelCaseEventName[K]}`
  : `on${Capitalize<K>}`;

/**
 * Event handler props derived from the DOM's own HTMLElementEventMap.
 * Maps "click" → "onClick", "keydown" → "onKeyDown", etc.
 */
type EventHandlerProps = {
  [K in keyof HTMLElementEventMap as OnEventName<K & string>]?: (
    event: HTMLElementEventMap[K],
  ) => void;
};

/**
 * For form elements (input, select, textarea), narrow event.target and
 * event.currentTarget to the specific element type so users don't need casts.
 */
type NarrowedEventHandlers<E extends HTMLElement> = {
  onInput?: (event: Event & { target: E; currentTarget: E }) => void;
  onChange?: (event: Event & { target: E; currentTarget: E }) => void;
  onFocus?: (event: FocusEvent & { target: E; currentTarget: E }) => void;
  onBlur?: (event: FocusEvent & { target: E; currentTarget: E }) => void;
};

/**
 * Common HTML attributes shared across all elements.
 */
type BaseHTMLProps = {
  key?: string | number;
  ref?: (el: HTMLElement) => void;
  style?: string | Record<string, string | number>;
  class?: string;
  className?: string;
  id?: string;
  title?: string;
  tabIndex?: number;
  hidden?: boolean;
  draggable?: boolean;
  children?: VChild;
  /** Set raw HTML content. Replaces children — use with care. */
  dangerouslySetInnerHTML?: string;
  // Allow data-* and aria-* attributes
  [key: `data-${string}`]: unknown;
  [key: `aria-${string}`]: unknown;
};

/**
 * Event names that get narrowed per-element (excluded from base EventHandlerProps).
 */
type NarrowedEventNames = keyof NarrowedEventHandlers<HTMLElement>;

/**
 * Props for a specific HTML element, combining base attributes,
 * typed event handlers, and narrowed form-element events.
 * Narrowed events override the generic ones to avoid union parameter types.
 */
type HTMLElementProps<E extends HTMLElement> = BaseHTMLProps &
  Omit<EventHandlerProps, NarrowedEventNames> &
  NarrowedEventHandlers<E>;

/**
 * Element-specific attribute types for elements with unique properties.
 */
type InputAttrs = {
  type?: string;
  value?: string | number;
  checked?: boolean;
  placeholder?: string;
  disabled?: boolean;
  name?: string;
  min?: string | number;
  max?: string | number;
  step?: string | number;
  pattern?: string;
  required?: boolean;
  readOnly?: boolean;
  autoFocus?: boolean;
  autoComplete?: string;
  multiple?: boolean;
  accept?: string;
};

type SelectAttrs = {
  value?: string | number;
  multiple?: boolean;
  disabled?: boolean;
  name?: string;
  required?: boolean;
};

type TextareaAttrs = {
  value?: string;
  placeholder?: string;
  disabled?: boolean;
  name?: string;
  rows?: number;
  cols?: number;
  required?: boolean;
  readOnly?: boolean;
};

type OptionAttrs = {
  value?: string | number;
  selected?: boolean;
  disabled?: boolean;
  label?: string;
};

type AnchorAttrs = {
  href?: string;
  target?: string;
  rel?: string;
  download?: string | boolean;
};

type ImgAttrs = {
  src?: string;
  alt?: string;
  width?: string | number;
  height?: string | number;
  loading?: "lazy" | "eager";
  crossOrigin?: string;
};

type FormAttrs = {
  action?: string;
  method?: string;
  encType?: string;
  noValidate?: boolean;
};

type ButtonAttrs = {
  type?: "button" | "submit" | "reset";
  disabled?: boolean;
  name?: string;
  value?: string;
};

type LabelAttrs = {
  htmlFor?: string;
};

/**
 * Map of elements that need extra attribute types beyond the base.
 */
type SpecificElements = {
  input: HTMLElementProps<HTMLInputElement> & InputAttrs;
  select: HTMLElementProps<HTMLSelectElement> & SelectAttrs;
  textarea: HTMLElementProps<HTMLTextAreaElement> & TextareaAttrs;
  option: HTMLElementProps<HTMLOptionElement> & OptionAttrs;
  a: HTMLElementProps<HTMLAnchorElement> & AnchorAttrs;
  img: HTMLElementProps<HTMLImageElement> & ImgAttrs;
  form: HTMLElementProps<HTMLFormElement> & FormAttrs;
  button: HTMLElementProps<HTMLButtonElement> & ButtonAttrs;
  label: HTMLElementProps<HTMLLabelElement> & LabelAttrs;
};

/**
 * All remaining HTML elements get base props + typed events.
 * Derived from TypeScript's own HTMLElementTagNameMap (~140 elements).
 */
type GenericElements = {
  [K in Exclude<keyof HTMLElementTagNameMap, keyof SpecificElements>]: HTMLElementProps<
    HTMLElementTagNameMap[K]
  >;
};

// Provide properly typed JSX namespace
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    // JSX expressions always produce VElement
    // Component functions are stored in the type field and invoked later by the renderer
    type Element = VElement;

    // What function components can return (TS 5.1+)
    // This allows components to return Effect<VElement> or Stream<VElement>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    type ElementType = keyof IntrinsicElements | ((props: any) => VNode);

    // Typed HTML elements: specific overrides + generic fallback for all others
    interface IntrinsicElements extends SpecificElements, GenericElements {}

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
