import * as Effect from "effect/Effect";
import { FibraeRuntime, runForkWithRuntime } from "./runtime.js";

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
  checked: "property",
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
      el.setAttribute(name, String(value ?? ""));
      break;
    case "property":
      Reflect.set(el, name, value);
      break;
    case "classList":
      if (Array.isArray(value)) {
        value.forEach((v: string) => el.classList.add(v));
      } else {
        el.setAttribute("class", String(value ?? ""));
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
 */
export const attachEventListeners = (
  el: HTMLElement,
  props: Record<string, unknown>,
  runtime: FibraeRuntime,
): void => {
  for (const [key, handler] of Object.entries(props)) {
    if (isEvent(key) && typeof handler === "function") {
      const eventType = key.toLowerCase().substring(2);

      el.addEventListener(eventType, (event: Event) => {
        const result = (handler as (e: Event) => unknown)(event);

        if (Effect.isEffect(result)) {
          // Use runForkWithRuntime to get the full application context
          const effectWithErrorHandling = (result as Effect.Effect<unknown, unknown, unknown>).pipe(
            Effect.catchAllCause((cause) => Effect.logError("Event handler error", cause)),
          );
          runForkWithRuntime(runtime)(effectWithErrorHandling);
        }
      });
    }
  }
};
