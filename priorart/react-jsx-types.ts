/**
 * Excerpted from @types/react index.d.ts
 * https://github.com/DefinitelyTyped/DefinitelyTyped/blob/master/types/react/index.d.ts
 *
 * Key types relevant to Fibrae's JSX implementation:
 */

// =============================================================================
// JSX Namespace (from bottom of file)
// =============================================================================

namespace JSX {
  // ElementType: what can be used as JSX tag
  type ElementType = string | React.JSXElementConstructor<any>;

  // Element: what a JSX expression produces
  interface Element extends React.ReactElement<any, any> {}

  // ElementClass: for class components
  interface ElementClass extends React.Component<any> {
    render(): React.ReactNode;
  }

  // ElementAttributesProperty: tells TS which property holds props
  interface ElementAttributesProperty {
    props: {};
  }

  // ElementChildrenAttribute: tells TS which property holds children
  // NOTE: Uses empty object {} to indicate "children" is the name
  interface ElementChildrenAttribute {
    children: {};
  }

  // IntrinsicAttributes: props available on all elements
  interface IntrinsicAttributes extends React.Attributes {}

  // IntrinsicElements: maps HTML/SVG tag names to their prop types
  interface IntrinsicElements {
    div: React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement>;
    // ... etc for each element
  }
}

// =============================================================================
// Supporting Types
// =============================================================================

// ReactElement: the shape of a JSX element
interface ReactElement<
  P = unknown,
  T extends string | JSXElementConstructor<any> = string | JSXElementConstructor<any>,
> {
  type: T;
  props: P;
  key: string | null;
}

// ReactNode: everything that can be rendered (superset of ReactElement)
type ReactNode =
  | ReactElement
  | string
  | number
  | bigint
  | Iterable<ReactNode>
  | ReactPortal
  | boolean
  | null
  | undefined
  | Promise<AwaitedReactNode>;

// JSXElementConstructor: what component functions look like
type JSXElementConstructor<P> =
  | ((props: P) => ReactNode | Promise<ReactNode>)
  | (new (props: P, context: any) => Component<any, any>);

// Attributes: base for all intrinsic attributes
interface Attributes {
  key?: Key | null | undefined;
}

// =============================================================================
// Key Insight for Fibrae
// =============================================================================

/**
 * React's ElementChildrenAttribute uses `children: {}` which is the standard
 * TypeScript convention. The `{}` is NOT a type for children's value - it's
 * a marker that tells TypeScript "the property named 'children' holds child elements".
 *
 * The ACTUAL type of children is defined in each component's props or in
 * DOMAttributes:
 *
 * interface DOMAttributes<T> {
 *   children?: ReactNode | undefined;
 *   // ...
 * }
 *
 * So the pattern is:
 * 1. ElementChildrenAttribute says "look for 'children'"
 * 2. The actual type comes from props interface or IntrinsicElements
 *
 * For Fibrae, we should:
 * - Keep `children: {}` in ElementChildrenAttribute (it's a marker, not a type)
 * - Add an eslint-disable comment for the no-empty-object-type rule
 * - Define actual children type in props interfaces
 */
