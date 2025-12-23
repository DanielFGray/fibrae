import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import { pipe } from "effect/Function";
import { h, Atom, AtomRegistry, Suspense, type VNode } from "@didact/core";

// Effect pattern: define atoms at module level using Atom.family for parameterized state
const counterAtom = Atom.family((label: string) => Atom.make(0));
const todoItemCompletedAtom = Atom.family((text: string) => Atom.make(false));
const todoItemTestCountAtom = Atom.family((text: string) => Atom.make(0));
const todosAtom = Atom.make<string[]>([]);

export const Counter = ({ label }: { label: string }) => {
  return Effect.gen(function*() {
    const registry = yield* AtomRegistry.AtomRegistry;
    const count = counterAtom(label); // Get cached atom for this label
    const value = registry.get(count);

    return <div
      data-cy={label.toLowerCase().replace(" ", "-")}
      style="padding: 1rem; border: 2px solid #666; border-radius: 8px; margin: 1rem 0;"
    >
      <h3>{label} </h3>
      <p data-cy="counter-value">Count: {value}</p>
      <div style="display: flex; gap: 0.5rem;" >
        <button data-cy="counter-increment" onClick={() => registry.update(count, (n: number) => n + 1)}>
          +
        </button>
        <button
          data-cy="counter-decrement"
          onClick={() => registry.update(count, (n: number) => n - 1)}
        >
          -
        </button>
        <button data-cy="counter-reset" onClick={() => registry.set(count, 0)}>
          Reset
        </button>
      </div>
    </div>
  });
};

// Component that returns a stream with multiple emissions
// Suspense will handle the "Loading..." fallback
export const StreamCounter = () => pipe(
  Stream.fromIterable([
    <div
      data-cy="stream-counter"
      style="padding: 1rem; border: 2px solid #ff6600; border-radius: 8px; margin: 1rem 0;"
    >
      <h3>Stream Counter</h3>
      <p data-cy="stream-status">Ready: 3</p>
    </div>,
    <div
      data-cy="stream-counter"
      style="padding: 1rem; border: 2px solid #ff6600; border-radius: 8px; margin: 1rem 0;"
    >
      <h3>Stream Counter</h3>
      <p data-cy="stream-status">Ready: 2</p>
    </div>,
    <div
      data-cy="stream-counter"
      style="padding: 1rem; border: 2px solid #ff6600; border-radius: 8px; margin: 1rem 0;"
    >
      <h3>Stream Counter</h3>
      <p data-cy="stream-status">Ready: 1</p>
    </div>,
    <div
      data-cy="stream-counter"
      style="padding: 1rem; border: 2px solid #00ff00; border-radius: 8px; margin: 1rem 0;"
    >
      <h3>Stream Counter</h3>
      <p data-cy="stream-status">Complete!</p>
    </div>
  ]),
  Stream.schedule(Schedule.spaced("500 millis")),
  Stream.tap(() => Effect.log("[StreamCounter] Stream emission!"))
);

export const TodoItem = ({
  text,
  onRemove,
}: {
  text: string;
  onRemove: (text: string) => void;
}) => {
  return Effect.gen(function*() {
    const registry = yield* AtomRegistry.AtomRegistry;
    const completed = todoItemCompletedAtom(text);
    const testCount = todoItemTestCountAtom(text);
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
            onChange: () => registry.update(completed, (v: boolean) => !v),
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
            onClick: () => registry.update(testCount, (n: number) => n + 1),
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

export const TodoList = () => {
  return Effect.gen(function*() {
    const registry = yield* AtomRegistry.AtomRegistry;

    const addTodo = (currentInput: string) => {
      return Effect.sync(() => registry.update(todosAtom, (list: string[]) => list.concat(currentInput)));
    };

    const removeTodo = (todoToRemove: string) => {
      return Effect.sync(() => registry.update(todosAtom, (list: string[]) => list.filter((todo: string) => todo !== todoToRemove)));
    };

    const todoList = yield* Atom.get(todosAtom);

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

const Subtitle = ({ children }: { children: VNode | string }) => (
  <p data-cy="app-subtitle" style="text-align: center; color: #666;">
    {children}
  </p>
);

export const StaticHeader = () => (
  <div style="max-width: 800px; margin: 2rem auto; font-family: system-ui;">
    <h1 data-cy="app-title" style="text-align: center;">
      🚀 Didact Effect Demo
    </h1>
    <Subtitle>Effect-first reactive JSX with @effect/platform-browser integration</Subtitle>
    <p style="text-align: center;">
      <a href="/examples.html" style="color: #4a9eff;">View Examples Page →</a>
    </p>
  </div>
);

export const StreamCounterFallback = () => <div
  data-cy="stream-counter"
  style="padding: 1rem; border: 2px solid #999; border-radius: 8px; margin: 1rem 0;"
>
  <h3>Stream Counter</h3>
  <p data-cy="stream-status">Loading...</p>
</div>

// Composite App component for SSR/shared rendering
export const App = () => <>
  <StaticHeader />
  <Suspense fallback={<StreamCounterFallback />}>
    <StreamCounter />
  </Suspense>
  <div>
    <Counter label="Counter A" />
    <Counter label="Counter B" />
  </div>
  <TodoList />
</>
