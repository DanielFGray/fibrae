import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import remarkMdx from "remark-mdx";
import { parse as parseYaml } from "yaml";
import * as Effect from "effect/Effect";
import type { Root, Heading } from "mdast";
import type { Root as HastRoot } from "hast";
import type { VElement } from "../shared.js";
import type { MdxComponents, MdxHighlighterShape } from "./render.js";
import { renderMdast, renderHast } from "./render.js";

// =============================================================================
// Types
// =============================================================================

export interface MdxHeading {
  readonly depth: number;
  readonly text: string;
  readonly slug: string;
}

export interface ParsedMdx {
  readonly frontmatter: Record<string, unknown>;
  readonly headings: ReadonlyArray<MdxHeading>;
  readonly render: (components?: MdxComponents, highlighter?: MdxHighlighterShape) => VElement;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PluginTuple = readonly [plugin: any, ...options: any[]];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Plugin = PluginTuple | ((...args: any[]) => any);

export interface ProcessorConfig {
  readonly remarkPlugins?: ReadonlyArray<Plugin>;
  readonly rehypePlugins?: ReadonlyArray<Plugin>;
}

// =============================================================================
// Utilities
// =============================================================================

/** Extract plain text from an MDAST node tree */
export const getTextContent = (node: object): string => {
  if ("value" in node && typeof node.value === "string") return node.value;
  if ("children" in node && Array.isArray(node.children))
    return (node.children as object[]).map(getTextContent).join("");
  return "";
};

/** Convert text to a URL-safe slug for heading anchors */
export const slugify = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

// =============================================================================
// Shared extraction helpers
// =============================================================================

const extractFrontmatter = (tree: Root): Record<string, unknown> => {
  const yamlNode = tree.children.find(
    (n): n is { type: "yaml"; value: string } => n.type === "yaml",
  );
  if (!yamlNode) return {};
  try {
    const parsed = parseYaml(yamlNode.value);
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
  } catch {
    // Malformed YAML — return empty frontmatter
  }
  return {};
};

const extractHeadings = (tree: Root): MdxHeading[] =>
  tree.children
    .filter((n): n is Heading => n.type === "heading")
    .map((n) => {
      const text = getTextContent(n);
      return { depth: n.depth, text, slug: slugify(text) };
    });

const stripYaml = (tree: Root): Root => ({
  ...tree,
  children: tree.children.filter((n) => n.type !== "yaml"),
});

// =============================================================================
// Default processor (reused across calls)
// =============================================================================

const defaultProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkFrontmatter, ["yaml"])
  .use(remarkMdx);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const applyPlugin = (proc: any, plugin: Plugin) => {
  if (Array.isArray(plugin)) {
    const [p, ...options] = plugin;
    return proc.use(p, ...options);
  }
  return proc.use(plugin);
};

// =============================================================================
// Parse (convenience — no Effect needed)
// =============================================================================

/**
 * Parse a markdown string into frontmatter, headings, and a render function.
 *
 * Uses the default processor (remark-parse + gfm + frontmatter).
 * The returned `render` method produces a fibrae VElement tree from the MDAST.
 */
export const parseMdx = (source: string): ParsedMdx => {
  const tree = defaultProcessor.runSync(defaultProcessor.parse(source)) as Root;
  const frontmatter = extractFrontmatter(tree);
  const headings = extractHeadings(tree);
  const contentTree = stripYaml(tree);

  return {
    frontmatter,
    headings,
    render: (components?: MdxComponents, highlighter?: MdxHighlighterShape) =>
      renderMdast(contentTree, components, highlighter),
  };
};

// =============================================================================
// Configurable processor factory
// =============================================================================

/** Shape returned by createProcessor — same as MdxProcessor service */
export interface MdxProcessorShape {
  readonly parse: (source: string) => ParsedMdx;
}

/**
 * Build a configured unified pipeline and return a `{ parse }` object.
 *
 * Returns an Effect because rehype plugins require a dynamic `import()` of
 * the optional `remark-rehype` dependency. For remark-only configs, the
 * Effect resolves synchronously.
 */
export const createProcessor = (config: ProcessorConfig): Effect.Effect<MdxProcessorShape> =>
  Effect.gen(function* () {
    const hasRehype = config.rehypePlugins && config.rehypePlugins.length > 0;

    // Build the unified pipeline
    // Type-erasure boundary: pipeline output type changes when rehype plugins are added
    // (MDAST Root → HAST Root), so we use `any` for the processor type
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let proc: any = unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkFrontmatter, ["yaml"])
      .use(remarkMdx);

    // Apply user remark plugins
    if (config.remarkPlugins) {
      for (const plugin of config.remarkPlugins) {
        proc = applyPlugin(proc, plugin);
      }
    }

    // If rehype plugins, dynamically import remark-rehype and bridge MDAST → HAST
    if (hasRehype) {
      const remarkRehype = yield* Effect.promise(() => import("remark-rehype"));
      proc = proc.use(remarkRehype.default);
      for (const plugin of config.rehypePlugins!) {
        proc = applyPlugin(proc, plugin);
      }
    }

    return {
      parse: (source: string): ParsedMdx => {
        // Parse raw MDAST first (before rehype) for frontmatter/headings
        const rawTree = defaultProcessor.runSync(defaultProcessor.parse(source)) as Root;
        const frontmatter = extractFrontmatter(rawTree);
        const headings = extractHeadings(rawTree);

        // Run the full pipeline (may produce HAST if rehype plugins present)
        const processedTree = proc.runSync(proc.parse(source));

        if (hasRehype) {
          const hastRoot = processedTree as unknown as HastRoot;
          return {
            frontmatter,
            headings,
            render: (components?: MdxComponents, highlighter?: MdxHighlighterShape) =>
              renderHast(hastRoot, components, highlighter),
          };
        }

        const contentTree = stripYaml(processedTree as Root);
        return {
          frontmatter,
          headings,
          render: (components?: MdxComponents, highlighter?: MdxHighlighterShape) =>
            renderMdast(contentTree, components, highlighter),
        };
      },
    };
  });
