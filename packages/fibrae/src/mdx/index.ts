import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Layer from "effect/Layer";
import * as Context from "effect/Context";
import { pipe } from "effect/Function";

import type { VElement } from "../shared.js";
import { parseMdx, createProcessor } from "./parse.js";
import type { MdxComponents, MdxHighlighterShape } from "./render.js";
import type { MdxProcessorShape, ProcessorConfig } from "./parse.js";

// =============================================================================
// Re-exports
// =============================================================================

export { parseMdx, createProcessor, slugify, getTextContent } from "./parse.js";
export type {
  ParsedMdx,
  MdxHeading,
  MdxProcessorShape,
  Plugin,
  PluginTuple,
  ProcessorConfig,
} from "./parse.js";

export { renderMdast, renderHast } from "./render.js";
export type { MdxComponents, MdxHighlighterShape } from "./render.js";

// =============================================================================
// MdxProcessor Service
// =============================================================================

/**
 * Configurable markdown processor service.
 *
 * Default: remark-parse + gfm + frontmatter.
 * Use `MdxProcessor.make()` with custom remark/rehype plugins.
 *
 * @example
 * ```typescript
 * // Default processor
 * const layer = MdxProcessor.Default
 *
 * // With extra remark plugins (bare function or [plugin, options] tuple)
 * const layer = MdxProcessor.make({ remarkPlugins: [remarkMath] })
 *
 * // With rehype plugins (auto-bridges MDAST → HAST via dynamic import)
 * const layer = MdxProcessor.make({
 *   rehypePlugins: [rehypeKatex, [rehypeHighlight, { prefix: "hl-" }]],
 * })
 * ```
 */
export class MdxProcessor extends Context.Tag("fibrae/MdxProcessor")<
  MdxProcessor,
  MdxProcessorShape
>() {
  /** Default processor: remark-parse + gfm + frontmatter */
  static readonly Default = Layer.succeed(MdxProcessor, { parse: parseMdx });

  /** Create a processor with custom remark/rehype plugins */
  static readonly make = (config: ProcessorConfig) =>
    Layer.effect(MdxProcessor, createProcessor(config));
}

// =============================================================================
// MdxHighlighter Service
// =============================================================================

/**
 * Optional BYO code highlighter service.
 *
 * When provided, code blocks use this instead of plain `<pre><code>`.
 * User component overrides (`components.pre`/`components.code`) take priority.
 *
 * @example
 * ```typescript
 * import { highlightElement } from "my-highlighter"
 *
 * const layer = MdxHighlighter.make((code, lang) =>
 *   <pre class={`language-${lang}`}>
 *     <code innerHTML={highlightElement(code, lang)} />
 *   </pre>
 * )
 * ```
 */
export class MdxHighlighter extends Context.Tag("fibrae/MdxHighlighter")<
  MdxHighlighter,
  MdxHighlighterShape
>() {
  /** Create a highlighter from a highlight function */
  static readonly make = (highlight: (code: string, lang: string, meta?: string) => VElement) =>
    Layer.succeed(MdxHighlighter, { highlight });
}

// =============================================================================
// MDX Component
// =============================================================================

export interface MDXProps {
  readonly content: string;
  readonly components?: MdxComponents;
}

/**
 * Render markdown content as fibrae VElements.
 *
 * Both `MdxProcessor` and `MdxHighlighter` are optional services.
 * Without them, uses default processor and no highlighting.
 *
 * @example
 * ```tsx
 * // Simplest usage — no services needed
 * <MDX content={markdownString} />
 *
 * // With component overrides
 * <MDX content={markdownString} components={{
 *   h1: ({ children, ...props }) => <h1 class="text-4xl" {...props}>{children}</h1>,
 *   a: ({ href, children }) => <Link href={href}>{children}</Link>,
 * }} />
 *
 * // With processor and highlighter services
 * const MdxLive = Layer.mergeAll(
 *   MdxProcessor.make({ rehypePlugins: [[rehypeHighlight]] }),
 *   MdxHighlighter.make((code, lang) => <CodeBlock code={code} lang={lang} />),
 * )
 *
 * // Provide to your app
 * render(<App />, root).pipe(Effect.provide(MdxLive))
 * ```
 */
export const MDX = ({ content, components }: MDXProps) =>
  Effect.gen(function* () {
    const processor = yield* pipe(
      Effect.serviceOption(MdxProcessor),
      Effect.map(Option.getOrElse((): MdxProcessorShape => ({ parse: parseMdx }))),
    );
    const highlighterOption = yield* Effect.serviceOption(MdxHighlighter);
    const parsed = processor.parse(content);
    return parsed.render(components, Option.getOrUndefined(highlighterOption));
  });
