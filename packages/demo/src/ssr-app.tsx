import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Atom, AtomRegistry, Suspense } from "fibrae";

// =============================================================================
// Counter App
// =============================================================================

/**
 * Serializable counter atom - can be hydrated from SSR state
 */
export const countAtom = Atom.make(0).pipe(
  Atom.serializable({
    key: "count",
    schema: Schema.Number
  })
);

/**
 * Counter component that works on both server and client
 */
export const Counter = () => {
  return Effect.gen(function*() {
    const registry = yield* AtomRegistry.AtomRegistry;
    const count = registry.get(countAtom);

    return (
      <div data-cy="ssr-counter">
        <p data-cy="ssr-count">{String(count)}</p>
        <button
          data-cy="ssr-increment"
          onClick={() => registry.update(countAtom, (c: number) => c + 1)}
        >
          Increment
        </button>
      </div>
    );
  });
};

/**
 * Counter app component for SSR
 */
export const CounterApp = () => (
  <div>
    <h1 data-cy="ssr-title">SSR Counter</h1>
    <Counter />
  </div>
);

// Legacy export for backwards compatibility
export const App = CounterApp;

// =============================================================================
// Todo App
// =============================================================================

// Module-level variable for initial todos (set by server before render)
let _initialTodos: string[] = [];

/**
 * Set initial todos for SSR render (called by server)
 */
export const setInitialTodos = (todos: string[]) => {
  _initialTodos = todos;
};

/**
 * Serializable todos atom - hydrated from SSR state
 */
export const todosAtom = Atom.make<ReadonlyArray<string>>([]).pipe(
  Atom.serializable({
    key: "todos",
    schema: Schema.Array(Schema.String)
  })
);

/**
 * Todo item component
 */
const TodoItem = ({ text, onRemove }: { text: string; onRemove: (text: string) => Effect.Effect<void> }) => (
  <li data-cy="ssr-todo-item" style="display: flex; gap: 0.5rem; align-items: center; padding: 0.5rem 0;">
    <span data-cy="ssr-todo-text" style="flex: 1;">{text}</span>
    <button
      data-cy="ssr-todo-remove"
      onClick={() => onRemove(text)}
      style="padding: 0.25rem 0.5rem; background: #ff4444; color: white; border: none; border-radius: 4px; cursor: pointer;"
    >
      Remove
    </button>
  </li>
);

/**
 * Todo list component that works on both server and client
 */
export const TodoList = () => Effect.gen(function*() {
  const registry = yield* AtomRegistry.AtomRegistry;

  // Initialize atom with SSR todos on first render
  const currentTodos = registry.get(todosAtom);
  if (currentTodos.length === 0 && _initialTodos.length > 0) {
    registry.set(todosAtom, _initialTodos);
  }

  const todos = registry.get(todosAtom);

  const addTodo = (text: string) => Effect.sync(() => {
    registry.update(todosAtom, (list: string[]) => [...list, text]);
    // Also persist to server
    void fetch("/ssr/todo/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ todos: [...registry.get(todosAtom)] })
    });
  });

  const removeTodo = (text: string) => Effect.sync(() => {
    registry.update(todosAtom, (list: string[]) => list.filter((t: string) => t !== text));
    // Also persist to server
    void fetch("/ssr/todo/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ todos: [...registry.get(todosAtom)] })
    });
  });

  return (
    <form
      data-cy="ssr-todo-form"
      style="padding: 1rem; border: 2px solid #44aa44; border-radius: 8px; margin: 1rem 0;"
      onSubmit={(e: Event) => {
        e.preventDefault();
        const form = e.currentTarget as HTMLFormElement;
        const input = form.elements.namedItem("todoInput") as HTMLInputElement;
        const text = input.value.trim();
        if (text) {
          form.reset();
          return addTodo(text);
        }
        return Effect.void;
      }}
    >
      <div style="display: flex; gap: 0.5rem; margin-bottom: 1rem;">
        <input
          data-cy="ssr-todo-input"
          type="text"
          name="todoInput"
          placeholder="What needs to be done?"
          style="flex: 1; padding: 0.5rem;" />
        <button data-cy="ssr-todo-add" type="submit">Add</button>
      </div>
      <ul style="list-style: none; padding: 0; margin: 0;">
        {todos.map((todo: string) => (
          <TodoItem key={todo} text={todo} onRemove={removeTodo} />
        ))}
      </ul>
    </form>
  );
});

/**
 * Todo app component for SSR
 */
export const TodoApp = () => (
  <div>
    <h1 data-cy="ssr-todo-title">SSR Todo List</h1>
    <TodoList />
  </div>
);

// =============================================================================
// Suspense App (for testing Phase 4: Comment Markers)
// =============================================================================

/**
 * Atom for suspense click tracking
 */
export const suspenseClickAtom = Atom.make(0).pipe(
  Atom.serializable({
    key: "suspenseClicks",
    schema: Schema.Number
  })
);

/**
 * Content with a button to verify hydration attached event handlers
 */
const ResolvedContent = () => Effect.gen(function*() {
  const registry = yield* AtomRegistry.AtomRegistry;
  const clicks = registry.get(suspenseClickAtom);

  return (
    <div data-cy="ssr-suspense-content">
      <p>This content rendered immediately</p>
      <p data-cy="ssr-suspense-clicks">Clicks: {String(clicks)}</p>
      <button
        data-cy="ssr-suspense-button"
        onClick={() => registry.update(suspenseClickAtom, (c: number) => c + 1)}
      >
        Click me
      </button>
    </div>
  );
});

/**
 * Suspense app - wraps content in a Suspense boundary
 * The content renders synchronously, so SSR should emit it with "resolved" marker
 */
export const SuspenseApp = () => (
  <div>
    <h1 data-cy="ssr-suspense-title">SSR Suspense Test</h1>
    <Suspense fallback={<div data-cy="ssr-suspense-fallback">Loading...</div>}>
      <ResolvedContent />
    </Suspense>
  </div>
);

// =============================================================================
// Slow Suspense App (for testing Phase 5: Stream/Timeout Handling)
// =============================================================================

/**
 * Atom for slow suspense click tracking
 */
export const slowSuspenseClickAtom = Atom.make(0).pipe(
  Atom.serializable({
    key: "slowSuspenseClicks",
    schema: Schema.Number
  })
);

/**
 * Content that loads slowly (simulated with a delayed Effect)
 * This will timeout in SSR and render fallback marker
 */
const SlowContent = () => Effect.gen(function*() {
  const registry = yield* AtomRegistry.AtomRegistry;
  const clicks = registry.get(slowSuspenseClickAtom);

  return (
    <div data-cy="ssr-slow-content">
      <p>This content loaded after delay</p>
      <p data-cy="ssr-slow-clicks">Clicks: {String(clicks)}</p>
      <button
        data-cy="ssr-slow-button"
        onClick={() => registry.update(slowSuspenseClickAtom, (c: number) => c + 1)}
      >
        Click me
      </button>
    </div>
  );
}).pipe(
  // Delay by 500ms - longer than default Suspense threshold (100ms)
  Effect.delay("500 millis")
);

/**
 * Slow Suspense app - wraps slow content in a Suspense boundary
 * The content takes longer than the threshold, so SSR should emit fallback with "fallback" marker
 */
export const SlowSuspenseApp = () => (
  <div>
    <h1 data-cy="ssr-slow-title">SSR Slow Suspense Test</h1>
    <Suspense
      fallback={<div data-cy="ssr-slow-fallback">Loading slow content...</div>}
      threshold={100}
    >
      <SlowContent />
    </Suspense>
  </div>
);
