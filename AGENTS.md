# Agent Guidelines for fibrae

## Project Goal

Building an Effect-first JSX renderer where components are Effect programs with automatic reactivity. Not React - uses Effect.ts primitives directly.

## What is Effect?

[Effect](https://effect.website/) is a TypeScript library for building typed, composable, testable programs. Think structured concurrency + dependency injection + resource management.

**Additional API documentation:**

- `./docs/effect-docs.md` - Effect.ts APIs relevant to fibrae (FiberSet, Queue, Scope, etc.)
- `./docs/effect-atom-core.md` - Complete Atom/AtomRegistry/AtomRuntime API reference

**Key concepts:**

- Use `Atom` for reactive state
- Only changed components re-render (fine-grained updates)
- Event handlers can return Effects (auto-executed)
- Components should never need `Effect.runPromise` or to `Effect.runFork`, handled automatically by `FibraeRuntime`
- Use Effect's wealth of APIs

## Files:

- `./packages/fibrae/src/index.ts` - main source code
- `./packages/fibrae/src/non-effect.ts` - legacy react-style renderer for reference (DO NOT TOUCH)
- `./packages/demo/src/demo-effect.ts` - example usage of fibrae renderer, used for testing

## Commands

- Build: `bun run build` (tsc)
- Lint: `bun eslint packages/fibrae/src/` (check for lint errors)
- E2E Tests: `cd packages/demo && bun cypress:run` (headless Cypress E2E tests)
  - Single test: `cd packages/demo && bun cypress:run --spec "cypress/e2e/<test-name>.cy.ts"`
- **IMPORTANT:** Do NOT pipe test output through `head`, `tail`, or other filters. Let tests run to completion and show full output.

**After making changes, always verify:**

1. `bun run build` - TypeScript compiles without errors
2. `bun eslint packages/fibrae/src/` - No new lint errors introduced
3. `cd packages/demo && bun cypress:run` - All tests pass

Assume the vite dev server is already running. Do not try to run it with `bun dev`.

## TDD: Red/Green/Refactor

**Follow Test-Driven Development strictly when implementing features or fixing bugs:**

1. **RED** - Write a failing test first
   - Create the Cypress E2E test that describes the expected behavior
   - Run the test and confirm it fails (for the right reason)
   - Do NOT write implementation code yet

2. **GREEN** - Write minimal code to pass
   - Implement just enough to make the test pass
   - Avoid over-engineering or adding unrequested features
   - Run the test and confirm it passes

3. **REFACTOR** - Clean up while tests stay green
   - Improve code quality, remove duplication
   - Run tests after each change to ensure nothing breaks

**Why this matters:**

- Prevents writing code that isn't tested
- Catches assumptions early (the test might fail for unexpected reasons)
- Keeps implementation focused and minimal
- Creates a safety net before refactoring

**Anti-patterns to avoid:**

- Writing implementation before tests
- Writing tests that pass immediately (test the test!)
- Skipping the refactor step
- Writing multiple features before running tests

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

- `ast-grep` is installed, _use it as much as possible_ when editing, see ./docs/ast-grep-guide.md
  -
- Cypress is used for all E2E testing in `packages/demo/cypress/e2e/`
- **Firefox MCP** - Access live browser console logs from the dev server:
  - firefox-devtools_navigate_page to http://localhost:5173
  - firefox-devtools_list_console_messages (optionally filter with limit, level, textContains)
  - Can also take snapshots, interact with UI, monitor network requests

> Remember, though it is inspired by React, this is not recreating React nor implementing React APIs

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd sync
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
