
# Agent Guidelines for didact-ts

## Project Goal
Building an Effect-first JSX renderer where components are Effect programs with automatic reactivity. Not React - uses Effect.ts primitives directly.

## What is Effect?
[Effect](https://effect.website/) is a TypeScript library for building typed, composable, testable programs. Think structured concurrency + dependency injection + resource management.

**Additional API documentation:**
  - `./docs/effect-docs.md` - Effect.ts APIs relevant to didact (FiberSet, Queue, Scope, etc.)
  - `./docs/effect-atom-core.md` - Complete Atom/AtomRegistry/AtomRuntime API reference

**Key concepts:**
  - Use `Atom` for reactive state
  - Only changed components re-render (fine-grained updates)
  - Event handlers can return Effects (auto-executed)
  - Components should never need `Effect.runPromise` or to `Effect.runFork`, handled automatically by `DidactRuntime`
  - Use Effect's wealth of APIs

## Files:
  - `./packages/didact/src/index.ts` - main source code
  - `./packages/didact/src/non-effect.ts` - legacy react-style renderer for reference (DO NOT TOUCH)
  - `./packages/demo/src/demo-effect.ts` - example usage of didact renderer, used for testing

## Commands
  - Build: `bun run build` (tsc)
  - E2E Tests: `bun --filter demo cypress:run` (headless Cypress E2E tests)
    - Single test: `bun --filter demo cypress:run --spec "cypress/e2e/<test-name>.cy.ts"`
  - **IMPORTANT:** Do NOT pipe test output through `head`, `tail`, or other filters. Let tests run to completion and show full output.

Assume the vite dev server is already running. Do not try to run it with `bun dev`.

## Roadmap
  - Error Boundary component: catch component/stream failures and render fallback; optional `onError`.
  - Stream errors: surface pre-first-emission failures to boundary; terminate subscription on later failures and trigger boundary.
  - Interaction with Suspense: error state takes precedence over fallback.
  - Logging: keep structured `Effect.log`, but expose minimal error UI via boundary.
  - Tests: add E2E for thrown component error, failing event Effect, failing Stream.

# Task Tracking

**CRITICAL: DO NOT use `todoread` or `todowrite` tools in this project. Use Beads instead.**

Use **Beads** for ALL task tracking, planning, and issue management:
- `beads_create` - Create tasks, bugs, features, epics for planning and tracking work
- `beads_list` / `beads_ready` - Check existing issues before starting work
- `beads_update` - Mark issues `in_progress` when working, update status/priority
- `beads_close` - Mark issues as completed when done
- `beads_dep` - Link related issues (blocks, related, parent-child)
- `beads_stats` - Get overview of project status

**Always log unexpected errors, failing tests, or discovered bugs as beads issues** so they are tracked and not forgotten.

Database location: `.beads/beads.db`

# Tools  
  - `ast-grep` is installed, *use it as much as possible* when editing, see ./docs/ast-grep-guide.md
    - 
  - Cypress is used for all E2E testing in `packages/demo/cypress/e2e/`
  - **Firefox MCP** - Access live browser console logs from the dev server:
    - firefox-devtools_navigate_page to http://localhost:5173
    - firefox-devtools_list_console_messages (optionally filter with limit, level, textContains)
    - Can also take snapshots, interact with UI, monitor network requests

> Remember, though it is inspired by React, this is not recreating React nor implementing React APIs
