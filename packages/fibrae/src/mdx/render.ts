import { h, createTextElement } from "../h.js";
import type { VElement, VChild } from "../shared.js";
import { getTextContent, slugify } from "./parse.js";
import type {
  Root,
  Heading,
  Paragraph,
  Text,
  Emphasis,
  Strong,
  Link,
  Image,
  Code,
  InlineCode,
  Blockquote,
  List,
  ListItem,
  Table,
  TableRow,
  TableCell,
  Html,
  Delete,
  RootContent,
} from "mdast";
import type {
  Root as HastRoot,
  Element as HastElement,
  Text as HastText,
  RootContent as HastRootContent,
} from "hast";

// =============================================================================
// Types
// =============================================================================

/** Map of element names to component overrides */
export type MdxComponents = Partial<Record<string, (props: Record<string, unknown>) => VElement>>;

/**
 * Resolve a component override or fall back to a plain HTML tag.
 * MdxComponents constrains overrides to return VElement, so the result
 * is always VElement regardless of whether a string or function is used.
 */
const resolve = (
  components: MdxComponents,
  tag: string,
  props: Record<string, unknown>,
  children?: VChild[],
): VElement => {
  const override = components[tag];
  if (override) return override({ ...props, children: children ?? [] });
  return h(tag, props, children ?? []);
};

/** Shape of a highlighter — matches MdxHighlighter service interface */
export interface MdxHighlighterShape {
  readonly highlight: (code: string, lang: string, meta?: string) => VElement;
}

// =============================================================================
// MDX JSX types (from remark-mdx, defined here to avoid hard dep on mdast-util-mdx-jsx)
// =============================================================================

interface MdxJsxAttribute {
  readonly type: "mdxJsxAttribute";
  readonly name: string;
  readonly value: string | { type: string; value: string } | null | undefined;
}

interface MdxJsxElement {
  readonly type: "mdxJsxFlowElement" | "mdxJsxTextElement";
  readonly name: string | null;
  readonly attributes: ReadonlyArray<MdxJsxAttribute | { type: "mdxJsxExpressionAttribute" }>;
  readonly children: ReadonlyArray<RootContent>;
}

/** Convert MDX JSX attributes to a props object */
const mdxAttrsToProps = (attrs: MdxJsxElement["attributes"]): Record<string, unknown> => {
  const props: Record<string, unknown> = {};
  for (const attr of attrs) {
    if (attr.type !== "mdxJsxAttribute") continue; // skip expression attributes
    const a = attr as MdxJsxAttribute;
    if (a.value === null || a.value === undefined) {
      props[a.name] = true; // boolean attribute: <Comp disabled />
    } else if (typeof a.value === "string") {
      props[a.name] = a.value; // string attribute: <Comp name="value" />
    }
    // expression attributes ({ type: "mdxJsxAttributeValueExpression" }) are skipped
  }
  return props;
};

/** Render an MDX JSX element — maps name to components, falls back to HTML tag */
const renderMdxJsx = (
  node: MdxJsxElement,
  components: MdxComponents,
  highlighter?: MdxHighlighterShape,
): VElement => {
  const name = node.name;
  if (!name) {
    // Fragment: <>{children}</>
    return h("FRAGMENT", {}, renderChildren(node.children, components, highlighter));
  }
  const props = mdxAttrsToProps(node.attributes);
  const children = renderChildren(node.children, components, highlighter);
  return resolve(components, name, props, children);
};

// =============================================================================
// MDAST Rendering
// =============================================================================

const renderChildren = (
  children: ReadonlyArray<RootContent>,
  components: MdxComponents,
  highlighter?: MdxHighlighterShape,
): VChild[] =>
  children.reduce<VChild[]>((acc, child) => {
    const el = renderNode(child, components, highlighter);
    if (el !== null) acc.push(el);
    return acc;
  }, []);

const renderHeading = (
  node: Heading,
  components: MdxComponents,
  highlighter?: MdxHighlighterShape,
): VElement => {
  const tag = `h${node.depth}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
  const text = getTextContent(node);
  const slug = slugify(text);
  return h(
    (components[tag] ?? tag) as any,
    { id: slug },
    renderChildren(node.children, components, highlighter),
  );
};

const renderCodeBlock = (
  node: Code,
  components: MdxComponents,
  highlighter?: MdxHighlighterShape,
): VElement => {
  // User component overrides take priority over highlighter
  if (!components["pre"] && !components["code"] && highlighter && node.lang) {
    return highlighter.highlight(node.value, node.lang, node.meta ?? undefined);
  }

  const codeProps: Record<string, unknown> = {};
  if (node.lang) {
    codeProps.class = `language-${node.lang}`;
    codeProps["data-language"] = node.lang;
  }
  if (node.meta) codeProps["data-meta"] = node.meta;

  const codeEl = resolve(components, "code", codeProps, [createTextElement(node.value)]);
  return resolve(components, "pre", {}, [codeEl]);
};

const renderList = (
  node: List,
  components: MdxComponents,
  highlighter?: MdxHighlighterShape,
): VElement => {
  const tag = node.ordered ? "ol" : "ul";
  const props: Record<string, unknown> = {};
  if (node.ordered && node.start != null && node.start !== 1) props.start = node.start;
  return h(
    (components[tag] ?? tag) as any,
    props,
    renderChildren(node.children, components, highlighter),
  );
};

const renderListItem = (
  node: ListItem,
  components: MdxComponents,
  highlighter?: MdxHighlighterShape,
): VElement => {
  const children = renderChildren(node.children, components, highlighter);
  if (node.checked != null) {
    const checkbox = h("input", { type: "checkbox", checked: node.checked, disabled: true });
    return resolve(components, "li", { class: "task-list-item" }, [checkbox, ...children]);
  }
  return resolve(components, "li", {}, children);
};

const renderTable = (
  node: Table,
  components: MdxComponents,
  highlighter?: MdxHighlighterShape,
): VElement => {
  const [headerRow, ...bodyRows] = node.children;
  const thead = h("thead", {}, [renderTableRow(headerRow!, components, true, highlighter)]);
  const children: VChild[] = [thead];
  if (bodyRows.length > 0) {
    children.push(
      h(
        "tbody",
        {},
        bodyRows.map((row) => renderTableRow(row, components, false, highlighter)),
      ),
    );
  }
  return resolve(components, "table", {}, children);
};

const renderTableRow = (
  node: TableRow,
  components: MdxComponents,
  isHeader: boolean,
  highlighter?: MdxHighlighterShape,
): VElement =>
  resolve(
    components,
    "tr",
    {},
    node.children.map((cell) => renderTableCell(cell, components, isHeader, highlighter)),
  );

const renderTableCell = (
  node: TableCell,
  components: MdxComponents,
  isHeader: boolean,
  highlighter?: MdxHighlighterShape,
): VElement => {
  const tag = isHeader ? "th" : "td";
  return h(
    (components[tag] ?? tag) as any,
    {},
    renderChildren(node.children, components, highlighter),
  );
};

const inline = (
  tag: string,
  children: ReadonlyArray<RootContent>,
  components: MdxComponents,
  highlighter?: MdxHighlighterShape,
): VElement =>
  h((components[tag] ?? tag) as any, {}, renderChildren(children, components, highlighter));

// =============================================================================
// MDAST main dispatch
// =============================================================================

const renderNode = (
  node: RootContent,
  components: MdxComponents,
  highlighter?: MdxHighlighterShape,
): VElement | null => {
  switch (node.type) {
    case "heading":
      return renderHeading(node as Heading, components, highlighter);
    case "paragraph":
      return resolve(
        components,
        "p",
        {},
        renderChildren((node as Paragraph).children, components, highlighter),
      );
    case "text":
      return createTextElement((node as Text).value);
    case "emphasis":
      return inline("em", (node as Emphasis).children, components, highlighter);
    case "strong":
      return inline("strong", (node as Strong).children, components, highlighter);
    case "delete":
      return inline("del", (node as Delete).children, components, highlighter);
    case "link": {
      const n = node as Link;
      const props: Record<string, unknown> = { href: n.url };
      if (n.title) props.title = n.title;
      return resolve(components, "a", props, renderChildren(n.children, components, highlighter));
    }
    case "image": {
      const n = node as Image;
      const props: Record<string, unknown> = { src: n.url, alt: n.alt ?? "" };
      if (n.title) props.title = n.title;
      return resolve(components, "img", props);
    }
    case "code":
      return renderCodeBlock(node as Code, components, highlighter);
    case "inlineCode":
      return resolve(components, "code", {}, [createTextElement((node as InlineCode).value)]);
    case "blockquote":
      return resolve(
        components,
        "blockquote",
        {},
        renderChildren((node as Blockquote).children, components, highlighter),
      );
    case "list":
      return renderList(node as List, components, highlighter);
    case "listItem":
      return renderListItem(node as ListItem, components, highlighter);
    case "thematicBreak":
      return resolve(components, "hr", {});
    case "table":
      return renderTable(node as Table, components, highlighter);
    case "tableRow":
      return renderTableRow(node as TableRow, components, false, highlighter);
    case "tableCell":
      return renderTableCell(node as TableCell, components, false, highlighter);
    case "html":
      return h("span", { dangerouslySetInnerHTML: (node as Html).value });
    case "break":
      return resolve(components, "br", {});
    case "mdxJsxFlowElement":
    case "mdxJsxTextElement":
      return renderMdxJsx(node as unknown as MdxJsxElement, components, highlighter);
    case "mdxFlowExpression":
    case "mdxTextExpression":
    case "mdxjsEsm":
      // JS expressions and import/export — skip (would require eval)
      return null;
    case "yaml":
    case "definition":
    case "footnoteDefinition":
    case "footnoteReference":
    case "linkReference":
    case "imageReference":
      return null;
    default: {
      // Custom node types from remark plugins (e.g. math, inlineMath)
      // Type-erasure boundary: remark plugins can add arbitrary node types not in RootContent
      const unknownNode = node as unknown as { type: string };
      const customComponent = components[unknownNode.type];
      if (customComponent) {
        return customComponent(node as unknown as Record<string, unknown>);
      }
      return null;
    }
  }
};

/**
 * Render a pre-parsed MDAST tree to a fibrae VElement.
 *
 * Use this when you have already called `parseMdx` (e.g. in an SSG loader)
 * and want to render the tree with component overrides.
 */
export const renderMdast = (
  tree: Root,
  components: MdxComponents = {},
  highlighter?: MdxHighlighterShape,
): VElement => h("FRAGMENT" as any, {}, renderChildren(tree.children, components, highlighter));

// =============================================================================
// HAST Rendering
// =============================================================================

/**
 * Detect a `<pre><code class="language-X">` pattern in HAST.
 * Returns `{ code, lang, meta }` if matched, undefined otherwise.
 */
const detectCodeBlock = (
  node: HastElement,
): { code: string; lang: string; meta?: string } | undefined => {
  if (node.tagName !== "pre") return undefined;
  const firstChild = node.children[0];
  if (!firstChild || firstChild.type !== "element" || firstChild.tagName !== "code")
    return undefined;

  const className = firstChild.properties?.className;
  if (!Array.isArray(className)) return undefined;

  const langClass = className.find(
    (c): c is string => typeof c === "string" && c.startsWith("language-"),
  );
  if (!langClass) return undefined;

  const lang = langClass.slice("language-".length);
  const code = firstChild.children
    .filter((c): c is HastText => c.type === "text")
    .map((c) => c.value)
    .join("");
  const meta =
    typeof firstChild.properties?.dataMeta === "string"
      ? firstChild.properties.dataMeta
      : undefined;

  return { code, lang, meta };
};

const renderHastChildren = (
  children: ReadonlyArray<HastRootContent>,
  components: MdxComponents,
  highlighter?: MdxHighlighterShape,
): VChild[] =>
  children.reduce<VChild[]>((acc, child) => {
    const el = renderHastNode(child, components, highlighter);
    if (el !== null) acc.push(el);
    return acc;
  }, []);

const renderHastNode = (
  node: HastRootContent,
  components: MdxComponents,
  highlighter?: MdxHighlighterShape,
): VElement | null => {
  switch (node.type) {
    case "text":
      return createTextElement(node.value);
    case "comment":
      return null;
    case "element": {
      // Code block highlighting — user overrides take priority
      if (!components["pre"] && !components["code"] && highlighter) {
        const codeBlock = detectCodeBlock(node);
        if (codeBlock) {
          return highlighter.highlight(codeBlock.code, codeBlock.lang, codeBlock.meta);
        }
      }

      const tag = node.tagName;
      const props: Record<string, unknown> = {};

      // Convert HAST properties to VElement props
      if (node.properties) {
        for (const [key, value] of Object.entries(node.properties)) {
          if (key === "className" && Array.isArray(value)) {
            props.class = value.join(" ");
          } else {
            props[key] = value;
          }
        }
      }

      const children = renderHastChildren(node.children, components, highlighter);
      return h((components[tag] ?? tag) as any, props, children);
    }
    default:
      return null;
  }
};

/**
 * Render a pre-parsed HAST tree to a fibrae VElement.
 *
 * Used automatically when the processor was configured with rehype plugins.
 * Can also be called directly if you have a HAST tree from another source.
 */
export const renderHast = (
  tree: HastRoot,
  components: MdxComponents = {},
  highlighter?: MdxHighlighterShape,
): VElement => h("FRAGMENT" as any, {}, renderHastChildren(tree.children, components, highlighter));
