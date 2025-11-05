/** @jsxImportSource @didact/core */
import { h } from "@didact/core";

/**
 * SSR-compatible versions of demo components.
 * These don't use Atom state since SSR is a one-shot render.
 */

export const Counter = ({ label }: { label: string }) => {
  return <div
    data-cy={label.toLowerCase().replace(" ", "-")}
    style="padding: 1rem; border: 2px solid #666; border-radius: 8px; margin: 1rem 0;"
  >
    <h3>{label}</h3>
    <p data-cy="counter-value">Count: 0</p>
    <div style="display: flex; gap: 0.5rem;">
      <button data-cy="counter-increment">+</button>
      <button data-cy="counter-decrement">-</button>
      <button data-cy="counter-reset">Reset</button>
    </div>
  </div>;
};

export const TodoList = () => {
  return <form
    data-cy="todo-list"
    style="padding: 1rem; border: 2px solid #44aa44; border-radius: 8px; margin: 1rem 0;"
  >
    <h3>Effect Todo List</h3>
    <div style="display: flex; gap: 0.5rem; margin-bottom: 1rem;">
      <input
        data-cy="todo-input"
        type="text"
        name="todoInput"
        placeholder="What needs to be done?"
        style="flex: 1; padding: 0.5rem;"
      />
      <button data-cy="todo-add" type="submit">Add</button>
    </div>
    <ul style="list-style: none; padding: 0;" />
  </form>;
};

export const StaticHeader = () => (
  <div style="max-width: 800px; margin: 2rem auto; font-family: system-ui;">
    <h1 data-cy="app-title" style="text-align: center;">
      🚀 Didact Effect Demo (SSR)
    </h1>
    <p data-cy="app-subtitle" style="text-align: center; color: #666;">
      Server-rendered Effect-first reactive JSX
    </p>
  </div>
);

export const StreamCounterPlaceholder = () => (
  <div
    data-cy="stream-counter"
    style="padding: 1rem; border: 2px solid #999; border-radius: 8px; margin: 1rem 0;"
  >
    <h3>Stream Counter</h3>
    <p data-cy="stream-status">Loading...</p>
  </div>
);

// Composite App component for SSR
export const App = () => h("div", {}, [
  h(StaticHeader),
  h(StreamCounterPlaceholder),
  h("div", {}, [
    h(Counter, { label: "Counter A" }),
    h(Counter, { label: "Counter B" }),
  ]),
  h(TodoList),
]);
