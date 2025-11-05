import { describe, test, expect } from "bun:test";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import { h } from "./jsx-runtime/index.js";
import {
  renderToString,
  renderToStringWithBridge,
  injectBridgeManifest,
  Bridge,
  BridgeLayer,
} from "./server.js";

// Helper to run Effect in tests without triggering linter
const runTest = <A>(effect: Effect.Effect<A>): Promise<A> =>
  Effect.runPromiseExit(effect).then(exit => {
    if (exit._tag === "Success") return exit.value;
    throw exit.cause;
  });

describe("renderToString", () => {
  test("renders simple text", async () => {
    const element = h("div", {}, ["Hello, World!"]);
    const html = await runTest(renderToString(element));

    expect(html).toContain("<div");
    expect(html).toContain("Hello, World!");
    expect(html).toContain("</div>");
  });

  test("renders nested elements", async () => {
    const element = h("div", {}, [
      h("h1", {}, ["Title"]),
      h("p", {}, ["Paragraph"])
    ]);
    const html = await runTest(renderToString(element));

    expect(html).toContain("<div");
    expect(html).toContain("<h1");
    expect(html).toContain("Title");
    expect(html).toContain("</h1>");
    expect(html).toContain("<p");
    expect(html).toContain("Paragraph");
    expect(html).toContain("</p>");
    expect(html).toContain("</div>");
  });

  test("renders attributes", async () => {
    const element = h("div", {
      id: "test-id",
      className: "container active",
      "data-value": "123"
    }, ["Content"]);
    const html = await runTest(renderToString(element));

    expect(html).toContain('id="test-id"');
    expect(html).toContain('class="container active"');
    expect(html).toContain('data-value="123"');
  });

  test("escapes HTML in text", async () => {
    const element = h("div", {}, ["<script>alert('xss')</script>"]);
    const html = await runTest(renderToString(element));

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  test("escapes HTML in attributes", async () => {
    const element = h("div", {
      title: '<script>alert("xss")</script>'
    }, []);
    const html = await runTest(renderToString(element));

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;');
    expect(html).toContain('&gt;');
  });

  test("renders self-closing tags", async () => {
    const element = h("div", {}, [
      h("img", { src: "/test.png", alt: "Test" }),
      h("br", {}),
      h("input", { type: "text", value: "test" })
    ]);
    const html = await runTest(renderToString(element));

    expect(html).toContain('src="/test.png"');
    expect(html).toContain('alt="Test"');
    expect(html).toContain('<br');
    expect(html).toContain('<input');
    expect(html).toContain('type="text"');
  });

  test("renders component functions", async () => {
    const MyComponent = (props: { name: string }) => {
      return h("div", {}, [`Hello, ${props.name}!`]);
    };

    const element = h(MyComponent, { name: "World" });
    const html = await runTest(renderToString(element));

    expect(html).toContain("<div");
    expect(html).toContain("Hello, World!");
    expect(html).toContain("</div>");
  });

  test("renders Effect-returning components", async () => {
    const AsyncComponent = () => {
      return Effect.succeed(
        h("div", {}, ["Async content"])
      );
    };

    const element = h(AsyncComponent, {});
    const html = await runTest(renderToString(element));

    expect(html).toContain("<div");
    expect(html).toContain("Async content");
    expect(html).toContain("</div>");
  });

  test("handles boolean attributes", async () => {
    const element = h("input", {
      type: "checkbox",
      checked: true,
      disabled: false
    });
    const html = await runTest(renderToString(element));

    expect(html).toContain('checked');
    expect(html).not.toContain('disabled');
  });

  test("renders className as class", async () => {
    const element = h("div", { className: "test-class" }, []);
    const html = await runTest(renderToString(element));

    expect(html).toContain('class="test-class"');
    expect(html).not.toContain('className');
  });

  test("skips event handlers", async () => {
    const noop = () => { /* intentionally empty for test */ };
    const element = h("button", {
      onClick: noop,
      onMouseOver: noop
    }, ["Click me"]);
    const html = await runTest(renderToString(element));

    expect(html).not.toContain('onClick');
    expect(html).not.toContain('onMouseOver');
    expect(html).toContain("Click me");
  });

  test("renders fragments", async () => {
    const element = h("FRAGMENT", {}, [
      h("div", {}, ["First"]),
      h("div", {}, ["Second"])
    ]);
    const html = await runTest(renderToString(element));

    expect(html).not.toContain("FRAGMENT");
    expect(html).toContain("First");
    expect(html).toContain("Second");
  });

  test("renders style objects", async () => {
    const element = h("div", {
      style: {
        color: "red",
        fontSize: "16px",
        backgroundColor: "blue"
      }
    }, ["Styled"]);
    const html = await runTest(renderToString(element));

    expect(html).toContain('style=');
    expect(html).toContain('color:red');
    expect(html).toContain('font-size:16px');
    expect(html).toContain('background-color:blue');
  });

  test("adds deterministic path IDs to elements", async () => {
    const element = h("div", {}, [
      h("h1", {}, ["Title"]),
      h("ul", {}, [
        h("li", {}, ["Item 1"]),
        h("li", {}, ["Item 2"])
      ])
    ]);
    const html = await runTest(renderToString(element));

    // Root div should have empty path
    expect(html).toContain('data-dx=""');
    // First child (h1) should have p:0
    expect(html).toContain('data-dx="p:0"');
    // Second child (ul) should have p:1
    expect(html).toContain('data-dx="p:1"');
    // ul's children should have p:1.0 and p:1.1
    expect(html).toContain('data-dx="p:1.0"');
    expect(html).toContain('data-dx="p:1.1"');
  });

  test("adds path IDs to text nodes", async () => {
    const element = h("div", {}, ["Hello"]);
    const html = await runTest(renderToString(element));

    // Text nodes should have data-dx-t with path (child 0 of root)
    expect(html).toContain('data-dx-t="p:0"');
    expect(html).toContain('Hello');
  });

  test("adds key attributes for keyed list items", async () => {
    const element = h("ul", {}, [
      h("li", { key: "item-1" }, ["First"]),
      h("li", { key: "item-2" }, ["Second"]),
      h("li", { key: "item-3" }, ["Third"])
    ]);
    const html = await runTest(renderToString(element));

    // List items should have data-dx-k with their keys
    expect(html).toContain('data-dx-k="item-1"');
    expect(html).toContain('data-dx-k="item-2"');
    expect(html).toContain('data-dx-k="item-3"');
    // And still have path IDs
    expect(html).toContain('data-dx="p:0"');
    expect(html).toContain('data-dx="p:1"');
    expect(html).toContain('data-dx="p:2"');
  });

  test("filters non-serializable attributes in SSR", async () => {
    const noop = () => { /* test handler */ };
    const obj = { foo: "bar" };
    const element = h("div", {
      id: "test",
      onClick: noop,
      onMouseOver: noop,
      customHandler: noop,
      dataObject: obj,
      validAttr: "value"
    }, ["Content"]);
    const html = await runTest(renderToString(element));

    // Should include serializable attributes
    expect(html).toContain('id="test"');
    expect(html).toContain('validAttr="value"');

    // Should NOT include functions
    expect(html).not.toContain('onClick');
    expect(html).not.toContain('onMouseOver');
    expect(html).not.toContain('customHandler');

    // Should NOT include objects (except style/class which have special handling)
    expect(html).not.toContain('dataObject');
  });
});

// ============================================================================
// Bridge Service Tests
// ============================================================================

describe("Bridge Service", () => {
  test("bridge.promise creates a BridgePromise with unique ID", async () => {
    const program = Effect.gen(function*() {
      const bridge = yield* Bridge;

      const bridgePromise = yield* bridge.promise(
        Effect.succeed({ data: "test" })
      );

      expect(bridgePromise.id).toMatch(/^br_p_[a-z0-9]+$/);
      expect(bridgePromise.status).toBe("pending");
      expect(bridgePromise.effect).toBeDefined();
    });

    await runTest(program.pipe(Effect.provide(BridgeLayer)));
  });

  test("bridge.promise resolves Effect and stores value", async () => {
    const program = Effect.gen(function*() {
      const bridge = yield* Bridge;

      const bridgePromise = yield* bridge.promise(
        Effect.succeed({ result: 42 })
      );

      // Wait for the effect to resolve
      yield* Effect.sleep(50);

      const result = yield* bridgePromise.effect;
      expect(result).toEqual({ result: 42 });
    });

    await runTest(program.pipe(Effect.provide(BridgeLayer)));
  });

  test("bridge.promise handles failing Effects", async () => {
    const program = Effect.gen(function*() {
      const bridge = yield* Bridge;

      const bridgePromise = yield* bridge.promise(
        Effect.fail(new Error("test error"))
      );

      // Wait for the effect to fail
      yield* Effect.sleep(50);

      const result = yield* Effect.either(bridgePromise.effect);
      expect(result._tag).toBe("Left");
    });

    await runTest(program.pipe(Effect.provide(BridgeLayer)));
  });

  test("bridge.stream creates a BridgeStream with unique ID", async () => {
    const program = Effect.gen(function*() {
      const bridge = yield* Bridge;

      const bridgeStream = yield* bridge.stream(
        Stream.make(1, 2, 3)
      );

      expect(bridgeStream.id).toMatch(/^br_s_[a-z0-9]+$/);
      expect(bridgeStream.stream).toBeDefined();
    });

    await runTest(program.pipe(Effect.provide(BridgeLayer)));
  });

  test("bridge.stream drains source stream into queue", async () => {
    const program = Effect.gen(function*() {
      const bridge = yield* Bridge;

      const bridgeStream = yield* bridge.stream(
        Stream.make(1, 2, 3)
      );

      // Collect values from bridge stream
      const values = yield* Stream.runCollect(
        bridgeStream.stream.pipe(Stream.take(3))
      );

      expect(Array.from(values)).toEqual([1, 2, 3]);
    });

    await runTest(program.pipe(Effect.provide(BridgeLayer)));
  });

  test("bridge.stream works with infinite streams", async () => {
    const program = Effect.gen(function*() {
      const bridge = yield* Bridge;

      // Create an infinite counter stream
      const bridgeStream = yield* bridge.stream(
        Stream.iterate(0, n => n + 1).pipe(
          Stream.schedule(Schedule.spaced("10 millis"))
        )
      );

      // Take only first 3 values
      const values = yield* Stream.runCollect(
        bridgeStream.stream.pipe(Stream.take(3))
      );

      expect(Array.from(values)).toEqual([0, 1, 2]);
    });

    await runTest(program.pipe(Effect.provide(BridgeLayer)));
  });

  test("renderManifest generates JSON for empty registry", async () => {
    const program = Effect.gen(function*() {
      const bridge = yield* Bridge;

      const manifest = yield* bridge.renderManifest();
      const parsed = JSON.parse(manifest);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(0);
    });

    await runTest(program.pipe(Effect.provide(BridgeLayer)));
  });

  test("renderManifest includes registered promises", async () => {
    const program = Effect.gen(function*() {
      const bridge = yield* Bridge;

      const bridgePromise = yield* bridge.promise(
        Effect.succeed({ data: "test" })
      );

      // Wait for promise to resolve
      yield* Effect.sleep(50);

      const manifest = yield* bridge.renderManifest();
      const parsed = JSON.parse(manifest);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(1);
      expect(parsed[0]).toMatchObject({
        kind: "promise",
        id: bridgePromise.id,
        status: "resolved",
        value: { data: "test" },
      });
    });

    await runTest(program.pipe(Effect.provide(BridgeLayer)));
  });

  test("renderManifest includes registered streams", async () => {
    const program = Effect.gen(function*() {
      const bridge = yield* Bridge;

      const bridgeStream = yield* bridge.stream(
        Stream.make(1, 2, 3)
      );

      // Wait for first value to be captured
      yield* Effect.sleep(50);

      const manifest = yield* bridge.renderManifest();
      const parsed = JSON.parse(manifest);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(1);
      expect(parsed[0]).toMatchObject({
        kind: "stream",
        id: bridgeStream.id,
        initial: 1,
      });
    });

    await runTest(program.pipe(Effect.provide(BridgeLayer)));
  });

  test("renderManifest includes both promises and streams", async () => {
    const program = Effect.gen(function*() {
      const bridge = yield* Bridge;

      const bridgePromise = yield* bridge.promise(
        Effect.succeed({ data: "promise-data" })
      );

      const bridgeStream = yield* bridge.stream(
        Stream.make("a", "b", "c")
      );

      // Wait for effects to settle
      yield* Effect.sleep(50);

      const manifest = yield* bridge.renderManifest();
      const parsed = JSON.parse(manifest);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(2);

      const promiseEntry = parsed.find((e: any) => e.kind === "promise");
      const streamEntry = parsed.find((e: any) => e.kind === "stream");

      expect(promiseEntry).toMatchObject({
        kind: "promise",
        id: bridgePromise.id,
        status: "resolved",
      });

      expect(streamEntry).toMatchObject({
        kind: "stream",
        id: bridgeStream.id,
        initial: "a",
      });
    });

    await runTest(program.pipe(Effect.provide(BridgeLayer)));
  });

  test("bridge cleanup on scope close", async () => {
    const program = Effect.gen(function*() {
      // Create a scoped context
      const result = yield* Effect.scoped(
        Effect.gen(function*() {
          const bridge = yield* Bridge;

          yield* bridge.promise(Effect.succeed({ data: "test" }));
          yield* bridge.stream(Stream.make(1, 2, 3));

          const manifest = yield* bridge.renderManifest();
          const parsed = JSON.parse(manifest);

          // Should have 2 entries while scope is open
          return parsed.length;
        }).pipe(Effect.provide(BridgeLayer))
      );

      expect(result).toBe(2);
      // Scope is closed here, entries should be cleaned up
      // (We can't directly test this without accessing internals)
    });

    await runTest(program);
  });
});

// ============================================================================
// Phase 3: SSR Integration with Bridge Tests
// ============================================================================

describe("SSR with Bridge Integration", () => {
  test("renderToStringWithBridge with resolved promise", async () => {
    const program = Effect.gen(function*() {
      // Component that uses bridge.promise and returns the BridgePromise
      const DataComponent = () =>
        Effect.gen(function*() {
          const bridge = yield* Bridge;
          // Return a BridgePromise whose effect renders the element
          return yield* bridge.promise(
            Effect.succeed(
              h("div", { class: "data" }, ["Hello from bridge!"])
            )
          );
        });

      const App = h(DataComponent, {}, []);

      // Render with bridge
      const result = yield* renderToStringWithBridge(App);

      // Verify HTML contains data-dx-bridge attribute
      expect(result.html).toContain('data-dx-bridge="br_p_');
      expect(result.html).toContain("Hello from bridge!");

      // Verify manifest contains promise entry
      const manifest = JSON.parse(result.manifest);
      expect(Array.isArray(manifest)).toBe(true);
      expect(manifest.length).toBe(1);
      expect(manifest[0]).toMatchObject({
        kind: "promise",
        status: "resolved",
      });
      // We no longer assert on manifest[0].value shape since the effect returns a VElement
    });

    await runTest(program.pipe(Effect.provide(BridgeLayer)));
  });

  test("renderToStringWithBridge with pending promise", async () => {
    const program = Effect.gen(function*() {
      // Component that uses bridge.promise with delay and returns the BridgePromise
      const AsyncComponent = () =>
        Effect.gen(function*() {
          const bridge = yield* Bridge;
          return yield* bridge.promise(
            Effect.gen(function*() {
              yield* Effect.sleep("10 millis");
              return h("p", {}, ["async data"]);
            })
          );
        });

      const App = h(AsyncComponent, {}, []);

      // Render with bridge
      const result = yield* renderToStringWithBridge(App);

      // Verify HTML contains data-dx-bridge attribute
      expect(result.html).toContain('data-dx-bridge="br_p_');
      expect(result.html).toContain("async data");

      // Verify manifest contains resolved promise
      const manifest = JSON.parse(result.manifest);
      expect(manifest[0]).toMatchObject({
        kind: "promise",
        status: "resolved",
      });
    });

    await runTest(program.pipe(Effect.provide(BridgeLayer)));
  });

  test("renderToStringWithBridge with stream", async () => {
    const program = Effect.gen(function*() {
      // Component that uses bridge.stream and returns the BridgeStream
      const StreamComponent = () =>
        Effect.gen(function*() {
          const bridge = yield* Bridge;
          return yield* bridge.stream(
            Stream.make(
              h("span", {}, ["first"]),
              h("span", {}, ["second"]),
              h("span", {}, ["third"])
            )
          );
        });

      const App = h(StreamComponent, {}, []);

      // Render with bridge
      const result = yield* renderToStringWithBridge(App);

      // Verify HTML contains data-dx-bridge attribute
      expect(result.html).toContain('data-dx-bridge="br_s_');
      expect(result.html).toContain("first");

      // Verify manifest contains stream entry with initial value
      const manifest = JSON.parse(result.manifest);
      expect(manifest[0]).toMatchObject({
        kind: "stream",
        initial: expect.anything(),
      });
    });

    await runTest(program.pipe(Effect.provide(BridgeLayer)));
  });

  test("injectBridgeManifest creates script tag", () => {
    const manifest = '[{"kind":"promise","id":"br_p_123"}]';
    const scriptTag = injectBridgeManifest(manifest);

    expect(scriptTag).toBe(
      '<script id="__DX_BRIDGE" type="application/json">[{"kind":"promise","id":"br_p_123"}]</script>'
    );
  });

  test("renderToStringWithBridge with multiple bridge components", async () => {
    const program = Effect.gen(function*() {
      const PromiseComponent = () =>
        Effect.gen(function*() {
          const bridge = yield* Bridge;
          return yield* bridge.promise(
            Effect.succeed(h("div", {}, ["promise"]))
          );
        });

      const StreamComponent = () =>
        Effect.gen(function*() {
          const bridge = yield* Bridge;
          return yield* bridge.stream(
            Stream.make(h("div", {}, ["stream"]))
          );
        });

      const App = h("div", {}, [
        h(PromiseComponent, {}, []),
        h(StreamComponent, {}, []),
      ]);

      const result = yield* renderToStringWithBridge(App);

      // Verify both bridge IDs in HTML
      const promiseMatch = result.html.match(/data-dx-bridge=\"(br_p_[^\"]+)\"/);
      const streamMatch = result.html.match(/data-dx-bridge=\"(br_s_[^\"]+)\"/);
      expect(promiseMatch).toBeTruthy();
      expect(streamMatch).toBeTruthy();

      // Verify manifest has both entries
      const manifest = JSON.parse(result.manifest);
      expect(manifest.length).toBe(2);

      const promiseEntry = manifest.find((e: any) => e.kind === "promise");
      const streamEntry = manifest.find((e: any) => e.kind === "stream");

      expect(promiseEntry).toBeTruthy();
      expect(streamEntry).toBeTruthy();
    });

    await runTest(program.pipe(Effect.provide(BridgeLayer)));
  });

});
