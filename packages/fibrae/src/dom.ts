import * as Effect from "effect/Effect";
import * as Cause from "effect/Cause";
import { FibraeRuntime, runForkWithRuntime } from "./runtime.js";
import { EventHandlerError } from "./shared.js";

// =============================================================================
// DOM Property Handling
// =============================================================================

/**
 * Property update strategies for different DOM properties
 */
export const propertyUpdateMap: Record<
  string,
  "attribute" | "property" | "classList" | "booleanAttribute"
> = {
  class: "classList",
  className: "classList",
  value: "property",
  defaultValue: "property",
  defaultChecked: "property",
  // Boolean HTML attributes: presence means true, absence means false
  checked: "booleanAttribute",
  disabled: "booleanAttribute",
  hidden: "booleanAttribute",
  multiple: "booleanAttribute",
  muted: "booleanAttribute",
  open: "booleanAttribute",
  required: "booleanAttribute",
  selected: "booleanAttribute",
  controls: "booleanAttribute",
  loop: "booleanAttribute",
  reversed: "booleanAttribute",
  default: "booleanAttribute",
  inert: "booleanAttribute",
  // Lowercase form (HTML attribute names)
  readonly: "booleanAttribute",
  autofocus: "booleanAttribute",
  autoplay: "booleanAttribute",
  novalidate: "booleanAttribute",
  formnovalidate: "booleanAttribute",
  allowfullscreen: "booleanAttribute",
  playsinline: "booleanAttribute",
  // JSX camelCase equivalents
  readOnly: "booleanAttribute",
  autoFocus: "booleanAttribute",
  autoPlay: "booleanAttribute",
  noValidate: "booleanAttribute",
  formNoValidate: "booleanAttribute",
  allowFullscreen: "booleanAttribute",
  playsInline: "booleanAttribute",
};

export const isEvent = (key: string) => key.startsWith("on");
export const isProperty = (key: string) =>
  key !== "children" &&
  key !== "ref" &&
  key !== "key" &&
  key !== "dangerouslySetInnerHTML" &&
  !isEvent(key);

const unitlessProperties = new Set([
  "animationIterationCount",
  "boxFlex",
  "boxFlexGroup",
  "boxOrdinalGroup",
  "columnCount",
  "fillOpacity",
  "flex",
  "flexGrow",
  "flexPositive",
  "flexShrink",
  "flexNegative",
  "flexOrder",
  "fontWeight",
  "gridColumn",
  "gridRow",
  "lineClamp",
  "lineHeight",
  "opacity",
  "order",
  "orphans",
  "tabSize",
  "widows",
  "zIndex",
  "zoom",
]);

/**
 * SVG namespace URI for createElementNS
 */
export const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

/**
 * Tags that must be created with SVG namespace.
 * Derived from SVGElementTagNameMap minus tags that overlap with HTMLElementTagNameMap.
 */
export const SVG_TAGS = new Set([
  "svg",
  "animate",
  "animateMotion",
  "animateTransform",
  "circle",
  "clipPath",
  "defs",
  "desc",
  "ellipse",
  "feBlend",
  "feColorMatrix",
  "feComponentTransfer",
  "feComposite",
  "feConvolveMatrix",
  "feDiffuseLighting",
  "feDisplacementMap",
  "feDistantLight",
  "feDropShadow",
  "feFlood",
  "feFuncA",
  "feFuncB",
  "feFuncG",
  "feFuncR",
  "feGaussianBlur",
  "feImage",
  "feMerge",
  "feMergeNode",
  "feMorphology",
  "feOffset",
  "fePointLight",
  "feSpecularLighting",
  "feSpotLight",
  "feTile",
  "feTurbulence",
  "filter",
  "foreignObject",
  "g",
  "image",
  "line",
  "linearGradient",
  "marker",
  "mask",
  "metadata",
  "mpath",
  "path",
  "pattern",
  "polygon",
  "polyline",
  "radialGradient",
  "rect",
  "set",
  "stop",
  "symbol",
  "text",
  "textPath",
  "tspan",
  "use",
  "view",
]);

/**
 * Set a DOM property using the appropriate method.
 * Works for both HTML and SVG elements.
 */
export const setDomProperty = (
  el: HTMLElement | SVGElement,
  name: string,
  value: unknown,
): void => {
  if (name === "style") {
    if (value == null) {
      el.removeAttribute("style");
    } else if (typeof value === "string") {
      el.style.cssText = value;
    } else if (typeof value === "object") {
      const style = value as Record<string, string | number>;
      for (const key of Object.keys(style)) {
        const val = style[key];
        if (val == null) {
          el.style.removeProperty(key);
        } else {
          el.style.setProperty(
            key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`),
            typeof val === "number" && val !== 0 && !unitlessProperties.has(key)
              ? `${val}px`
              : String(val),
          );
        }
      }
    }
    return;
  }

  const method =
    propertyUpdateMap[name] ||
    (name.startsWith("data-") || name.startsWith("aria-") ? "attribute" : "attribute");

  switch (method) {
    case "attribute":
      if (value == null || value === false) {
        el.removeAttribute(name);
      } else if (value === true) {
        el.setAttribute(name, "");
      } else {
        // eslint-disable-next-line @typescript-eslint/no-base-to-string
        el.setAttribute(name, String(value));
      }
      break;
    case "property":
      Reflect.set(el, name, value);
      break;
    case "classList":
      if (Array.isArray(value)) {
        value.forEach((v: string) => el.classList.add(v));
      } else {
        // eslint-disable-next-line @typescript-eslint/no-base-to-string
        el.setAttribute("class", value == null ? "" : String(value));
      }
      break;
    case "booleanAttribute":
      if (value) {
        el.setAttribute(name, "");
      } else {
        el.removeAttribute(name);
      }
      break;
  }
};

/**
 * Create a DOM event wrapper that handles Effect return values.
 *
 * If the handler returns an Effect, it is forked with full app context.
 * Submit events auto-preventDefault when handler returns an Effect.
 * Effect failures are wrapped in EventHandlerError and forwarded to onError.
 */
export const createEventWrapper =
  (
    handler: (event: Event) => unknown,
    eventType: string,
    runtime: FibraeRuntime,
    onError?: (error: EventHandlerError) => Effect.Effect<unknown, never, unknown>,
  ): EventListener =>
  (event: Event) => {
    const result = handler(event);
    if (Effect.isEffect(result)) {
      if (eventType === "submit") {
        event.preventDefault();
      }
      const effectWithErrorHandling = result.pipe(
        Effect.catchAllCause((cause) => {
          const error = new EventHandlerError({
            cause: Cause.squash(cause),
            eventType,
          });
          return onError ? onError(error) : Effect.logError("Event handler error", error);
        }),
      );
      runForkWithRuntime(runtime)(effectWithErrorHandling);
    }
  };

/**
 * Attach event listeners to a DOM element, tracking them in listenerStore.
 *
 * Uses createEventWrapper for Effect error handling and stores wrappers
 * in listenerStore so updateDom can remove them on re-render.
 */
export const attachEventListeners = (
  el: HTMLElement | SVGElement,
  props: Record<string, unknown>,
  runtime: FibraeRuntime,
  onError?: (error: EventHandlerError) => Effect.Effect<unknown, never, unknown>,
  listenerStore?: WeakMap<HTMLElement | SVGElement, Record<string, EventListener>>,
): void => {
  const store = listenerStore;
  const stored = store?.get(el) ?? {};

  Object.entries(props)
    .filter(([key, handler]) => isEvent(key) && typeof handler === "function")
    .forEach(([key, handler]) => {
      const eventType = key.toLowerCase().substring(2);
      const wrapper = createEventWrapper(
        handler as (e: Event) => unknown,
        eventType,
        runtime,
        onError,
      );
      el.addEventListener(eventType, wrapper);
      stored[eventType] = wrapper;
    });

  store?.set(el, stored);
};
