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
  key !== "children" && key !== "ref" && key !== "key" && !isEvent(key);

/**
 * Set a DOM property using the appropriate method
 */
export const setDomProperty = (el: HTMLElement, name: string, value: unknown): void => {
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
 * Attach event listeners to a DOM element.
 * Uses runForkWithRuntime to get the full application context.
 * When an event handler Effect fails, converts to EventHandlerError and calls onError callback.
 */
export const attachEventListeners = (
  el: HTMLElement,
  props: Record<string, unknown>,
  runtime: FibraeRuntime,
  onError?: (error: EventHandlerError) => Effect.Effect<unknown, never, unknown>,
): void => {
  for (const [key, handler] of Object.entries(props)) {
    if (isEvent(key) && typeof handler === "function") {
      const eventType = key.toLowerCase().substring(2);

      el.addEventListener(eventType, (event: Event) => {
        const result = (handler as (e: Event) => unknown)(event);

        if (Effect.isEffect(result)) {
          // Use runForkWithRuntime to get the full application context
          const effectWithErrorHandling = result.pipe(
            Effect.catchAllCause((cause) => {
              // Convert to EventHandlerError with the event type
              const error = new EventHandlerError({
                cause: Cause.squash(cause),
                eventType,
              });
              if (onError) {
                return onError(error);
              }
              return Effect.logError("Event handler error", error);
            }),
          );
          runForkWithRuntime(runtime)(effectWithErrorHandling);
        }
      });
    }
  }
};
