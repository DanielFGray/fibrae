/* eslint-disable local/no-run-promise -- Tests need to bridge Effect to async test runner */
import { describe, test, expect } from "bun:test";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Schema from "effect/Schema";
import { Atom, Registry as AtomRegistry } from "@effect-atom/atom";
import { h } from "./index.js";
import { Fragment } from "./jsx-runtime/index.js";
import { renderToString } from "./server.js";
import type { VElement } from "./shared.js";

/**
 * Helper to run an Effect in tests. Uses runPromise since tests expect
 * thrown errors to fail the test, which is the desired behavior.
 */
const runTest = <A, E>(effect: Effect.Effect<A, E, never>): Promise<A> => Effect.runPromise(effect);

// =============================================================================
// Basic HTML Rendering
// =============================================================================

describe("renderToString", () => {
  describe("basic elements", () => {
    test("renders a simple div", async () => {
      const element = h("div", {}, []);
      const result = await runTest(renderToString(element));
      expect(result.html).toBe("<div></div>");
    });

    test("renders text content", async () => {
      const element = h("p", {}, ["Hello, world!"]);
      const result = await runTest(renderToString(element));
      expect(result.html).toBe("<p>Hello, world!</p>");
    });

    test("renders nested elements", async () => {
      const element = h("div", {}, [h("span", {}, ["Nested"])]);
      const result = await runTest(renderToString(element));
      expect(result.html).toBe("<div><span>Nested</span></div>");
    });

    test("renders multiple children", async () => {
      const element = h("ul", {}, [h("li", {}, ["One"]), h("li", {}, ["Two"])]);
      const result = await runTest(renderToString(element));
      expect(result.html).toBe("<ul><li>One</li><li>Two</li></ul>");
    });
  });

  describe("attributes", () => {
    test("renders string attributes", async () => {
      const element = h("div", { id: "test", class: "container" }, []);
      const result = await runTest(renderToString(element));
      expect(result.html).toBe('<div id="test" class="container"></div>');
    });

    test("converts className to class", async () => {
      const element = h("div", { className: "my-class" }, []);
      const result = await runTest(renderToString(element));
      expect(result.html).toBe('<div class="my-class"></div>');
    });

    test("converts htmlFor to for", async () => {
      const element = h("label", { htmlFor: "input-id" }, []);
      const result = await runTest(renderToString(element));
      expect(result.html).toBe('<label for="input-id"></label>');
    });

    test("renders boolean true as attribute name only", async () => {
      const element = h("input", { disabled: true }, []);
      const result = await runTest(renderToString(element));
      expect(result.html).toBe("<input disabled />");
    });

    test("omits boolean false attributes", async () => {
      const element = h("input", { disabled: false }, []);
      const result = await runTest(renderToString(element));
      expect(result.html).toBe("<input />");
    });

    test("converts camelCase boolean attrs to lowercase HTML", async () => {
      const element = h("input", { readOnly: true }, []);
      const result = await runTest(renderToString(element));
      expect(result.html).toBe("<input readonly />");
    });

    test("omits camelCase boolean false attributes", async () => {
      const element = h("input", { readOnly: false }, []);
      const result = await runTest(renderToString(element));
      expect(result.html).toBe("<input />");
    });

    test("skips event handlers", async () => {
      const element = h("button", { onClick: () => {} }, ["Click"]);
      const result = await runTest(renderToString(element));
      expect(result.html).toBe("<button>Click</button>");
    });

    test("renders data-* attributes", async () => {
      const element = h("div", { "data-cy": "test-element" }, []);
      const result = await runTest(renderToString(element));
      expect(result.html).toBe('<div data-cy="test-element"></div>');
    });

    test("renders data-key for keyed elements", async () => {
      const element = h("li", { key: "item-1" }, ["Item 1"]);
      const result = await runTest(renderToString(element));
      expect(result.html).toBe('<li data-key="item-1">Item 1</li>');
    });

    test("renders data-key for keyed elements in a list", async () => {
      const items = ["a", "b", "c"];
      const element = h(
        "ul",
        {},
        items.map((item) => h("li", { key: item }, [item])),
      );
      const result = await runTest(renderToString(element));
      expect(result.html).toBe(
        '<ul><li data-key="a">a</li><li data-key="b">b</li><li data-key="c">c</li></ul>',
      );
    });

    test("renders data-key on void elements", async () => {
      const element = h("input", { key: "my-input", type: "text" }, []);
      const result = await runTest(renderToString(element));
      expect(result.html).toBe('<input type="text" data-key="my-input" />');
    });
  });

  describe("HTML escaping", () => {
    test("escapes text content", async () => {
      const element = h("p", {}, ["<script>alert('xss')</script>"]);
      const result = await runTest(renderToString(element));
      expect(result.html).toBe("<p>&lt;script&gt;alert(&#039;xss&#039;)&lt;/script&gt;</p>");
    });

    test("escapes attribute values", async () => {
      const element = h("div", { title: 'Say "hello"' }, []);
      const result = await runTest(renderToString(element));
      expect(result.html).toBe('<div title="Say &quot;hello&quot;"></div>');
    });

    test("escapes ampersands", async () => {
      const element = h("p", {}, ["Tom & Jerry"]);
      const result = await runTest(renderToString(element));
      expect(result.html).toBe("<p>Tom &amp; Jerry</p>");
    });
  });

  describe("void elements", () => {
    test("renders self-closing void elements", async () => {
      const img = h("img", { src: "test.png", alt: "Test" }, []);
      const result = await runTest(renderToString(img));
      expect(result.html).toBe('<img src="test.png" alt="Test" />');
    });

    test("renders br as self-closing", async () => {
      const br = h("br", {}, []);
      const result = await runTest(renderToString(br));
      expect(result.html).toBe("<br />");
    });

    test("renders input as self-closing", async () => {
      const input = h("input", { type: "text", name: "test" }, []);
      const result = await runTest(renderToString(input));
      expect(result.html).toBe('<input type="text" name="test" />');
    });
  });

  describe("fragments", () => {
    test("renders fragment children directly", async () => {
      const element = h(Fragment, {}, [h("span", {}, ["A"]), h("span", {}, ["B"])]);
      const result = await runTest(renderToString(element));
      expect(result.html).toBe("<span>A</span><span>B</span>");
    });
  });
});

// =============================================================================
// Components
// =============================================================================

describe("components", () => {
  test("renders function components", async () => {
    const Greeting = ({ name }: { name: string }) => h("p", {}, [`Hello, ${name}!`]);
    const element = h(Greeting, { name: "World" }, []);
    const result = await runTest(renderToString(element));
    expect(result.html).toBe("<p>Hello, World!</p>");
  });

  test("renders nested components", async () => {
    const Inner = () => h("span", {}, ["Inner"]);
    const Outer = () => h("div", {}, [h(Inner, {}, [])]);
    const element = h(Outer, {}, []);
    const result = await runTest(renderToString(element));
    expect(result.html).toBe("<div><span>Inner</span></div>");
  });

  test("passes children to components", async () => {
    const Wrapper = ({ children }: { children?: VElement[] }) =>
      h("div", { className: "wrapper" }, children ?? []);
    const element = h(Wrapper, {}, [h("p", {}, ["Child content"])]);
    const result = await runTest(renderToString(element));
    expect(result.html).toBe('<div class="wrapper"><p>Child content</p></div>');
  });

  test("renders Effect-returning components", async () => {
    const AsyncComponent = () => Effect.succeed(h("p", {}, ["Loaded"]));
    const element = h(AsyncComponent, {}, []);
    const result = await runTest(renderToString(element));
    expect(result.html).toBe("<p>Loaded</p>");
  });

  test("renders Stream-returning components (first emission)", async () => {
    const StreamComponent = () => Stream.make(h("p", {}, ["First"]), h("p", {}, ["Second"]));
    const element = h(StreamComponent, {}, []);
    const result = await runTest(renderToString(element));
    expect(result.html).toBe("<p>First</p>");
  });

  test("renders empty string for empty Stream", async () => {
    const EmptyStream = () => Stream.empty;
    const element = h(EmptyStream, {}, []);
    const result = await runTest(renderToString(element));
    expect(result.html).toBe("");
  });
});

// =============================================================================
// Suspense
// =============================================================================

describe("Suspense", () => {
  test("renders children (not fallback) on server", async () => {
    const element = h("SUSPENSE" as any, { fallback: h("p", {}, ["Loading..."]) }, [
      h("div", {}, ["Content"]),
    ]);
    const result = await runTest(renderToString(element));
    expect(result.html).toBe("<div>Content</div>");
  });
});

// =============================================================================
// State Serialization
// =============================================================================

describe("state serialization", () => {
  test("returns dehydrated state array", async () => {
    const element = h("div", {}, ["Test"]);
    const result = await runTest(renderToString(element));
    expect(Array.isArray(result.dehydratedState)).toBe(true);
  });

  test("includes serializable atoms in dehydrated state", async () => {
    // Create a serializable atom
    const countAtom = Atom.make(42).pipe(
      Atom.serializable({
        key: "test-count",
        schema: Schema.Number,
      }),
    );

    const Counter = () =>
      Effect.gen(function* () {
        const registry = yield* AtomRegistry.AtomRegistry;
        const count = registry.get(countAtom);
        return h("p", {}, [`Count: ${count}`]);
      });

    const element = h(Counter, {}, []);
    const result = await runTest(renderToString(element));

    expect(result.html).toBe("<p>Count: 42</p>");
    // The atom should be in the dehydrated state
    const found = result.dehydratedState.find((a) => a.key === "test-count");
    expect(found).toBeDefined();
    expect(found?.value).toBe(42);
  });
});
