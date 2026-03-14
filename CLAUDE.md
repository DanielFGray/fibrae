# fibrae

Effect-native JSX browser renderer with SSR, SSG, routing, live SSE sync, and automatic reactivity.

## Branches

- `develop` — v3 release branch (Effect v3 + @effect-atom/atom)
- `smol` — v4 rewrite (Effect 4.0.0-beta.8, uses `effect/unstable/reactivity`)
- `main` — releases only (requires version bump)

## Commands

```bash
bun run build         # TypeScript compile (packages/fibrae)
bun run types:check   # Type check all workspaces
oxlint                # Lint
cd packages/demo && bun cypress:run  # E2E tests
```

## Style

Write idiomatic Effect code. See AGENTS.md for full coding guidelines.

- FP patterns: map/reduce/pipe, not imperative loops
- Effect stdlib: forEach, all, reduce, iterate, Mailbox, RcMap — don't reinvent
- Atom APIs: prefer `Atom.get/set/update` (Effect-based) over manual registry access
- Tagged errors, pipe style, no console.log, minimize `as` casts
- Fix inference rather than casting

## Key Patterns

- JSX uses classic transform with `jsxInject` for fibrae/jsx-runtime
- `Layer.fresh()` prevents Layer memoization sharing state across render() calls
- `resubscribeFiber()` closes alternate's componentScope to prevent subscription leaks
- Event handlers can return Effects — forked with full app context via `runForkWithRuntime`
- Components return `VElement | Effect<VElement> | Stream<VElement>`
- Fiber.componentScope is `Scope.Closeable` (not just `Scope`)
- `FiberRef.currentContext` returns `Context<never>` — store and pass as `Context<never>`
