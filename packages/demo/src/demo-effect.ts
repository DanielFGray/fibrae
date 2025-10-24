import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { pipe } from "effect/Function";
import * as BrowserPlatform from "@effect/platform-browser";
import { render, h, Atom, AtomRegistry } from "@didact/core";
import { ViteDevServerDebugger } from "./tracing.js";

const Counter = ({ label }: { label: string }) => {
  const count = Atom.make(0);
  return Effect.gen(function*() {
    const value = yield* Atom.get(count);

    return h(
      "div",
      {
        "data-cy": label === "Counter A" ? "counter-a" : "counter-b",
        style:
          "padding: 1rem; border: 2px solid #666; border-radius: 8px; margin: 1rem 0;",
      },
      [
        h("h3", {}, [label]),
        h("p", { "data-cy": "counter-value" }, [`Count: ${value}`]),
        h("div", { style: "display: flex; gap: 0.5rem;" }, [
          h(
            "button",
            {
              "data-cy": "counter-increment",
              onClick: () => Effect.gen(function*() {
                const registry = yield* AtomRegistry.AtomRegistry;
                registry.update(count, (n: number) => n + 1);
              }),
            },
            ["+"],
          ),
          h(
            "button",
            {
              "data-cy": "counter-decrement",
              onClick: () => Effect.gen(function*() {
                const registry = yield* AtomRegistry.AtomRegistry;
                registry.update(count, (n: number) => n - 1);
              }),
            },
            ["-"],
          ),
          h(
            "button",
            {
              "data-cy": "counter-reset",
              onClick: () => Effect.gen(function*() {
                const registry = yield* AtomRegistry.AtomRegistry;
                registry.set(count, 0);
              }),
            },
            ["Reset"],
          ),
        ]),
      ],
    );
  });
};

const TodoItem = ({
  text,
  onRemove,
}: {
  text: string;
  onRemove: (text: string) => Effect.Effect<void, never, AtomRegistry.AtomRegistry>;
}) => {
  const completed = Atom.make(false);
  const testCount = Atom.make(0);
  return Effect.gen(function*() {
    const isCompleted = yield* Atom.get(completed);
    const testValue = yield* Atom.get(testCount);

    return h(
      "li",
      {
        "data-cy": "todo-item",
        style:
          "display: flex; gap: 0.5rem; align-items: center; padding: 0.5rem 0;",
      },
      [
        h(
          "input",
          {
            "data-cy": "todo-checkbox",
            type: "checkbox",
            checked: isCompleted,
            onChange: () => Effect.gen(function*() {
              const registry = yield* AtomRegistry.AtomRegistry;
              registry.update(completed, (v: boolean) => !v);
            }),
          },
          [],
        ),
        h(
          "span",
          {
            "data-cy": "todo-text",
            style: isCompleted
              ? "text-decoration: line-through; color: #999;"
              : "",
          },
          [text],
        ),
        h(
          "button",
          {
            "data-cy": "todo-test-button",
            type: "button",
            onClick: () => Effect.gen(function*() {
              const registry = yield* AtomRegistry.AtomRegistry;
              registry.update(testCount, (n: number) => n + 1);
            }),
            style: "margin-left: 0.5rem; background: orange;",
          },
          [`Test: ${testValue}`],
        ),
        h(
          "button",
          {
            "data-cy": "todo-remove",
            type: "button",
            onClick: () => onRemove(text),
            style: "margin-left: auto;",
          },
          ["Remove"],
        ),
      ],
    );
  });
};

const TodoList = () => {
  const todos = Atom.make<string[]>([]);

  const addTodo = (currentInput: string) => Effect.gen(function*() {
    const registry = yield* AtomRegistry.AtomRegistry;
    registry.update(todos, (list: string[]) => list.concat(currentInput));
  });

  const removeTodo = (todoToRemove: string) => Effect.gen(function*() {
    const registry = yield* AtomRegistry.AtomRegistry;
    registry.update(todos, (list: string[]) =>
      list.filter((todo: string) => todo !== todoToRemove),
    );
  });

  return Effect.gen(function*() {
    const todoList = yield* Atom.get(todos);

    return h(
      "form",
      {
        "data-cy": "todo-list",
        style: "padding: 1rem; border: 2px solid #44aa44; border-radius: 8px; margin: 1rem 0;",
        onSubmit: (e: Event) => {
          e.preventDefault();
          const form = e.currentTarget as HTMLFormElement;
          return pipe(
            new FormData(form),
            Object.fromEntries,
            Schema.decodeUnknown(Schema.Struct({ todoInput: Schema.String })),
            Effect.flatMap((parsed) => addTodo(parsed.todoInput)),
            Effect.tap(() => Effect.sync(() => form.reset()))
          )
        }
      },
      [
        h("h3", {}, ["Effect Todo List"]),
        h(
          "div",
          { style: "display: flex; gap: 0.5rem; margin-bottom: 1rem;" },
          [
            h(
              "input",
              {
                "data-cy": "todo-input",
                type: "text",
                name: "todoInput",
                placeholder: "What needs to be done?",
                style: "flex: 1; padding: 0.5rem;",
              },
              [],
            ),
            h("button", { "data-cy": "todo-add", type: "submit" }, ["Add"]),
          ],
        ),
        h(
          "ul",
          { style: "list-style: none; padding: 0;" },
          todoList.map((todo: string) =>
            h(TodoItem, {
              key: todo,
              text: todo,
              onRemove: removeTodo,
            }, []),
          ),
        ),
      ],
    );
  });
};

const App = () =>
  Effect.gen(function*() {
    return h(
      "div",
      { style: "max-width: 800px; margin: 2rem auto; font-family: system-ui;" },
      [
        h("h1", { "data-cy": "app-title", style: "text-align: center;" }, [
          "🚀 Didact Effect Demo",
        ]),
        h(
          "p",
          {
            "data-cy": "app-subtitle",
            style: "text-align: center; color: #666;",
          },
          ["Effect-first reactive JSX with @effect/platform-browser integration"],
        ),
        h(
          "div",
          { "data-cy": "components-grid", style: "display: grid; gap: 1rem;" },
          [
            h(Counter, { label: "Counter A" }),
            h(Counter, { label: "Counter B" }),
            h(TodoList, {}),
          ],
        ),
      ],
    );
  });

pipe(
  document.getElementById("root"),
  Option.fromNullable,
  Option.getOrThrow,
  render(h(App, {}, [])),
  Effect.catchAllDefect((e) => Effect.log(e)),
  Effect.provide(ViteDevServerDebugger),
  BrowserPlatform.BrowserRuntime.runMain,
);
