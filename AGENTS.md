
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
const Counter: Component = (props) => {
  const count = Atom.make(0);
  return Effect.gen(function* () {
    return h([ // fragment
      h("button", { onClick: () => Atom.update(count, n => n + 1) }, [
        `Count: ${Atom.get(count)}`,
      ]),
    ]);
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
  - `./dev-server-logs.json` - browser console output when debugging frontend issues. Effect captures log info with `Effect.log` and sends structured json logs to this file. Do not read it directly without using `jq` to search/filter it, eg `jq -R 'select(.message | contains(\"foo"))[-10:] | "timestamp: \(.timestamp), message: \(.message)"' dev-server-logs.json`

## Commands
  - Build: `bun run build` (tsc)
  - E2E Tests: `bun cypress:run` (headless Cypress E2E tests)
    - Single test: `bun cypress:run -- --spec cypress/e2e/<test-name>.cy.ts`
  - Unit Tests: `bun --filter demo test:run` (vitest with @effect/vitest integration)
    - Watch mode: `bun --filter demo test`

Assume the vite dev server is already running. Do not try to run it with `bun dev`,
I am running the dev server, and the test runner re-runs on edits. You can safely inspect the log output after sleeping 3 seconds after editing without running tests manually.

## Current State
  - ⏳ Basic reactive Atom tracking
  - ⏳ Fine-grained re-renders
  - ⏳ Boundary component (async/error handling)
  - ⏳ Stream support for manual control
  - ⏳ Performance profiling/optimization

# Tools  
  - `ast-grep` is installed, *use it as much as possible* when editing, see ./docs/ast-grep-guide.md
  - `@effect/vitest` is configured for unit testing Effect programs
    - Use `it.effect()` for tests that return Effects
    - Tests automatically run Effects and handle errors
    - See `packages/demo/src/example.test.ts` for examples

> Remember, though it is inspired by React, this is not recreating React nor implementing React APIs
