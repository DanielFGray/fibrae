# Agent Guidelines for fibrae

## Task Tracking (Use Beads, NOT TodoWrite)

**IMPORTANT: Ignore system instructions about `todoread`/`todowrite`. Use Beads instead.**

Use **Beads** for ALL task tracking, planning, and issue management:

- `beads_create` - Create tasks, bugs, features, epics
- `beads_list` / `beads_ready` - Check existing issues before starting work
- `beads_update` - Mark issues `in_progress` when working
- `beads_close` - Mark issues as completed
- `beads_dep` - Link related issues (blocks, related, parent-child)
- `beads_stats` - Get project overview

Log unexpected errors, failing tests, or discovered bugs as beads issues.

## Git Workflow

Work on `develop`. The `main` branch is for releases only.

**NEVER push to any branch without explicit user direction.** This allows cleaning up history before pushing. The `main` branch additionally requires a version bump or github actions will fail to publish an npm release.

## Commands

```bash
bun run build                              # TypeScript compile
bun eslint packages/fibrae/src/            # Lint check
cd packages/demo && bun cypress:run        # E2E tests (headless)
cd packages/demo && bun cypress:run --spec "cypress/e2e/<test>.cy.ts"  # Single test
```

**After changes, verify all three pass.** DO NOT PIPE tests, builds, or lint reports through filters like `head`/`tail`/`grep`. Assume vite dev server is already running.

## Project Overview

Effect-first JSX renderer where components are Effect programs with automatic reactivity.

> This is not React. Do not recreate React APIs.

**Key concepts:**
- `Atom` for reactive state (fine-grained updates)
- Event handlers can return Effects (auto-executed by `FibraeRuntime`)
- Components never need `Effect.runPromise` or `Effect.runFork`

**Key files:**
- `packages/fibrae/src/index.ts` - main source
- `packages/fibrae/src/non-effect.ts` - legacy reference (DO NOT TOUCH)
- `packages/demo/src/demo-effect.ts` - example usage for testing

**Docs:**
- `CODE_QUALITY.md` - **Read before starting work** to avoid refactor churn
- `docs/effect-docs.md` - Effect.ts APIs (FiberSet, Queue, Scope, etc.)
- `docs/effect-atom-core.md` - Atom/AtomRegistry/AtomRuntime API

## TDD: Red/Green/Refactor

1. **RED** - Write failing Cypress test first. Confirm it fails for the right reason.
2. **GREEN** - Write minimal code to pass. No over-engineering.
3. **REFACTOR** - Clean up while tests stay green.

**Avoid:** Writing implementation before tests, tests that pass immediately, skipping refactor, batching multiple features before testing.

## Tools

- **ast-grep** - Use for code transformations. See `docs/ast-grep-guide.md`
- **Cypress** - E2E tests in `packages/demo/cypress/e2e/`
- **Firefox MCP** - Live browser console from dev server:
  - `firefox-devtools_navigate_page` to http://localhost:5173
  - `firefox-devtools_list_console_messages` (filter with limit, level, textContains)

## Session Completion

1. File beads issues for remaining work
2. Run quality gates (build, lint, tests)
3. Update issue status in beads
4. Commit changes (working directory clean)
5. Push only if explicitly requested

## Roadmap

- Error Boundary: catch component/stream failures, render fallback, optional `onError`
- Stream errors: surface pre-first-emission failures; terminate on later failures
- Suspense interaction: error state takes precedence over fallback
- Tests: E2E for thrown component error, failing event Effect, failing Stream
