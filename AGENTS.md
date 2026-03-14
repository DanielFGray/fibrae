# Agent Guidelines for fibrae

## Task Tracking

Use **prog** for all task tracking, planning, and issue management.

```bash
prog ready -p fibrae      # Find unblocked work
prog add "Title" -p fibrae # Create task
prog start <id>            # Claim work
prog log <id> "msg"        # Log progress
prog done <id>             # Complete work
```

Log unexpected errors, failing tests, or discovered bugs as prog issues.

## Git Workflow

Work on `develop`. The `main` branch is for releases only.

**NEVER push to any branch without explicit user direction.** The `main` branch requires a version bump or CI will fail to publish.

## Commands

```bash
bun run build                              # TypeScript compile
oxlint                                     # Lint check
bun run types:check                        # Type check all workspaces
cd packages/demo && bun cypress:run        # E2E tests (headless)
cd packages/demo && bun cypress:run --spec "cypress/e2e/<test>.cy.ts"  # Single test
```

After changes, verify build + lint + types pass. DO NOT pipe output through `head`/`tail`/`grep`. Assume vite dev server is already running.

## Project Overview

Effect-native JSX renderer where components are Effect programs with automatic reactivity.

> This is not React. Do not recreate React APIs.

Components return `VElement`, `Effect<VElement>`, or `Stream<VElement>`. Atom-based state with fine-grained re-rendering. Event handlers can return Effects (auto-forked by FibraeRuntime with full app context).

### Export Subpaths

| Subpath | Purpose |
|---------|---------|
| `fibrae` | render, Atom, Suspense, ErrorBoundary, ComponentScope |
| `fibrae/server` | renderToString, renderToStringWith, SSRAtomRegistryLayer |
| `fibrae/router` | Route, Router, RouterBuilder, Navigator, History, Link, RouterOutlet |
| `fibrae/live` | live atoms, SSE codec, serve/serveGroup |
| `fibrae/shared` | VElement types, error types |

### Key Source Files

| File | Purpose |
|------|---------|
| `packages/fibrae/src/fiber-render.ts` | Fiber reconciliation — render + commit phases, key-based diffing, hydration |
| `packages/fibrae/src/server.ts` | SSR renderToString |
| `packages/fibrae/src/core.ts` | render() public API — layer composition, service auto-detection |
| `packages/fibrae/src/runtime.ts` | FibraeRuntime service — fiber state, AtomOps, FiberSet runtime |
| `packages/fibrae/src/shared.ts` | Types: VElement, Fiber, ComponentScope, tagged errors |
| `packages/fibrae/src/components.ts` | Suspense, ErrorBoundary built-in components |
| `packages/fibrae/src/tracking.ts` | Atom tracking proxy, subscriptions |
| `packages/fibrae/src/dom.ts` | DOM property handling, event listener attachment |
| `packages/fibrae/src/h.ts` | JSX factory (h function) |
| `packages/fibrae/src/router/` | Route, Router, RouterBuilder, Navigator, History, Link, RouterOutlet, RouterState |
| `packages/fibrae/src/live/` | Live atoms, SSE codec, serve/serveGroup, client connect |
| `packages/demo/` | Demo app with SSR server and Cypress E2E tests |
| `packages/fibrae-cli/` | CLI tooling for SSG |

## Coding Style

**Idiomatic Effect:**
- `Effect.forEach`, `Effect.all`, `Effect.reduce`, `Effect.iterate` — not imperative for/while loops
- `pipe` chains and method syntax — not standalone function calls
- `Option.match`, `Option.map`, `Option.getOrElse` — not manual `if (Option.isNone(x))` checks
- `Effect.log` / `Effect.logError` — not `console.log` / `console.error`
- Tagged errors via `Data.TaggedError` and typed error channels
- Minimize `as` casts — fix inference at the source instead

**FP patterns:**
- `map`/`filter`/`reduce`/`flatMap` — not imperative loops with mutation
- `const` with pipe/match — not `let` with reassignment
- Use Effect stdlib: Stream, Scope, Deferred, Schedule, Mailbox, RcMap, etc.
- Don't reinvent what Effect already provides

**Atom patterns:**
- Prefer `Atom.get(atom)`, `Atom.set(atom, value)`, `Atom.update(atom, fn)` (Effect-based APIs)
- Over manual `yield* AtomRegistry.AtomRegistry` + `registry.get/set/update`
- Use `Atom.serializable` for SSR hydration
- Use `Atom.family` for parameterized atoms

## TDD: Red/Green/Refactor

1. **RED** — Write failing Cypress test first. Confirm it fails for the right reason.
2. **GREEN** — Write minimal code to pass. No over-engineering.
3. **REFACTOR** — Clean up while tests stay green.

## Session Completion

1. File prog issues for remaining work
2. Run quality gates (build, lint, types)
3. Update task status in prog
4. Commit changes (working directory clean)
5. Push only if explicitly requested
