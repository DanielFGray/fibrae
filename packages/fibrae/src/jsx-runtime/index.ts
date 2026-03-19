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

// --- Overloads for Effect channel propagation ---
// Overload order matters: function components first (most specific type param),
// then intrinsic elements. TypeScript tries overloads top-to-bottom.

// Function component returning Effect — preserves E/R
export function jsx<E, R>(
  type: (props: Record<string, unknown>) => Effect.Effect<VElement, E, R>,
  props: Record<string, unknown> | null,
  ...children: VChild[]
): Effect.Effect<VElement, E, R>;

// Function component returning Stream — preserves E/R
export function jsx<E, R>(
  type: (props: Record<string, unknown>) => Stream.Stream<VElement, E, R>,
  props: Record<string, unknown> | null,
  ...children: VChild[]
): Stream.Stream<VElement, E, R>;

// Function component returning VElement (or any other non-Effect/Stream VNode)
export function jsx(
  type: (props: Record<string, unknown>) => VNode,
  props: Record<string, unknown> | null,
  ...children: VChild[]
): VElement;

// Intrinsic/fragment element — always returns VElement at runtime
// (Effect children are stored in the VElement and resolved by the renderer)
export function jsx(
  type: string | typeof Fragment,
  props: Record<string, unknown> | null,
  ...children: VChild[]
): VElement;

// --- Implementation (return type is VElement at runtime; overloads provide
//     type-level Effect/Stream propagation for the checker) ---
export function jsx(
  type: string | typeof Fragment | ((props: Record<string, unknown>) => unknown),
  props: Record<string, unknown> | null,
  ...children: unknown[]
): unknown {
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

export const jsxs = jsx;

// Development mode JSX transform (used by Bun and other tools)
export const jsxDEV = jsx;

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
 * Event handler return type — handlers can return void, an Effect (forked
 * with app context via runForkWithRuntime), or a Promise.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EventHandlerReturn = void | import("effect/Effect").Effect<any, any, any>;

/**
 * Event handler props derived from the DOM's own HTMLElementEventMap.
 * Accepts both camelCase (onClick) and lowercase (onclick) since the runtime
 * lowercases all event prop names before calling addEventListener.
 */
type EventHandlerProps = {
  [K in keyof HTMLElementEventMap as OnEventName<K & string>]?: (
    event: HTMLElementEventMap[K],
  ) => EventHandlerReturn;
} & {
  [K in keyof HTMLElementEventMap as `on${K & string}`]?: (
    event: HTMLElementEventMap[K],
  ) => EventHandlerReturn;
};

/**
 * For form elements (input, select, textarea), narrow event.target and
 * event.currentTarget to the specific element type so users don't need casts.
 */
type NarrowedEventHandlers<E extends HTMLElement> = {
  onInput?: (event: Event & { target: E; currentTarget: E }) => EventHandlerReturn;
  oninput?: (event: Event & { target: E; currentTarget: E }) => EventHandlerReturn;
  onChange?: (event: Event & { target: E; currentTarget: E }) => EventHandlerReturn;
  onchange?: (event: Event & { target: E; currentTarget: E }) => EventHandlerReturn;
  onFocus?: (event: FocusEvent & { target: E; currentTarget: E }) => EventHandlerReturn;
  onfocus?: (event: FocusEvent & { target: E; currentTarget: E }) => EventHandlerReturn;
  onBlur?: (event: FocusEvent & { target: E; currentTarget: E }) => EventHandlerReturn;
  onblur?: (event: FocusEvent & { target: E; currentTarget: E }) => EventHandlerReturn;
};

/**
 * Global HTML attributes derived from the DOM HTMLElement interface.
 * Using native types prevents false negatives (e.g. missing `role`).
 */
type NativeGlobalAttrs = Partial<
  Pick<
    HTMLElement,
    | "accessKey"
    | "autocapitalize"
    | "autofocus"
    | "contentEditable"
    | "dir"
    | "draggable"
    | "enterKeyHint"
    | "hidden"
    | "id"
    | "inert"
    | "inputMode"
    | "lang"
    | "nonce"
    | "popover"
    | "role"
    | "slot"
    | "spellcheck"
    | "tabIndex"
    | "title"
    | "translate"
  >
>;

/**
 * Common HTML attributes shared across all elements.
 * Combines fibrae-specific props with native global HTML attributes.
 */
type BaseHTMLProps = NativeGlobalAttrs & {
  key?: string | number;
  ref?: ((el: HTMLElement) => void) | { current: HTMLElement | null };
  /** Accepts CSS string or object (native DOM uses CSSStyleDeclaration) */
  style?: string | Record<string, string | number>;
  class?: string;
  className?: string;
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
type HTMLElementProps<E extends HTMLElement> = Omit<BaseHTMLProps, "ref"> &
  Omit<EventHandlerProps, NarrowedEventNames> &
  NarrowedEventHandlers<E> & {
    /** Ref narrowed to the specific element type */
    ref?: ((el: E) => void) | { current: E | null };
  };

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
  for?: string;
};

type MetaAttrs = {
  charset?: string;
  name?: string;
  content?: string;
  property?: string;
  "http-equiv"?: string;
};

type ScriptAttrs = {
  type?: string;
  src?: string;
  async?: boolean;
  defer?: boolean;
  crossOrigin?: string;
  integrity?: string;
  noModule?: boolean;
};

type LinkElementAttrs = {
  href?: string;
  rel?: string;
  type?: string;
  media?: string;
  crossOrigin?: string;
  integrity?: string;
  as?: string;
  sizes?: string;
};

// --- Media elements ---

type MediaAttrs = {
  src?: string;
  controls?: boolean;
  autoplay?: boolean;
  loop?: boolean;
  muted?: boolean;
  preload?: "none" | "metadata" | "auto" | "";
  crossOrigin?: string;
};

type VideoAttrs = MediaAttrs & {
  width?: string | number;
  height?: string | number;
  poster?: string;
  playsInline?: boolean;
  disablePictureInPicture?: boolean;
};

type SourceAttrs = {
  src?: string;
  srcset?: string;
  type?: string;
  media?: string;
  sizes?: string;
  width?: string | number;
  height?: string | number;
};

type TrackAttrs = {
  src?: string;
  kind?: "subtitles" | "captions" | "descriptions" | "chapters" | "metadata";
  srclang?: string;
  label?: string;
  default?: boolean;
};

// --- Embedded content ---

type CanvasAttrs = {
  width?: string | number;
  height?: string | number;
};

type IframeAttrs = {
  src?: string;
  srcdoc?: string;
  name?: string;
  width?: string | number;
  height?: string | number;
  sandbox?: string;
  allow?: string;
  allowFullscreen?: boolean;
  loading?: "lazy" | "eager";
  referrerPolicy?: string;
};

type EmbedAttrs = {
  src?: string;
  type?: string;
  width?: string | number;
  height?: string | number;
};

type ObjectAttrs = {
  data?: string;
  type?: string;
  width?: string | number;
  height?: string | number;
  name?: string;
};

// --- Interactive elements ---

type DialogAttrs = {
  open?: boolean;
};

type DetailsAttrs = {
  open?: boolean;
  name?: string;
};

// --- Table elements ---

type TableAttrs = {
  cellPadding?: string | number;
  cellSpacing?: string | number;
};

type TdThAttrs = {
  colSpan?: number;
  rowSpan?: number;
  headers?: string;
  scope?: string;
};

type ColAttrs = {
  span?: number;
};

// --- Misc elements ---

type MeterAttrs = {
  value?: number;
  min?: number;
  max?: number;
  low?: number;
  high?: number;
  optimum?: number;
};

type ProgressAttrs = {
  value?: number;
  max?: number;
};

type OutputAttrs = {
  htmlFor?: string;
  for?: string;
  name?: string;
  form?: string;
};

type TimeAttrs = {
  dateTime?: string;
};

type DataAttrs = {
  value?: string;
};

type FieldsetAttrs = {
  disabled?: boolean;
  name?: string;
  form?: string;
};

type OptgroupAttrs = {
  disabled?: boolean;
  label?: string;
};

type MapAttrs = {
  name?: string;
};

type AreaAttrs = {
  alt?: string;
  coords?: string;
  download?: string | boolean;
  href?: string;
  shape?: string;
  target?: string;
  rel?: string;
};

type SlotAttrs = {
  name?: string;
};

/**
 * Map of elements that need extra attribute types beyond the base.
 */
type SpecificElements = {
  // Form elements
  input: HTMLElementProps<HTMLInputElement> & InputAttrs;
  select: HTMLElementProps<HTMLSelectElement> & SelectAttrs;
  textarea: HTMLElementProps<HTMLTextAreaElement> & TextareaAttrs;
  option: HTMLElementProps<HTMLOptionElement> & OptionAttrs;
  optgroup: HTMLElementProps<HTMLOptGroupElement> & OptgroupAttrs;
  fieldset: HTMLElementProps<HTMLFieldSetElement> & FieldsetAttrs;
  output: HTMLElementProps<HTMLOutputElement> & OutputAttrs;
  button: HTMLElementProps<HTMLButtonElement> & ButtonAttrs;
  label: HTMLElementProps<HTMLLabelElement> & LabelAttrs;
  form: HTMLElementProps<HTMLFormElement> & FormAttrs;
  // Links and navigation
  a: HTMLElementProps<HTMLAnchorElement> & AnchorAttrs;
  area: HTMLElementProps<HTMLAreaElement> & AreaAttrs;
  // Media
  audio: HTMLElementProps<HTMLAudioElement> & MediaAttrs;
  video: HTMLElementProps<HTMLVideoElement> & VideoAttrs;
  source: HTMLElementProps<HTMLSourceElement> & SourceAttrs;
  track: HTMLElementProps<HTMLTrackElement> & TrackAttrs;
  img: HTMLElementProps<HTMLImageElement> & ImgAttrs;
  // Embedded content
  canvas: HTMLElementProps<HTMLCanvasElement> & CanvasAttrs;
  iframe: HTMLElementProps<HTMLIFrameElement> & IframeAttrs;
  embed: HTMLElementProps<HTMLEmbedElement> & EmbedAttrs;
  object: HTMLElementProps<HTMLObjectElement> & ObjectAttrs;
  // Document metadata
  meta: HTMLElementProps<HTMLMetaElement> & MetaAttrs;
  script: HTMLElementProps<HTMLScriptElement> & ScriptAttrs;
  link: HTMLElementProps<HTMLLinkElement> & LinkElementAttrs;
  // Interactive
  dialog: HTMLElementProps<HTMLDialogElement> & DialogAttrs;
  details: HTMLElementProps<HTMLDetailsElement> & DetailsAttrs;
  slot: HTMLElementProps<HTMLSlotElement> & SlotAttrs;
  // Table
  table: HTMLElementProps<HTMLTableElement> & TableAttrs;
  td: HTMLElementProps<HTMLTableCellElement> & TdThAttrs;
  th: HTMLElementProps<HTMLTableCellElement> & TdThAttrs;
  col: HTMLElementProps<HTMLTableColElement> & ColAttrs;
  colgroup: HTMLElementProps<HTMLTableColElement> & ColAttrs;
  // Data/time
  meter: HTMLElementProps<HTMLMeterElement> & MeterAttrs;
  progress: HTMLElementProps<HTMLProgressElement> & ProgressAttrs;
  time: HTMLElementProps<HTMLTimeElement> & TimeAttrs;
  data: HTMLElementProps<HTMLDataElement> & DataAttrs;
  map: HTMLElementProps<HTMLMapElement> & MapAttrs;
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

// =============================================================================
// SVG Element Types
// =============================================================================

/**
 * Common SVG presentation attributes shared across all SVG elements.
 * Covers the most-used attributes; exotic ones fall through via [key: string].
 */
type BaseSVGProps = {
  key?: string | number;
  ref?: ((el: SVGElement) => void) | { current: SVGElement | null };
  children?: VChild;
  style?: string | Record<string, string | number>;
  class?: string;
  className?: string;
  id?: string;
  lang?: string;
  tabIndex?: number;
  // Presentation attributes
  fill?: string;
  stroke?: string;
  strokeWidth?: string | number;
  strokeLinecap?: "butt" | "round" | "square";
  strokeLinejoin?: "miter" | "round" | "bevel";
  strokeDasharray?: string;
  strokeDashoffset?: string | number;
  strokeOpacity?: string | number;
  fillOpacity?: string | number;
  fillRule?: "nonzero" | "evenodd";
  clipRule?: "nonzero" | "evenodd";
  opacity?: string | number;
  transform?: string;
  // Geometry
  viewBox?: string;
  xmlns?: string;
  width?: string | number;
  height?: string | number;
  x?: string | number;
  y?: string | number;
  cx?: string | number;
  cy?: string | number;
  r?: string | number;
  rx?: string | number;
  ry?: string | number;
  x1?: string | number;
  y1?: string | number;
  x2?: string | number;
  y2?: string | number;
  // Path
  d?: string;
  pathLength?: string | number;
  // Markers
  markerStart?: string;
  markerMid?: string;
  markerEnd?: string;
  // Gradients / patterns
  gradientUnits?: string;
  gradientTransform?: string;
  spreadMethod?: string;
  offset?: string | number;
  stopColor?: string;
  stopOpacity?: string | number;
  // Text
  textAnchor?: string;
  dominantBaseline?: string;
  dx?: string | number;
  dy?: string | number;
  fontSize?: string | number;
  fontFamily?: string;
  fontWeight?: string | number;
  // Filters / clip / mask
  clipPath?: string;
  mask?: string;
  filter?: string;
  // Misc
  preserveAspectRatio?: string;
  href?: string;
  xlinkHref?: string;
  points?: string;
  // Allow data-* and aria-* attributes
  [key: `data-${string}`]: unknown;
  [key: `aria-${string}`]: unknown;
};

/**
 * SVG element props = common SVG attributes + event handlers.
 * All SVG elements share the same prop type — no per-element specialization needed.
 */
type SVGElementProps<E extends SVGElement = SVGElement> = Omit<BaseSVGProps, "ref"> &
  EventHandlerProps & {
    /** Ref narrowed to the specific SVG element type */
    ref?: ((el: E) => void) | { current: E | null };
  };

/**
 * SVG elements derived from SVGElementTagNameMap.
 * Excludes keys that overlap with HTMLElementTagNameMap (a, script, style, title)
 * since those are already typed as HTML elements and the HTML versions are what
 * JSX users expect in practice.
 */
type SVGElements = {
  [K in Exclude<keyof SVGElementTagNameMap, keyof HTMLElementTagNameMap>]: SVGElementProps<
    SVGElementTagNameMap[K]
  >;
};

// Provide properly typed JSX namespace
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    // JSX expressions produce VElement. Effect/Stream channel propagation
    // happens through jsx() overload return types, not through Element.
    type Element = VElement;

    // What function components can return (TS 5.1+)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    type ElementType = keyof IntrinsicElements | ((props: any) => VNode);

    // Typed HTML elements: specific overrides + generic fallback for all others + SVG
    interface IntrinsicElements extends SpecificElements, GenericElements, SVGElements {}

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
