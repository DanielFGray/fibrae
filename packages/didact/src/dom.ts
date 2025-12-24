import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Context from "effect/Context";
import { Registry as AtomRegistry } from "@effect-atom/atom";
import { DidactRuntime } from "./runtime.js";
import { ErrorBoundaryChannel } from "./components.js";

// =============================================================================
// DOM Property Handling
// =============================================================================

/**
 * Property update strategies for different DOM properties
 */
export const propertyUpdateMap: Record<string, "attribute" | "property" | "classList" | "booleanAttribute"> = {
  class: "classList",
  className: "classList",
  value: "property",
  checked: "property",
};

export const isEvent = (key: string) => key.startsWith("on");
export const isProperty = (key: string) => key !== "children" && key !== "ref" && key !== "key" && !isEvent(key);

/**
 * Set a DOM property using the appropriate method
 */
export const setDomProperty = (el: HTMLElement, name: string, value: unknown): void => {
  const method = propertyUpdateMap[name] ||
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
 * Attach event listeners to a DOM element
 * @param context - The current Effect context for service access (ThemeService, ErrorBoundaryChannel, etc.)
 */
export const attachEventListeners = (
  el: HTMLElement,
  props: Record<string, unknown>,
  runtime: DidactRuntime,
  context?: Context.Context<unknown>
): void => {
  for (const [key, handler] of Object.entries(props)) {
    if (isEvent(key) && typeof handler === "function") {
      const eventType = key.toLowerCase().substring(2);

      el.addEventListener(eventType, (event: Event) => {
        const result = (handler as (e: Event) => unknown)(event);

        if (Effect.isEffect(result)) {
          // Build the effect with full context if available, otherwise just basic services
          const effectWithServices = context
            ? (result as Effect.Effect<unknown, unknown, never>).pipe(
              Effect.provide(context),
              // Also add DidactRuntime in case it's needed but not in context
              Effect.provideService(DidactRuntime, runtime)
            )
            : (result as Effect.Effect<unknown, unknown, AtomRegistry.AtomRegistry>).pipe(
              Effect.provideService(AtomRegistry.AtomRegistry, runtime.registry),
              Effect.provideService(DidactRuntime, runtime)
            );

          // Try to get error boundary channel from context to report errors
          const errorChannel = context ? Context.getOption(context, ErrorBoundaryChannel) : Option.none();

          const errorHandler = Option.match(errorChannel, {
            onNone: () => (cause: unknown) => Effect.logError("Event handler error (no boundary)", cause),
            onSome: (channel) => (cause: unknown) => channel.reportError(cause)
          });

          runtime.runFork(
            effectWithServices.pipe(
              Effect.catchAllCause(errorHandler)
            )
          );
        }
      });
    }
  }
};
