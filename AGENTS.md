# fibrae

Effect-native JSX browser renderer with SSR, SSG, routing, live SSE sync, and automatic reactivity.

## Branches

- `develop` — default branch, day-to-day development
- `main` — release branch (merge develop → main triggers release-please → npm publish)
- `smol` — v4 rewrite (Effect 4.0.0-beta.8, uses `effect/unstable/reactivity`)

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
- `Schema.TaggedError` for all errors — never `Data.TaggedError`, never `throw new Error`
- `Schema.decodeUnknown` (Effect-returning) — never sync decode variants
- Pipe style, no console.log, minimize `as` casts — fix inference rather than casting
- Casts belong at type-erasure boundaries in the library, never in consumer code

## Key Patterns

- JSX uses classic transform with `jsxInject` for fibrae/jsx-runtime
- JSX event handlers accept both `onClick` and `onclick`, can return Effects
- `Layer.fresh()` prevents Layer memoization sharing state across render() calls
- `resubscribeFiber()` closes alternate's componentScope to prevent subscription leaks
- Event handlers can return Effects — forked with full app context via `runForkWithRuntime`
- Components return `VElement | Effect<VElement> | Stream<VElement>`
- Fiber.componentScope is `Scope.Closeable` (not just `Scope`)
- `FiberRef.currentContext` returns `Context<never>` — store and pass as `Context<never>`
- Link uses real paths: `<Link href="/posts/42">` — type-safe via `RegisteredRouter` + `PatternToHref`
- Router/RouteGroup accumulate route paths as literal types — `<Link href="/typo">` is a type error
- `RouterBuilder.group()` takes RouteGroup directly (not string name) for type-safe `handle()`
- `Route.match`/`interpolate` return Effects — `RouteError` for failures
- `RouteHandler` stores Effects with R=never (type erasure boundary in `handle()`)
