import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as Effect from "effect/Effect";
import * as Scope from "effect/Scope";
import * as Deferred from "effect/Deferred";
import { Atom as BaseAtom } from "@effect-atom/atom";

/**
 * Primitive element types: HTML tags, text nodes, or fragments
 */
export type Primitive = keyof HTMLElementTagNameMap | "TEXT_ELEMENT" | "FRAGMENT";

/**
 * Element type can be a primitive or a component function
 * Components can return VElement, Effect, or Stream
 */
export type ElementType<Props = {}> =
  | Primitive
  | ((props: Props) => VElement | Stream.Stream<VElement, any, any> | Effect.Effect<VElement, any, any>);

/**
 * Virtual element representation - the core unit of the virtual DOM
 */
export interface VElement {
  type: ElementType;
  props: {
    [key: string]: unknown;
    children?: VElement[];
  };
}

/**
 * Mutable reference to a fiber for component instances
 */
export type FiberRef = { current: Fiber };

/**
 * Error boundary configuration
 */
export type ErrorBoundaryConfig = {
  fallback: VElement;
  onError?: (cause: unknown) => void;
  hasError: boolean;
};

/**
 * Fiber node - represents a unit of work in the reconciliation tree
 * Contains all state needed for rendering, effects, and diffing
 */
export interface Fiber {
  type: Option.Option<ElementType>;
  props: {
    [key: string]: unknown;
    children?: VElement[];
  };
  dom: Option.Option<Node>;
  parent: Option.Option<Fiber>;
  child: Option.Option<Fiber>;
  sibling: Option.Option<Fiber>;
  alternate: Option.Option<Fiber>;
  effectTag: Option.Option<"UPDATE" | "PLACEMENT" | "DELETION">;
  componentScope: Option.Option<Scope.Scope>;
  accessedAtoms: Option.Option<Set<BaseAtom.Atom<any>>>;
  latestStreamValue: Option.Option<VElement>;
  childFirstCommitDeferred: Option.Option<Deferred.Deferred<void>>;
  fiberRef: Option.Option<FiberRef>;
  isMultiEmissionStream: boolean;
  errorBoundary: Option.Option<ErrorBoundaryConfig>;
}

/**
 * Helper to check if a key is an event handler
 */
export const isEvent = (key: string) => key.startsWith("on");

/**
 * Helper to check if a key is a regular property (not children, ref, key, or event)
 */
export const isProperty = (key: string) =>
  key !== "children" && key !== "ref" && key !== "key" && !isEvent(key);

/**
 * Check if an element type is a primitive (string) or component (function)
 */
export const isPrimitive = (type: ElementType): type is Primitive =>
  typeof type === "string";

/**
 * Check if element type is a component function
 */
export const isComponent = (type: ElementType): type is ((props: any) => any) =>
  typeof type === "function";
