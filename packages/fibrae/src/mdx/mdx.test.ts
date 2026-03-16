/* eslint-disable local/no-run-promise -- Tests need to bridge Effect to async test runner */
import { describe, test, expect } from "bun:test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { h } from "../index.js";
import { renderToString, renderToStringWith } from "../server.js";
import { SSRAtomRegistryLayer } from "../server.js";
import { MDX, MdxHighlighter, parseMdx } from "./index.js";
import type { MdxComponents } from "./index.js";

const renderMdx = (content: string, components?: MdxComponents) =>
  renderToString(h(MDX as any, { content, components })).pipe(Effect.runPromise);

const renderMdxWith = (
  content: string,
  components: MdxComponents | undefined,
  layer: Layer.Layer<any>,
) =>
  renderToStringWith(h(MDX as any, { content, components })).pipe(
    Effect.provide(Layer.merge(SSRAtomRegistryLayer, layer)),
    Effect.runPromise,
  );

describe("MDX", () => {
  test("renders a heading", async () => {
    const { html } = await renderMdx("# hello world");
    expect(html).toBe('<h1 id="hello-world">hello world</h1>');
  });

  test("renders paragraphs", async () => {
    const { html } = await renderMdx("hello world");
    expect(html).toBe("<p>hello world</p>");
  });

  test("renders inline formatting", async () => {
    const { html } = await renderMdx("hello **bold** and *italic*");
    expect(html).toBe("<p>hello <strong>bold</strong> and <em>italic</em></p>");
  });

  test("renders links", async () => {
    const { html } = await renderMdx("[click here](https://example.com)");
    expect(html).toBe('<p><a href="https://example.com">click here</a></p>');
  });

  test("renders code blocks", async () => {
    const { html } = await renderMdx("```ts\nconst x = 1;\n```");
    expect(html).toBe(
      '<pre><code class="language-ts" data-language="ts">const x = 1;</code></pre>',
    );
  });

  test("renders lists", async () => {
    const { html } = await renderMdx("- one\n- two\n- three");
    expect(html).toBe("<ul><li><p>one</p></li><li><p>two</p></li><li><p>three</p></li></ul>");
  });

  test("strips frontmatter from rendered output", async () => {
    const { html } = await renderMdx("---\ntitle: Test\n---\n\n# Hello");
    expect(html).toBe('<h1 id="hello">Hello</h1>');
  });
});

describe("parseMdx", () => {
  test("extracts frontmatter", () => {
    const { frontmatter } = parseMdx("---\ntitle: Hello\ndescription: A test\n---\n\n# Hello");
    expect(frontmatter).toEqual({ title: "Hello", description: "A test" });
  });

  test("extracts headings with slugs", () => {
    const { headings } = parseMdx("# Hello World\n## Sub Section\n### Deep");
    expect(headings).toEqual([
      { depth: 1, text: "Hello World", slug: "hello-world" },
      { depth: 2, text: "Sub Section", slug: "sub-section" },
      { depth: 3, text: "Deep", slug: "deep" },
    ]);
  });

  test("returns empty frontmatter when none present", () => {
    const { frontmatter } = parseMdx("# Just a heading");
    expect(frontmatter).toEqual({});
  });
});

describe("MDX JSX elements", () => {
  test("renders a flow JSX element via components", async () => {
    const { html } = await renderMdx('# Title\n\n<Callout type="info">Important note</Callout>', {
      Callout: ({ type, children }: any) => h("div", { class: `callout-${type}` }, children),
    });
    expect(html).toContain('<div class="callout-info">Important note</div>');
  });

  test("renders self-closing JSX element", async () => {
    const { html } = await renderMdx("<Divider />", { Divider: () => h("hr", { class: "fancy" }) });
    expect(html).toContain('<hr class="fancy" />');
  });

  test("renders boolean JSX attributes", async () => {
    const { html } = await renderMdx("<Toggle disabled />", {
      Toggle: ({ disabled }: any) => h("button", { disabled }, ["toggle"]),
    });
    expect(html).toContain("<button disabled>toggle</button>");
  });

  test("renders inline JSX within text", async () => {
    const { html } = await renderMdx("text with <Badge>hot</Badge> inline", {
      Badge: ({ children }: any) => h("span", { class: "badge" }, children),
    });
    expect(html).toContain('text with <span class="badge">hot</span> inline');
  });

  test("falls back to HTML tag for lowercase names", async () => {
    const { html } = await renderMdx("<div>plain html</div>");
    expect(html).toContain("<div>plain html</div>");
  });

  test("renders JSX fragment", async () => {
    const { html } = await renderMdx("<>hello</>", {});
    expect(html).toContain("hello");
  });
});

describe("MdxHighlighter", () => {
  test("uses highlighter for code blocks", async () => {
    const layer = MdxHighlighter.make((code, lang) =>
      h("div", { class: `highlighted-${lang}` }, [code]),
    );
    const { html } = await renderMdxWith("```ts\nconst x = 1;\n```", undefined, layer);
    expect(html).toContain('<div class="highlighted-ts">const x = 1;</div>');
  });

  test("component override takes priority over highlighter", async () => {
    const layer = MdxHighlighter.make((_code, _lang) => h("div", { class: "should-not-appear" }));
    const { html } = await renderMdxWith(
      "```ts\nconst x = 1;\n```",
      { pre: ({ children }: any) => h("pre", { class: "custom" }, children) },
      layer,
    );
    expect(html).toContain('class="custom"');
    expect(html).not.toContain("should-not-appear");
  });
});
