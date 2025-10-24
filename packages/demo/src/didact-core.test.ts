import { Effect, Ref, Option } from "effect";
import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { h, Atom, DidactRuntime } from "@didact/core";
import type { Fiber, VElement } from "@didact/core";
import { AtomRegistry } from "@didact/core";

const withDidactRuntime = <A, E, R = never>(eff: Effect.Effect<A, E, R | DidactRuntime>) =>
  eff.pipe(
    Effect.provide(AtomRegistry.layer),
    Effect.provide(DidactRuntime.Live)
  );

describe("Didact Core Logic", () => {
  describe("h() helper", () => {
    it.effect("should create VElement with string type", () =>
      Effect.gen(function* () {
        const element = h("div", { id: "test" }, ["hello"]);
        
        expect(element.type).toBe("div");
        expect(element.props.id).toBe("test");
        expect(element.props.children).toHaveLength(1);
      })
    );

    it.effect("should create nested VElements", () =>
      Effect.gen(function* () {
        const element = h("div", {}, [
          h("span", {}, ["child 1"]),
          h("span", {}, ["child 2"]),
        ]);
        
        expect(element.props.children).toHaveLength(2);
        const children = element.props.children as VElement[];
        expect(children[0].type).toBe("span");
        expect(children[1].type).toBe("span");
      })
    );

    it.effect("should convert string children to TEXT_ELEMENT", () =>
      Effect.gen(function* () {
        const element = h("div", {}, ["hello"]);
        
        const children = element.props.children as VElement[];
        expect(children[0].type).toBe("TEXT_ELEMENT");
        expect(children[0].props.nodeValue).toBe("hello");
      })
    );

    it.effect("should handle component functions", () =>
      Effect.gen(function* () {
        const MyComponent = (props: { name: string }) =>
          Effect.succeed(h("div", {}, [props.name]));
        
        const element = h(MyComponent, { name: "test" }, []);
        
        expect(typeof element.type).toBe("function");
        expect(element.props.name).toBe("test");
      })
    );
  });

  describe("Atom integration", () => {
    it.effect("should create and read atom", () =>
      withDidactRuntime(
        Effect.gen(function* () {
          const count = Atom.make(0);
          const value = yield* Atom.get(count);
          
          expect(value).toBe(0);
        })
      )
    );

    it.effect("should update atom value", () =>
      withDidactRuntime(
        Effect.gen(function* () {
          const count = Atom.make(0);
          yield* Atom.update(count, (n) => n + 1);
          const value = yield* Atom.get(count);
          
          expect(value).toBe(1);
        })
      )
    );

    it.effect("should set atom value", () =>
      withDidactRuntime(
        Effect.gen(function* () {
          const count = Atom.make(0);
          yield* Atom.set(count, 42);
          const value = yield* Atom.get(count);
          
          expect(value).toBe(42);
        })
      )
    );
  });

  describe("Component execution", () => {
    it.effect("should execute Effect component", () =>
      Effect.gen(function* () {
        const TestComponent = () =>
          Effect.gen(function* () {
            return h("div", { "data-test": "output" }, ["Hello"]);
          });
        
        const component = TestComponent();
        const result = yield* component;
        
        expect(result.type).toBe("div");
        expect(result.props["data-test"]).toBe("output");
      })
    );

    it.effect("should execute component with Atom reads", () =>
      withDidactRuntime(
        Effect.gen(function* () {
          const count = Atom.make(5);
          
          const Counter = () =>
            Effect.gen(function* () {
              const value = yield* Atom.get(count);
              return h("div", {}, [`Count: ${value}`]);
            });
          
          const component = Counter();
          const result = yield* component;
          
          const children = result.props.children as VElement[];
          expect(children[0].props.nodeValue).toBe("Count: 5");
        })
      )
    );
  });

  describe("VElement structure", () => {
    it.effect("should handle empty children array", () =>
      Effect.gen(function* () {
        const element = h("div", {}, []);
        
        expect(element.props.children).toEqual([]);
      })
    );

    it.effect("should handle mixed children types", () =>
      Effect.gen(function* () {
        const element = h("div", {}, [
          "text",
          h("span", {}, []),
          "more text",
        ]);
        
        const children = element.props.children as VElement[];
        expect(children).toHaveLength(3);
        expect(children[0].type).toBe("TEXT_ELEMENT");
        expect(children[1].type).toBe("span");
        expect(children[2].type).toBe("TEXT_ELEMENT");
      })
    );

    it.effect("should preserve props other than children", () =>
      Effect.gen(function* () {
        const element = h("input", {
          type: "text",
          value: "test",
          placeholder: "Enter text",
        }, []);
        
        expect(element.props.type).toBe("text");
        expect(element.props.value).toBe("test");
        expect(element.props.placeholder).toBe("Enter text");
        expect(element.props.children).toEqual([]);
      })
    );
  });

  describe("Effect component patterns", () => {
    it.effect("should handle component with multiple atom reads", () =>
      withDidactRuntime(
        Effect.gen(function* () {
          const firstName = Atom.make("John");
          const lastName = Atom.make("Doe");
          
          const FullName = () =>
            Effect.gen(function* () {
              const first = yield* Atom.get(firstName);
              const last = yield* Atom.get(lastName);
              return h("div", {}, [`${first} ${last}`]);
            });
          
          const component = FullName();
          const result = yield* component;
          
          const children = result.props.children as VElement[];
          expect(children[0].props.nodeValue).toBe("John Doe");
        })
      )
    );

    it.effect("should handle nested component composition", () =>
      Effect.gen(function* () {
        const Child = () =>
          Effect.succeed(h("span", {}, ["child content"]));
        
        const Parent = () =>
          Effect.succeed(h("div", {}, [h(Child, {}, [])]));
        
        const result = yield* Parent();
        
        const children = result.props.children as VElement[];
        expect(typeof children[0].type).toBe("function");
      })
    );
  });

  describe("Event handler structure", () => {
    it.effect("should preserve onClick handlers", () =>
      withDidactRuntime(
        Effect.gen(function* () {
          const handler = () => Effect.succeed(undefined);
          const element = h("button", { onClick: handler }, ["Click me"]);
          
          expect(element.props.onClick).toBe(handler);
        })
      )
    );

    it.effect("should handle multiple event handlers", () =>
      withDidactRuntime(
        Effect.gen(function* () {
          const onClick = () => Effect.succeed(undefined);
          const onMouseOver = () => Effect.succeed(undefined);
          
          const element = h("button", { onClick, onMouseOver }, []);
          
          expect(element.props.onClick).toBe(onClick);
          expect(element.props.onMouseOver).toBe(onMouseOver);
        })
      )
    );
  });
});
