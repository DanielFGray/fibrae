/**
 * Didact Demo App with Router
 *
 * A real app showcasing:
 * - Link component with active states
 * - Navigator for programmatic navigation
 * - Route matching with dynamic params
 * - Counter and Todo features
 */

import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as BrowserPlatform from "@effect/platform-browser";
import { pipe } from "effect/Function";
import { render, Atom, AtomRegistry } from "@didact/core";
import {
  Route,
  Router,
  BrowserHistoryLive,
  NavigatorTag,
  NavigatorLive,
  createLink,
} from "@didact/core/router";

// =============================================================================
// Route Definitions
// =============================================================================

const homeRoute = Route.get("home", "/");
const counterRoute = Route.get("counter", "/counter");
const todosRoute = Route.get("todos", "/todos");
const postsRoute = Route.get("posts", "/posts");
const postRoute = Route.get("post")`/posts/${Route.param("id", Schema.NumberFromString)}`;

// Build the router
const appRouter = Router.make("app")
  .add(
    Router.group("main")
      .add(homeRoute)
      .add(counterRoute)
      .add(todosRoute)
      .add(postsRoute)
      .add(postRoute)
  );

// Create Link component bound to router
const Link = createLink(appRouter);

// =============================================================================
// Atoms for State
// =============================================================================

const counterAtom = Atom.make(0);
const todosAtom = Atom.make<Array<{ id: number; text: string }>>([]);
const todoCompletedAtom = Atom.family((id: number) => Atom.make(false));
const sortAtom = Atom.make<string>("");

// Mock posts data
const posts = [
  { id: 1, title: "Getting Started with Didact", excerpt: "Learn the basics of Effect-first rendering" },
  { id: 2, title: "Understanding Atoms", excerpt: "Reactive state management with fine-grained updates" },
  { id: 3, title: "Building with Streams", excerpt: "Progressive rendering and async data" },
];

// =============================================================================
// Page Components
// =============================================================================

const HomePage = () => (
  <div class="page">
    <h1 data-cy="page-title">Home</h1>
    <p>Welcome to the Didact demo app!</p>
    <p>This demonstrates Effect-first JSX rendering with:</p>
    <ul>
      <li>Reactive state with Atoms</li>
      <li>Type-safe routing</li>
      <li>SPA navigation</li>
    </ul>
  </div>
);

const CounterPage = () =>
  Effect.gen(function* () {
    const registry = yield* AtomRegistry.AtomRegistry;
    const count = yield* Atom.get(counterAtom);

    return (
      <div class="page">
        <h1 data-cy="page-title">Counter</h1>
        <p data-cy="counter-value">Count: {count}</p>
        <div style="display: flex; gap: 0.5rem;">
          <button
            data-cy="counter-increment"
            onClick={() => registry.update(counterAtom, (n: number) => n + 1)}
          >
            +
          </button>
          <button
            data-cy="counter-decrement"
            onClick={() => registry.update(counterAtom, (n: number) => n - 1)}
          >
            -
          </button>
          <button
            data-cy="counter-reset"
            onClick={() => registry.set(counterAtom, 0)}
          >
            Reset
          </button>
        </div>
      </div>
    );
  });

const TodoItem = ({ todo, onRemove }: { todo: { id: number; text: string }; onRemove: (id: number) => void }) =>
  Effect.gen(function* () {
    const registry = yield* AtomRegistry.AtomRegistry;
    const completedAtom = todoCompletedAtom(todo.id);
    const isCompleted = yield* Atom.get(completedAtom);

    return (
      <li data-cy="todo-item" style="display: flex; gap: 0.5rem; align-items: center; padding: 0.5rem 0;">
        <input
          data-cy="todo-checkbox"
          type="checkbox"
          checked={isCompleted}
          onChange={() => registry.update(completedAtom, (v: boolean) => !v)}
        />
        <span
          data-cy="todo-text"
          style={isCompleted ? "text-decoration: line-through; color: #666;" : ""}
        >
          {todo.text}
        </span>
        <button
          data-cy="todo-remove"
          onClick={() => onRemove(todo.id)}
          style="margin-left: auto;"
        >
          Remove
        </button>
      </li>
    );
  });

let nextTodoId = 1;

const TodosPage = () =>
  Effect.gen(function* () {
    const registry = yield* AtomRegistry.AtomRegistry;
    const todoList = yield* Atom.get(todosAtom);

    const addTodo = (text: string) => {
      const id = nextTodoId++;
      registry.update(todosAtom, (list) => [...list, { id, text }]);
    };

    const removeTodo = (id: number) => {
      registry.update(todosAtom, (list) => list.filter((t) => t.id !== id));
    };

    return (
      <div class="page">
        <h1 data-cy="page-title">Todos</h1>
        <form
          onSubmit={(e: Event) => {
            e.preventDefault();
            const form = e.currentTarget as HTMLFormElement;
            const input = form.elements.namedItem("todoInput") as HTMLInputElement;
            if (input.value.trim()) {
              addTodo(input.value.trim());
              form.reset();
            }
          }}
        >
          <div style="display: flex; gap: 0.5rem; margin-bottom: 1rem;">
            <input
              data-cy="todo-input"
              type="text"
              name="todoInput"
              placeholder="What needs to be done?"
              style="flex: 1;"
            />
            <button data-cy="todo-add" type="submit">
              Add
            </button>
          </div>
        </form>
        <ul style="list-style: none; padding: 0;">
          {todoList.map((todo) => (
            <TodoItem key={todo.id} todo={todo} onRemove={removeTodo} />
          ))}
        </ul>
      </div>
    );
  });

const PostsPage = () =>
  Effect.gen(function* () {
    const navigator = yield* NavigatorTag;
    const currentSort = yield* Atom.get(sortAtom);

    return (
      <div class="page">
        <h1 data-cy="page-title">Posts</h1>

        <div class="sort-controls">
          <span>Sort by:</span>
          <button
            data-cy="sort-by-date"
            onClick={() => navigator.go("posts", { searchParams: { sort: "date" } })}
          >
            Date
          </button>
          <button
            data-cy="sort-by-title"
            onClick={() => navigator.go("posts", { searchParams: { sort: "title" } })}
          >
            Title
          </button>
          {currentSort && (
            <span data-cy="current-sort" style="color: #4ade80;">
              Current: {currentSort}
            </span>
          )}
        </div>

        <ul class="post-list">
          {posts.map((post) => (
            <li key={post.id}>
              <Link data-cy={`post-link-${post.id}`} to="post" params={{ id: post.id }}>
                <span data-cy="post-link">{post.title}</span>
              </Link>
              <p style="margin: 0.25rem 0 0 0; color: #888; font-size: 0.9em;">
                {post.excerpt}
              </p>
            </li>
          ))}
        </ul>
      </div>
    );
  });

const PostDetailPage = ({ id }: { id: number }) => {
  const post = posts.find((p) => p.id === id);

  if (!post) {
    return (
      <div class="page">
        <h1 data-cy="page-title">Post Not Found</h1>
        <p>No post with ID {id}</p>
      </div>
    );
  }

  return (
    <div class="page">
      <h1 data-cy="page-title">Post: {post.title}</h1>
      <p data-cy="post-id">ID: {id}</p>
      <p data-cy="post-id-type">ID type: {typeof id}</p>
      <p>{post.excerpt}</p>
    </div>
  );
};

// =============================================================================
// Navigation Bar
// =============================================================================

const NavBar = () =>
  Effect.gen(function* () {
    const navigator = yield* NavigatorTag;

    return (
      <nav>
        <Link data-cy="nav-home" to="home">
          Home
        </Link>
        <Link data-cy="nav-counter" to="counter">
          Counter
        </Link>
        <Link data-cy="nav-todos" to="todos">
          Todos
        </Link>
        <Link data-cy="nav-posts" to="posts">
          Posts
        </Link>

        <div class="history-controls" style="margin-left: auto; display: flex; gap: 0.5rem;">
          <button data-cy="back-btn" onClick={() => navigator.back}>
            Back
          </button>
          <button data-cy="forward-btn" onClick={() => navigator.forward}>
            Forward
          </button>
        </div>
      </nav>
    );
  });

// =============================================================================
// Router Outlet
// =============================================================================

const RouterOutlet = () =>
  Effect.gen(function* () {
    const navigator = yield* NavigatorTag;
    const registry = yield* AtomRegistry.AtomRegistry;
    const currentRoute = yield* Atom.get(navigator.currentRoute);

    // Update sort atom from search params
    if (Option.isSome(currentRoute) && currentRoute.value.searchParams.sort) {
      registry.set(sortAtom, currentRoute.value.searchParams.sort);
    }

    return Option.match(currentRoute, {
      onNone: () => <div class="page">Loading...</div>,
      onSome: (route) => {
        switch (route.routeName) {
          case "home":
            return <HomePage />;
          case "counter":
            return <CounterPage />;
          case "todos":
            return <TodosPage />;
          case "posts":
            return <PostsPage />;
          case "post":
            return <PostDetailPage id={route.params.id as number} />;
          default:
            return (
              <div class="page">
                <h1>404</h1>
                <p>Page not found</p>
              </div>
            );
        }
      },
    });
  });

// =============================================================================
// Main App
// =============================================================================

const App = () =>
  Effect.gen(function* () {
    return (
      <>
        <NavBar />
        <RouterOutlet />
      </>
    );
  });

// =============================================================================
// Bootstrap
// =============================================================================

const routerLayer = Layer.provideMerge(NavigatorLive(appRouter), BrowserHistoryLive);

Effect.gen(function* () {
  const root = pipe(
    document.getElementById("root"),
    Option.fromNullable,
    Option.getOrThrow
  );

  yield* render(<App />, root, { layer: routerLayer });

  return yield* Effect.never;
}).pipe(
  Effect.catchAllDefect((e) => Effect.log(e)),
  BrowserPlatform.BrowserRuntime.runMain
);
