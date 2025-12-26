import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as LogLevel from "effect/LogLevel";
import * as BrowserPlatform from "@effect/platform-browser";
import { pipe } from "effect/Function";
import { render, Atom, AtomRegistry, Suspense, ErrorBoundary, type VNode } from "lumon";

// Module-scope atoms/families
const counterAtom = Atom.family((label: string) => Atom.make(0));
const todosAtom = Atom.make<string[]>([]);
const todoCompletedAtom = Atom.family((id: string) => Atom.make(false));
const queryAtom = Atom.make("");
const debouncedQueryAtom = Atom.make("");
const isSearchingAtom = Atom.make(false);

// Example 1: Simple Counter
const Counter = ({ label }: { label: string }) => Effect.gen(function*() {
  const value = yield* Atom.get(counterAtom(label));
  const registry = yield* AtomRegistry.AtomRegistry;

  return (
    <div data-cy="example-counter">
      <h3>{label}</h3>
      <p data-cy="counter-value">Count: {value}</p>
      <button data-cy="counter-increment" onClick={() => registry.update(counterAtom(label), (n: number) => n + 1)}>
        +
      </button>
      <button data-cy="counter-decrement" onClick={() => registry.update(counterAtom(label), (n: number) => n - 1)}>
        -
      </button>
      <button data-cy="counter-reset" onClick={() => registry.set(counterAtom(label), 0)}>
        Reset
      </button>
    </div>
  );
});

// Example 2: Stream Component with Suspense
// Initial delay ensures Suspense fallback is shown (threshold defaults to 100ms)
const StreamCounter = () => {
  const items = [
    <div data-cy="stream-status"><p>Ready: 3</p></div>,
    <div data-cy="stream-status"><p>Ready: 2</p></div>,
    <div data-cy="stream-status"><p>Ready: 1</p></div>,
    <div data-cy="stream-status"><p style="color: #4ade80;">Complete!</p></div>
  ];

  return pipe(
    // Delay before first emission to trigger Suspense fallback
    Stream.fromEffect(Effect.sleep("200 millis")),
    Stream.flatMap(() => Stream.fromIterable(items)),
    Stream.schedule(Schedule.spaced("500 millis"))
  );
};

// Example 3: TodoItem child component
const TodoItem = ({
  text,
  onRemove,
}: {
  text: string;
  onRemove: (text: string) => Effect.Effect<void> | void;
}) => Effect.gen(function*() {
  const registry = yield* AtomRegistry.AtomRegistry;
  const completed = todoCompletedAtom(text);
  const isCompleted = yield* Atom.get(completed);

  return (
    <li data-cy="todo-item" style="display: flex; gap: 0.5rem; align-items: center; padding: 0.5rem 0;">
      <input
        data-cy="todo-checkbox"
        type="checkbox"
        checked={isCompleted}
        onChange={() => registry.update(completed, (v: boolean) => !v)} />
      <span
        data-cy="todo-text"
        style={isCompleted ? "text-decoration: line-through; color: #999;" : ""}
      >
        {text}
      </span>
      <button
        data-cy="todo-remove"
        type="button"
        onClick={() => onRemove(text)}
        style="margin-left: auto;"
      >
        Remove
      </button>
    </li>
  );
});

// Example 3: Todo List with form submission
const TodoList = () => Effect.gen(function*() {
  const registry = yield* AtomRegistry.AtomRegistry;
  const todoList = yield* Atom.get(todosAtom);

  const addTodo = (currentInput: string) => {
    return Effect.sync(() => registry.update(todosAtom, (list: string[]) => list.concat(currentInput)));
  };

  const removeTodo = (todoToRemove: string) => {
    return Effect.sync(() => registry.update(todosAtom, (list: string[]) => list.filter((todo: string) => todo !== todoToRemove)
    ));
  };

  return (
    <form
      data-cy="todo-list"
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
      <div style="display: flex; gap: 0.5rem; margin-bottom: 1rem;">
        <input
          data-cy="todo-input"
          type="text"
          name="todoInput"
          placeholder="What needs to be done?"
          style="flex: 1; padding: 0.5rem;" />
        <button data-cy="todo-add" type="submit">Add</button>
      </div>
      <ul style="list-style: none; padding: 0;">
        {todoList.map((todo: string) => <TodoItem key={todo} text={todo} onRemove={removeTodo} />
        )}
      </ul>
    </form>
  );
});

// Example 4: Static Components
const Subtitle = ({ children }: { children: VNode | string }) => (
  <p style="text-align: center; color: #999;">
    {children}
  </p>
);

const StaticHeader = () => (
  <div>
    <h1 style="text-align: center;">🚀 Static Component Example</h1>
    <Subtitle>No state, just pure rendering</Subtitle>
  </div>
);

// Example 5: Debounced Search
// This attempts to use a debounced Effect pattern - will it work?
const DebouncedSearch = () => Effect.gen(function*() {
  const registry = yield* AtomRegistry.AtomRegistry;

  const currentQuery = yield* Atom.get(queryAtom);
  const currentDebouncedQuery = yield* Atom.get(debouncedQueryAtom);
  const searching = yield* Atom.get(isSearchingAtom);

  // Try to debounce with Effect.delay - stress test!
  const performSearch = (value: string) => pipe(
    Effect.sync(() => registry.set(isSearchingAtom, true)),
    Effect.flatMap(() => Effect.delay(Effect.void, "300 millis")),
    Effect.flatMap(() => Effect.sync(() => {
      registry.set(debouncedQueryAtom, value);
      registry.set(isSearchingAtom, false);
    }))
  );

  // Simulate search results
  const results = currentDebouncedQuery.length >= 2
    ? [`Result 1 for "${currentDebouncedQuery}"`, `Result 2 for "${currentDebouncedQuery}"`, `Result 3 for "${currentDebouncedQuery}"`]
    : [];

  return (
    <div data-cy="debounced-search">
      <h3>Debounced Search</h3>
      <p style="color: #ffa94a; font-size: 0.9em; margin-bottom: 1rem;">
        ⚠️ Testing: Effect.delay in event handlers
      </p>
      <input
        data-cy="search-input"
        type="text"
        value={currentQuery}
        onInput={(e: InputEvent) => {
          const value = (e.target as HTMLInputElement).value;
          registry.set(queryAtom, value);
          // Return an Effect that will be auto-executed - stress test!
          return performSearch(value);
        }}
        placeholder="Type to search..."
        style="width: 100%; padding: 0.5rem; margin-bottom: 1rem;" />
      <p style="color: #999;">
        Query: <strong>{currentQuery}</strong> |
        Debounced: <strong>{currentDebouncedQuery || "(none)"}</strong>
        {searching && " | 🔄 Searching..."}
      </p>
      <ul data-cy="search-results" style="list-style: none; padding: 0;">
        {results.length > 0 ? (
          results.map((result, i) => (
            <li key={i} data-cy="search-result" style="padding: 0.5rem; background: #333; margin: 0.25rem 0; border-radius: 4px;">
              {result}
            </li>
          ))
        ) : (
          <li style="color: #999; font-style: italic;">
            {currentDebouncedQuery.length > 0 ? "Type at least 2 characters..." : "Start typing to search..."}
          </li>
        )}
      </ul>
    </div>
  );
});

// Example 6: Service-based component (like React Context)
// This tests if Effect.Service works across multiple components with shared Atoms
const themeAtom = Atom.make<"light" | "dark">("dark");
class ThemeService extends Effect.Service<ThemeService>()("ThemeService", {
  accessors: true,
  effect: Effect.gen(function*() {
    const registry = yield* AtomRegistry.AtomRegistry;

    return {
      getTheme: () => Atom.get(themeAtom),
      toggleTheme: () => Effect.sync(() => registry.update(themeAtom, (t: "light" | "dark") => t === "light" ? "dark" : "light"))
    };
  })
}) { }

// Testing: Async service calls with Effect.sleep - will components show loading states?
class UserService extends Effect.Service<UserService>()("UserService", {
  accessors: true,
  sync: () => ({
    getCurrentUser: () => pipe(
      Effect.log("UserService: Fetching current user..."),
      Effect.flatMap(() => Effect.sleep("1 second")),
      Effect.flatMap(() => Effect.succeed({ name: "Alice", role: "admin" })),
      Effect.tap(() => Effect.log("UserService: Current user loaded!"))
    ),
    getUsers: () => pipe(
      Effect.log("UserService: Fetching all users..."),
      Effect.flatMap(() => Effect.sleep("2 seconds")),
      Effect.flatMap(() => Effect.succeed([
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" },
        { id: 3, name: "Charlie" }
      ])),
      Effect.tap(() => Effect.log("UserService: All users loaded!"))
    )
  })
}) { }

const ThemedUserCard = () => Effect.gen(function*() {
  const theme = yield* ThemeService.getTheme();
  const user = yield* UserService.getCurrentUser();

  const bgColor = theme === "light" ? "#f0f0f0" : "#2a2a2a";
  const textColor = theme === "light" ? "#1a1a1a" : "#e0e0e0";

  return (
    <div
      data-cy="themed-user-card"
      style={`padding: 1rem; background: ${bgColor}; color: ${textColor}; border-radius: 8px; margin: 1rem 0;`}
    >
      <h4>Current User</h4>
      <p>Name: <strong>{user.name}</strong></p>
      <p>Role: <strong>{user.role}</strong></p>
      <p>Theme: <strong>{theme}</strong></p>
      <button
        data-cy="toggle-theme"
        onClick={() => ThemeService.toggleTheme()}
        style="padding: 0.5rem 1rem;"
      >
        Toggle Theme (should update both components!)
      </button>
    </div>
  );
});

const UserList = () => Effect.gen(function*() {
  const themeService = yield* ThemeService;
  const userService = yield* UserService;

  const theme = yield* themeService.getTheme();
  const users = yield* userService.getUsers();

  const bgColor = theme === "light" ? "#f0f0f0" : "#2a2a2a";
  const textColor = theme === "light" ? "#1a1a1a" : "#e0e0e0";

  return (
    <div data-cy="user-list" style={`padding: 1rem; background: ${bgColor}; color: ${textColor}; border-radius: 8px;`}>
      <h4>All Users (theme: {theme})</h4>
      <ul style="list-style: none; padding: 0;">
        {users.map((user) => (
          <li key={user.id} style="padding: 0.5rem 0;">
            {user.id}. {user.name}
          </li>
        ))}
      </ul>
      <p style="color: #ffa94a; font-size: 0.9em;">
        ⚠️ Testing: Does toggling theme above update this component too?
      </p>
    </div>
  );
});

// Main Examples Page
Effect.gen(function*() {
  const root = pipe(
    document.getElementById("root"),
    Option.fromNullable,
    Option.getOrThrow
  );

  // Helper to create section with header and render container
  const createSection = (title: string, description: string, dataCy?: string) => {
    const section = document.createElement("div");
    section.className = "example-section";
    const header = document.createElement("h2");
    header.textContent = title;
    const desc = document.createElement("p");
    desc.textContent = description;
    const container = document.createElement("div");
    if (dataCy) {
      container.setAttribute("data-cy", dataCy);
    }
    section.appendChild(header);
    section.appendChild(desc);
    section.appendChild(container);
    root.appendChild(section);
    return container;  // Return container for render(), not section
  };

  // Create sections for each example
  const counterContainer = createSection("Example 1: Simple Counter", "Basic reactive state with Atom.make()");
  const staticContainer = createSection("Example 2: Static Components", "Components without state");
  const streamContainer = createSection("Example 3: Stream with Suspense", "Progressive rendering with fallback");
  const todoContainer = createSection("Example 4: Todo List with Child Components", "Form submission and nested components");
  const searchContainer = createSection("Example 5: Debounced Search 🔬", "Testing: Effect.delay in event handlers + multiple atom updates");
  const serviceContainer = createSection("Example 6: Effect Services 🔬", "Testing: Shared services with Atoms + async Effect.sleep (1-2 sec delays)");
  const errorContainer = createSection("Example 7: Error Boundaries", "Render-time, event, and stream errors", "error-container");

  // Demo components for ErrorBoundary
  const CrashDuringRender = () => {
    throw new Error("render-crash");
  };

  const EventFailer = () => (
    <div>
      <button data-cy="fail-event" onClick={() => Effect.fail(new Error("event-crash"))}>Fail Event</button>
    </div>
  );

  // Stream that emits once then fails (tests post-first-emission failure)
  const StreamFailer = () => {
    const ok = <div data-cy="stream-ok">Stream OK once</div>;
    const fail = Effect.delay(Effect.fail(new Error("stream-crash")), "300 millis");
    return Stream.concat(Stream.succeed(ok), Stream.fromEffect(fail));
  };

  // Stream that fails before first emission (tests pre-first-emission failure)
  const StreamFailerImmediate = () => {
    return Stream.fromEffect(Effect.fail(new Error("stream-crash-immediate")));
  };

  // Stream that takes longer than Suspense threshold then fails
  // Tests that ErrorBoundary takes precedence over Suspense fallback
  const SlowThenFail = () => {
    // Delay 200ms (> 100ms threshold) so Suspense shows loading, then fail
    return Stream.fromEffect(
      Effect.delay(Effect.fail(new Error("slow-then-fail")), "200 millis")
    );
  };

  // Render each example independently
  yield* Effect.fork(render(
    <Counter label="Example Counter" />,
    counterContainer
  ));

  yield* Effect.fork(render(
    <StaticHeader />,
    staticContainer
  ));

  yield* Effect.fork(render(
    <Suspense fallback={<div data-cy="stream-loading"> Loading stream...</div>}><StreamCounter /></Suspense>,
    streamContainer
  ));

  yield* Effect.fork(render(<TodoList />, todoContainer));

  yield* Effect.fork(render(<DebouncedSearch />, searchContainer));

  // Service example needs to provide the services to the render
  // Use render's layer option so services have access to AtomRegistry
  const serviceLayer = Layer.merge(ThemeService.Default, UserService.Default);

  yield* Effect.fork(render(
    <><ThemedUserCard /><UserList /></>,
    serviceContainer,
    { layer: serviceLayer }
  ));

  // Error boundary renders - test all error scenarios
  yield* Effect.fork(render(
    <>
      <ErrorBoundary fallback={<div data-cy="fallback-render">Render Error</div>}>
        <CrashDuringRender />
      </ErrorBoundary>
      <ErrorBoundary fallback={<div data-cy="fallback-event">Event Error</div>}>
        <EventFailer />
      </ErrorBoundary>
      <ErrorBoundary fallback={<div data-cy="fallback-stream">Stream Error</div>}>
        <StreamFailer />
      </ErrorBoundary>
      <ErrorBoundary fallback={<div data-cy="fallback-stream-immediate">Stream Immediate Error</div>}>
        <StreamFailerImmediate />
      </ErrorBoundary>
      <ErrorBoundary fallback={<div data-cy="fallback-suspense-error">Suspense Error Precedence</div>}>
        <Suspense fallback={<div data-cy="suspense-loading">Loading slow component...</div>}>
          <SlowThenFail />
        </Suspense>
      </ErrorBoundary>
    </>,
    errorContainer
  ));

  return yield* Effect.never;
}).pipe(
  Effect.catchAllDefect((e) => Effect.flatMap(Effect.log(e), () => Effect.never)),
  Effect.provide(Logger.minimumLogLevel(LogLevel.Debug)),
  BrowserPlatform.BrowserRuntime.runMain,
);
