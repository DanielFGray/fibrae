
# Agent Guidelines for didact-ts

## Project Goal
Building an Effect-first JSX renderer where components are Effect programs with automatic reactivity. Not React - uses Effect.ts primitives directly.

## What is Effect?
[Effect](https://effect.website/) is a TypeScript library for building typed, composable, testable programs. Think structured concurrency + dependency injection + resource management.

**Additional API documentation:**
  - `./docs/effect-docs.md` - Effect.ts APIs relevant to didact (FiberSet, Queue, Scope, etc.)
  - `./docs/effect-atom-core.md` - Complete Atom/AtomRegistry/AtomRuntime API reference

## Core API Pattern
```typescript
const Counter = (props) => {
  return Effect.gen(function* () {
    const count = yield* Atom.make(0);
    const value = yield* Atom.get(count)
    return (
      <button onClick={() => Atom.update(count, n => n + 1)}>
        Count: {value}
      </button>
    )
  });
}
```

**Key concepts:**
  - Use `Atom.make/get/set/update` for reactive state
  - Reading a Ref auto-subscribes the component to changes
  - Only changed components re-render (fine-grained updates)
  - Event handlers can return Effects (auto-executed)
  - Components should never need `Effect.runPromise` or to `Effect.runFork`, handled automatically by `DidactRuntime`

## Files:
  - `./packages/didact/src/index.ts` - main source code
  - `./packages/didact/src/non-effect.ts` - legacy react-style renderer for reference (DO NOT TOUCH)
  - `./packages/demo/src/demo-effect.ts` - example usage of didact renderer, used for testing

## Commands
  - Build: `bun run build` (tsc)
  - E2E Tests: `bun --filter demo cypress:run` (headless Cypress E2E tests)
    - Single test: `bun --filter demo cypress:run --spec "cypress/e2e/<test-name>.cy.ts"`

Assume the vite dev server is already running. Do not try to run it with `bun dev`.

## Current State
  - ✅ Basic reactive Atom tracking
  - ⏳ Fine-grained re-renders
  - ⏳ Error Boundary component (error handling)
  - ✅ Suspense component (async fallback)
  - ✅ Stream support for manual control
  - ⏳ Performance profiling/optimization

## Roadmap
  - Error Boundary component: catch component/stream failures and render fallback; optional `onError`.
  - Stream errors: surface pre-first-emission failures to boundary; terminate subscription on later failures and trigger boundary.
  - Interaction with Suspense: error state takes precedence over fallback.
  - Logging: keep structured `Effect.log`, but expose minimal error UI via boundary.
  - Tests: add E2E for thrown component error, failing event Effect, failing Stream.

# Tools  
  - `ast-grep` is installed, *use it as much as possible* when editing, see ./docs/ast-grep-guide.md
  - Cypress is used for all E2E testing in `packages/demo/cypress/e2e/`
  - **Firefox MCP** - Access live browser console logs from the dev server:
    ```
    1. firefox-devtools_navigate_page to http://localhost:5173
    2. firefox-devtools_list_console_messages (optionally filter with limit, level, textContains)
    3. Can also take snapshots, interact with UI, monitor network requests
    ```

> Remember, though it is inspired by React, this is not recreating React nor implementing React APIs
