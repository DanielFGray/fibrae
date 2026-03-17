/**
 * Form component — declarative form submission with schema-decoded payloads.
 *
 * React Router-inspired: connects to the route's action by default,
 * or accepts an explicit action prop for fetcher-style usage.
 *
 * Submission lifecycle:
 * 1. Serialize FormData → plain record
 * 2. Schema.decodeUnknown(PayloadSchema) → typed payload
 * 3. Decode failure → validation error (no action call)
 * 4. Decode success → invoke action Effect
 * 5. State transitions: idle → pending → success/failure
 * 6. If navigate !== false: navigate after success
 *
 * Design: builds VElement directly (no JSX) — consistent with Link.ts pattern.
 */

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import * as Context from "effect/Context";
import { Atom, Registry as AtomRegistry } from "@effect-atom/atom";
import { Navigator } from "./Navigator.js";
import { RouterHandlers, type RouteAction, type SubmissionState } from "./RouterBuilder.js";
import type { VElement, VChild } from "../shared.js";

// =============================================================================
// Errors
// =============================================================================

/**
 * Validation error from schema decode failure on form data.
 */
export class FormValidationError extends Schema.TaggedError<FormValidationError>()(
  "FormValidationError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {}

// =============================================================================
// Types
// =============================================================================

/**
 * Service tag for the current form's submission state.
 * Components inside a Form can read this to show loading/error states.
 */
export class FormState extends Context.Tag("fibrae/FormState")<
  FormState,
  {
    readonly state: Atom.Writable<SubmissionState, SubmissionState>;
  }
>() {}

/**
 * Props for the Form component.
 */
export interface FormProps {
  /** Explicit action — overrides the route's action. Accepts decoded payload, returns Effect. */
  readonly action?: RouteAction;
  /** Schema to decode FormData. Required when using explicit action. */
  readonly schema?: Schema.Schema.Any;
  /** HTTP method attribute (default: "post"). */
  readonly method?: string;
  /** When false, skip navigation after success (fetcher-style). Default: true. */
  readonly navigate?: boolean;
  /** Route name to navigate to after success. If unset, stays on current route. */
  readonly navigateTo?: string;
  /** Callback when submission succeeds. */
  readonly onSuccess?: (data: unknown) => void;
  /** Callback when submission fails. */
  readonly onError?: (error: unknown) => void;
  /** Additional CSS class names. */
  readonly class?: string;
  /** Children (form fields, buttons, etc.). Already normalized by JSX runtime. */
  readonly children?: VChild;
  /** Data attributes for testing. */
  readonly "data-cy"?: string;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Serialize FormData into a plain record.
 * Multiple values for the same key become arrays.
 */
const formDataToRecord = (formData: FormData): Record<string, unknown> => {
  const record: Record<string, unknown> = {};
  formData.forEach((value, key) => {
    const existing = record[key];
    if (existing !== undefined) {
      record[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
    } else {
      record[key] = value;
    }
  });
  return record;
};

// =============================================================================
// Form Component
// =============================================================================

/**
 * Create a Form component for the current route context.
 *
 * Wires to the route's action by default. Accepts explicit action for fetcher-style.
 *
 * Usage:
 * ```typescript
 * // Route action form — uses route's action config
 * <Form>
 *   <input name="title" />
 *   <button type="submit">Save</button>
 * </Form>
 *
 * // Explicit action (fetcher-style)
 * <Form action={myAction} navigate={false}>
 *   <input name="query" />
 *   <button type="submit">Search</button>
 * </Form>
 * ```
 */
export function Form(
  props: FormProps,
): Effect.Effect<VElement, never, Navigator | RouterHandlers | AtomRegistry.AtomRegistry> {
  return Effect.gen(function* () {
    const navigator = yield* Navigator;
    const routerHandlers = yield* RouterHandlers;
    const registry = yield* AtomRegistry.AtomRegistry;

    // Resolve the action: explicit prop or from current route
    const resolvedAction: Option.Option<RouteAction> = props.action
      ? Option.some(props.action)
      : yield* resolveRouteAction(navigator, routerHandlers, registry);

    // Create submission state atom for this form instance
    const stateAtom = Atom.make<SubmissionState>({ _tag: "Idle" });

    // Build the submit handler
    const handleSubmit = (e: Event) => {
      e.preventDefault();

      const form = e.target as HTMLFormElement;
      const formData = new FormData(form);
      const rawPayload = formDataToRecord(formData);

      return Effect.gen(function* () {
        if (Option.isNone(resolvedAction)) {
          yield* Effect.logWarning("Form submitted but no action configured");
          return;
        }

        const routeAction = resolvedAction.value;

        // Transition to pending
        registry.set(stateAtom, { _tag: "Pending" });

        // Decode payload via schema
        const decoded = yield* (
          Schema.decodeUnknown(routeAction.schema)(rawPayload) as Effect.Effect<unknown, unknown>
        ).pipe(
          Effect.mapError(
            (cause) =>
              new FormValidationError({
                message: "Form validation failed",
                cause,
              }),
          ),
        );

        // Invoke action
        const result = yield* routeAction.handler({ payload: decoded });

        // Success
        registry.set(stateAtom, { _tag: "Success", data: result });
        if (props.onSuccess) props.onSuccess(result);

        // Navigate after success (unless disabled)
        if (props.navigate !== false && props.navigateTo) {
          yield* navigator.go(props.navigateTo);
        }
      }).pipe(
        Effect.catchAll((error) =>
          Effect.sync(() => {
            registry.set(stateAtom, { _tag: "Failure", error });
            if (props.onError) props.onError(error);
          }),
        ),
      );
    };

    // Normalize children
    const normalizedChildren = props.children
      ? Array.isArray(props.children)
        ? props.children
        : [props.children]
      : [];

    return {
      type: "form",
      props: {
        method: props.method ?? "post",
        class: props.class || undefined,
        "data-cy": props["data-cy"],
        onSubmit: handleSubmit,
        children: normalizedChildren.filter(
          (child) => child !== null && child !== undefined && child !== false && child !== true,
        ) as VElement[],
      },
    };
  });
}

/**
 * Resolve the action from the current route.
 * Reads Navigator.currentRoute to find the matched route's action.
 */
function resolveRouteAction(
  navigator: Navigator["Type"],
  routerHandlers: RouterHandlers["Type"],
  registry: AtomRegistry.AtomRegistry["Type"],
): Effect.Effect<Option.Option<RouteAction>> {
  return Effect.sync(() => {
    const currentRoute = registry.get(navigator.currentRoute);
    if (Option.isNone(currentRoute)) return Option.none();

    const handler = routerHandlers.getHandler(currentRoute.value.routeName);
    if (Option.isNone(handler)) return Option.none();

    return handler.value.action;
  });
}
