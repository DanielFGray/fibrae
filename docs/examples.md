## Examples

### Simple Counter (Leveraging @effect-atom/atom)
```typescript
const Counter: Component = ({ label }: { label: string }) => {
  const countAtom = Atom.make(0)
  return Effect.gen(function* () {
    // Use derived atom for automatic reactivity tracking
    const displayAtom = yield* Atom.make((get) => ({
      count: get(countAtom),
      label: label
    }))

    const { count, label: currentLabel } = Atom.get(displayAtom)

    return h(Fragment, [
      h("h3", [currentLabel]),
      h("p", [`Count: ${count}`]),
      h("button", {
        onClick: () => Atom.set(countAtom, n => n + 1)
      }, ["+"]),
      h("button", {
        onClick: () => Atom.set(countAtom, n => n - 1)
      }, ["-"])
    ])
  })
}
```

### Stream-Based Event Handling with Atoms
```typescript
// Use atoms for reactive state, streams for event processing
const searchQueryAtom = Atom.make("")
const searchResultsAtom = Atom.make((get) => {
  const query = get(searchQueryAtom)
  if (query.length < 2) return []

  // This could be an Effect that fetches from API
  return Effect.succeed([`Result for: ${query}`])
})

const DebouncedSearch: Component = () =>
  Effect.gen(function* () {
    // Get current state from atoms
    const query = Atom.get(searchQueryAtom)
    const results = Atom.get(searchResultsAtom)

    // Set up debounced input stream
    const handleInput = (element: HTMLInputElement) => pipe(
      Stream.fromEventListener(element, "input"),
      Stream.debounce("300 millis"),
      Stream.map((event: InputEvent) => (event.target as HTMLInputElement).value),
      Stream.runForEach((value) => Atom.set(searchQueryAtom, value))
    )

    return h("div", [
      h("input", {
        value: query,
        onMount: handleInput,  // Custom event for element mounting
        placeholder: "Search..."
      }),
      h("ul",
        Result.match(results, {
          onInitial: () => [h("li", ["Loading..."])],
          onSuccess: (items) => items.map(item => h("li", [item])),
          onFailure: () => [h("li", ["Error loading results"])]
        })
      )
    ])
  })
```

### Global Event Streams with Atoms
```typescript
// Global atoms for window state - managed by global event streams
const windowDimensionsAtom = Atom.make({
  width: window.innerWidth,
  height: window.innerHeight
})

// Global stream management (runs once at app startup)
const setupGlobalStreams = () => {
  const resizeStream = pipe(
    BrowserStream.fromEventListenerWindow("resize"),
    Stream.runForEach(() =>
      Atom.set(windowDimensionsAtom, {
        width: window.innerWidth,
        height: window.innerHeight
      })
    )
  )

  return BrowserRuntime.runMain(resizeStream).fork
}

const ResponsiveComponent: Component = () =>
  Effect.gen(function* () {
    // Reactive derived state using atoms
    const layoutAtom = Atom.make((get) => {
      const { width } = get(windowDimensionsAtom)
      return width < 768 ? "Mobile" : "Desktop"
    })

    const { width, height } = Atom.get(windowDimensionsAtom)
    const layout = Atom.get(layoutAtom)

    return h("div", [
      h("h3", ["Responsive Component"]),
      h("p", [`Window size: ${width}x${height}`]),
      h("p", [layout])
    ])
  })
```

### Service Integration with Atom Runtime
```typescript
class UserService extends Effect.Service<UserService>()("UserService", {
  effect: Effect.succeed({
    getUsers: () => Effect.succeed([{ id: 1, name: "Alice" }]),
    searchUsers: (query: string) => Effect.succeed([{ id: 2, name: "Bob" }])
  })
}) {}

// Create atom runtime with services
const appRuntime = Atom.runtime(UserService.Default)

// Atoms that use services via the runtime
const searchQueryAtom = Atom.make("")
const usersAtom = appRuntime.atom(
  Effect.gen(function* () {
    const userService = yield* UserService
    return yield* userService.getUsers()
  })
)

// Derived atom that searches based on query
const searchResultsAtom = appRuntime.atom(
  Effect.gen(function* () {
    const query = Atom.get(searchQueryAtom)
    if (query.length < 2) return []

    const userService = yield* UserService
    return yield* userService.searchUsers(query)
  })
)

const UserSearchList: Component = () =>
  Effect.gen(function* () {
    const query = Atom.get(searchQueryAtom)
    const results = Atom.get(searchResultsAtom)

    return h("div", [
      h("input", {
        value: query,
        onInput: (e) => Atom.set(searchQueryAtom, e.target.value),
        placeholder: "Search users..."
      }),
      h("ul",
        Result.match(results, {
          onInitial: () => [h("li", ["Loading..."])],
          onSuccess: (users) => users.map(u => h("li", { key: u.id }, [u.name])),
          onFailure: () => [h("li", ["Error loading users"])]
        })
      )
    ])
  })
```

## Advanced Event Handling Patterns

### 1. Mouse Tracking with Stream Composition
```typescript
const MouseTracker: Component = () =>
  Effect.gen(function* () {
    const mousePos = yield* Atom.make({ x: 0, y: 0 })
    const isMouseDown = yield* Atom.make(false)

    // Compose multiple mouse event streams
    const mouseStream = Stream.merge(
      pipe(
        BrowserStream.fromEventListenerDocument("mousemove"),
        Stream.map((event) => ({ type: "move", x: event.clientX, y: event.clientY }))
      ),
      pipe(
        BrowserStream.fromEventListenerDocument("mousedown"),
        Stream.map(() => ({ type: "down" }))
      ),
      pipe(
        BrowserStream.fromEventListenerDocument("mouseup"),
        Stream.map(() => ({ type: "up" }))
      )
    )

    yield* Stream.runForEach(mouseStream, (event) => {
      switch (event.type) {
        case "move":
          return Atom.set(mousePos, { x: event.x, y: event.y })
        case "down":
          return Atom.set(isMouseDown, true)
        case "up":
          return Atom.set(isMouseDown, false)
      }
    }).fork

    const pos = Atom.get(mousePos)
    const isDown = Atom.get(isMouseDown)

    return h("div", [
      h("p", [`Mouse: ${pos.x}, ${pos.y}`]),
      h("p", [`Mouse down: ${isDown}`])
    ])
  })
```

### 2. Form Validation with Stream Processing
```typescript
const ValidatedForm: Component = () => {
  const email = yield* Atom.make("")
  const password = yield* Atom.make("")
  const errors = yield* Atom.make<Record<string, string>>({})

  return Effect.gen(function* () {
    // Validation streams with debouncing
    const emailValidation = Atom.toStream(email).pipe(
      Stream.debounce("300 millis"),
      Stream.map((value) => ({
        field: "email",
        error: value.includes("@") ? null : "Invalid email"
      }))
    )

    const passwordValidation = Atom.toStream(password).pipe(
      Stream.debounce("300 millis"),
      Stream.map((value) => ({
        field: "password",
        error: value.length >= 8 ? null : "Password too short"
      }))
    )

    // Merge validation streams
    yield* Stream.runForEach(
      Stream.merge(emailValidation, passwordValidation),
      ({ field, error }) =>
        Atom.update(errors, (prev) => Object.assign({}, prev, {
          [field]: error
        }))
    ).fork

    const currentErrors = Atom.get(errors)
    const currentEmail = Atom.get(email)
    const currentPassword = Atom.get(password)

    return h("form", [
      h("input", {
        type: "email",
        placeholder: "Email",
        onInput: (e) => Atom.set(email, e.target.value)
      }),
      currentErrors.email && h("span", { class: "error" }, [currentErrors.email]),

      h("input", {
        type: "password",
        placeholder: "Password",
        onInput: (e) => Atom.set(password, e.target.value)
      }),
      currentErrors.password && h("span", { class: "error" }, [currentErrors.password]),

      h("button", {
        type: "submit",
        disabled: Object.values(currentErrors).some(Boolean)
      }, ["Submit"])
    ])
  })
}
```
