## Examples

### Simple Counter
```typescript
import * as Effect from "effect/Effect";
import { Atom } from "@didact/core";

export const Counter = ({ label }: { label: string }) => {
  return Effect.gen(function*() {
    const count = yield* Atom.make(0);
    const value = yield* count.get();

    return (
      <div>
        <h3>{label}</h3>
        <p>Count: {value}</p>
        <button onClick={() => count.update((n: number) => n + 1)}>
          +
        </button>
        <button onClick={() => count.update((n: number) => n - 1)}>
          -
        </button>
        <button onClick={() => count.set(0)}>
          Reset
        </button>
      </div>
    );
  });
};
```

### Stream-Based Components with Suspense
```typescript
import * as Stream from "effect/Stream";
import * as Schedule from "effect/Schedule";
import { pipe } from "effect/Function";
import { h, Suspense } from "@didact/core";

// Components can return Streams for progressive updates
export const StreamCounter = () => {
  const items = [
    <div><p>Ready: 3</p></div>,
    <div><p>Ready: 2</p></div>,
    <div><p>Ready: 1</p></div>,
    <div><p>Complete!</p></div>
  ];
  
  return pipe(
    Stream.fromIterable(items),
    Stream.schedule(Schedule.spaced("500 millis"))
  );
};

// Use Suspense to show fallback while waiting for first emission
export const App = () => (
  <Suspense fallback={<div>Loading...</div>}>
    <StreamCounter />
  </Suspense>
);
```

### Todo List with Child Components
```typescript
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { pipe } from "effect/Function";
import { h, Atom } from "@didact/core";

const TodoItem = ({
  text,
  onRemove,
}: {
  text: string;
  onRemove: (text: string) => void;
}) => {
  return Effect.gen(function*() {
    const completed = yield* Atom.make(false);
    const isCompleted = yield* completed.get();

    return (
      <li>
        <input
          type="checkbox"
          checked={isCompleted}
          onChange={() => completed.update((v: boolean) => !v)}
        />
        <span style={isCompleted ? "text-decoration: line-through" : ""}>
          {text}
        </span>
        <button onClick={() => onRemove(text)}>Remove</button>
      </li>
    );
  });
};

export const TodoList = () => {
  return Effect.gen(function*() {
    const todos = yield* Atom.make<string[]>([]);
    const todoList = yield* todos.get();

    const addTodo = (currentInput: string) => {
      return todos.update((list: string[]) => list.concat(currentInput));
    };

    const removeTodo = (todoToRemove: string) => {
      return todos.update((list: string[]) => 
        list.filter((todo: string) => todo !== todoToRemove)
      );
    };

    return (
      <form
        onSubmit={(e: Event) => {
          e.preventDefault();
          const form = e.currentTarget as HTMLFormElement;
          return pipe(
            new FormData(form),
            Object.fromEntries,
            Schema.decodeUnknown(Schema.Struct({ todoInput: Schema.String })),
            Effect.flatMap((parsed) => addTodo(parsed.todoInput)),
            Effect.tap(() => Effect.sync(() => form.reset()))
          );
        }}
      >
        <h3>Todo List</h3>
        <input
          type="text"
          name="todoInput"
          placeholder="What needs to be done?"
        />
        <button type="submit">Add</button>
        <ul>
          {todoList.map((todo: string) =>
            h(TodoItem, { key: todo, text: todo, onRemove: removeTodo }, [])
          )}
        </ul>
      </form>
    );
  });
};
```

### Static Components (No State)
```typescript
import { type VNode } from "@didact/core";

// Components without state can be simple functions
const Subtitle = ({ children }: { children: VNode }) => (
  <p style="text-align: center; color: #666;">
    {children}
  </p>
);

export const StaticHeader = () => (
  <div>
    <h1 style="text-align: center;">🚀 Didact Effect Demo</h1>
    <Subtitle>Effect-first reactive JSX</Subtitle>
  </div>
);
```

## Rendering the App

```typescript
import * as Effect from "effect/Effect";
import * as BrowserPlatform from "@effect/platform-browser";
import { render, h } from "@didact/core";

Effect.gen(function*() {
  const root = document.getElementById("root")!;

  // render() returns Effect.never, so fork it to run independently
  yield* Effect.fork(render(
    h("div", {}, [
      h(StaticHeader),
      h(Counter, { label: "Counter A" }),
      h(Counter, { label: "Counter B" }),
      h(TodoList),
    ]),
    root
  ));

  return yield* Effect.never;
}).pipe(
  Effect.catchAllDefect((e) => Effect.log(e)),
  BrowserPlatform.BrowserRuntime.runMain,
);
```

## Key API Patterns

### Atoms
- `Atom.make(initialValue)` - Create reactive state
- `atom.get()` - Read current value (auto-subscribes component)
- `atom.set(newValue)` - Set new value
- `atom.update(fn)` - Update based on previous value

### Event Handlers
- Can return `Effect` values that will be auto-executed
- Use `Effect.sync()` for side effects
- Use `pipe()` for composing Effects

### Components
- Return `Effect<VNode>` for stateful components
- Return `VNode` directly for static components
- Return `Stream<VNode>` for progressive rendering (use with Suspense)

### JSX vs h()
Both work, use what you prefer:
```typescript
// JSX syntax (requires tsconfig jsx: "react-jsx")
<button onClick={() => count.set(0)}>Reset</button>

// h() function
h("button", { onClick: () => count.set(0) }, ["Reset"])
```
