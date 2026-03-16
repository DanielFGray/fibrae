# Effect v4 Migration Design

## Goal

Migrate fibrae from Effect v3 (3.19.x) to Effect v4 beta (4.0.0-beta.x). Big-bang migration on a feature branch.

## Strategy

**Approach B: Migrate core, shim effect-atom.**

- Migrate all fibrae-owned code to v4 APIs
- Keep `@effect-atom/atom` at current version (0.5.x) with peer dep overrides
- If atom breaks at the v4 boundary, isolate behind a wrapper module
- Migrate Schema usage alongside core migration

## Dependency Changes

| Package                    | v3 Version | v4 Target                     |
| -------------------------- | ---------- | ----------------------------- |
| `effect`                   | 3.19.x     | 4.0.0-beta.8+                 |
| `@effect/platform`         | ^0.94.5    | 4.0.0-beta.x (unified)        |
| `@effect/platform-browser` | ^0.74.0    | 4.0.0-beta.x                  |
| `@effect/platform-bun`     | ^0.87.1    | 4.0.0-beta.x                  |
| `@effect/platform-node`    | ^0.104.1   | 4.0.0-beta.x                  |
| `@effect/language-service` | ^0.55.3    | v4-compatible                 |
| `@effect-atom/atom`        | 0.5.x      | **Keep as-is** with overrides |

Add to package.json:

```json
"overrides": {
  "@effect-atom/atom": {
    "effect": "$effect"
  }
}
```

## API Migration Map

### Services: Context.Tag -> ServiceMap.Service

**All service definitions** across fibrae:

| File                     | Current                                                                      | Target                                                                                   |
| ------------------------ | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `runtime.ts`             | `Effect.Service<FibraeRuntime>()("FibraeRuntime", { scoped, dependencies })` | `ServiceMap.Service<FibraeRuntime>()("FibraeRuntime", { make })` + manual `static layer` |
| `components.ts`          | `Context.Tag("fibrae/ComponentScope")<ComponentScope, ...>()`                | `ServiceMap.Service<ComponentScope, ...>()("fibrae/ComponentScope")`                     |
| Router: `Navigator.ts`   | `Context.Tag`                                                                | `ServiceMap.Service`                                                                     |
| Router: `History.ts`     | `Context.Tag`                                                                | `ServiceMap.Service`                                                                     |
| Router: `Router.ts`      | `Context.Tag`                                                                | `ServiceMap.Service`                                                                     |
| Router: `RouterState.ts` | `Context.Tag`                                                                | `ServiceMap.Service`                                                                     |

The `dependencies` option is removed. Wire dependencies via `Layer.provide` on a static `layer` property.

### FiberRef Elimination (Critical)

`FiberRef` module is **removed entirely** in v4.

Current usage in fibrae:

- `FiberRef.get(FiberRef.currentContext)` — captures full context for child fiber propagation
- Replace with v4 equivalent (likely `Effect.context` to get `ServiceMap`, or a `References.*` built-in)
- This requires research into v4 source to find the exact replacement

### Cause: Flat Model

| Current                   | Target                                                    |
| ------------------------- | --------------------------------------------------------- |
| `Cause.squash(cause)`     | Iterate `cause.reasons` or `Cause.findErrorOption(cause)` |
| `Cause.isFailType(cause)` | `Cause.isFailReason(reason)` on individual reasons        |

### Error Handling Renames

| v3                     | v4                  |
| ---------------------- | ------------------- |
| `Effect.catchAll`      | `Effect.catch`      |
| `Effect.catchAllCause` | `Effect.catchCause` |

### Forking Renames

| v3                  | v4                  |
| ------------------- | ------------------- |
| `Effect.fork`       | `Effect.forkChild`  |
| `Effect.forkDaemon` | `Effect.forkDetach` |
| `Effect.forkIn`     | unchanged           |
| `Effect.forkScoped` | unchanged           |

### Yieldable: Subtypes No Longer Effect

| Type       | v3 Pattern        | v4 Pattern                        |
| ---------- | ----------------- | --------------------------------- |
| `Ref`      | `yield* ref`      | `yield* Ref.get(ref)`             |
| `Deferred` | `yield* deferred` | `yield* Deferred.await(deferred)` |
| `Fiber`    | `yield* fiber`    | `yield* Fiber.join(fiber)`        |

### Scope

| v3                            | v4                                                               |
| ----------------------------- | ---------------------------------------------------------------- |
| `Scope.extend(effect, scope)` | `Scope.provide(scope)(effect)` or `Scope.provide(effect, scope)` |

### Equality

Structural equality is now default. `Equal.equals({a:1}, {a:1})` returns `true` in v4. This shouldn't break fibrae but may affect atom comparison behavior.

### Effect.gen with `this`

| v3                                    | v4                                              |
| ------------------------------------- | ----------------------------------------------- |
| `Effect.gen(this, function*() {...})` | `Effect.gen({ self: this }, function*() {...})` |

### Layer Memoization

v4 shares memoization across `Effect.provide` calls by default. Use `Layer.fresh(layer)` or `Effect.provide(layer, { local: true })` to opt out.

### Schema (v4 rewrite)

| Area                  | Change                                                             |
| --------------------- | ------------------------------------------------------------------ |
| Inline `.transform()` | `SchemaTransformation` module                                      |
| Optional fields       | `Schema.optionalKey()` / `Schema.optional()`                       |
| Class syntax          | `Schema.Class<T>("name")({...})`                                   |
| `withDefault`         | `Schema.withDecodingDefault()` / `Schema.withConstructorDefault()` |

Fibrae's Schema usage is limited to route params and tests — scope is manageable.

## Migration Phases

### Phase 1: Dependencies & Infrastructure

1. Create branch `feat/effect-v4-migration`
2. Bump Effect packages to v4 beta in catalog
3. Add overrides for effect-atom peer deps
4. `bun install`

### Phase 2: Core Type System (shared types, services)

5. `shared.ts` — error types
6. `components.ts` — ComponentScope to ServiceMap.Service
7. `runtime.ts` — FibraeRuntime to ServiceMap.Service + manual layer

### Phase 3: FiberRef Elimination

8. Research v4 equivalent for `FiberRef.currentContext`
9. `core.ts` — replace FiberRef context capture
10. `fiber-render.ts` — same + Cause migration

### Phase 4: Rendering Pipeline

11. `fiber-render.ts` — fork renames, Deferred.await, catch renames
12. `render.ts` — same patterns
13. `hydration.ts` — Stream/Scope patterns
14. `tracking.ts` — Scope/atom integration
15. `scope-utils.ts` — Scope.extend -> Scope.provide
16. `dom.ts` — minimal changes

### Phase 5: Router

17. All router modules — ServiceMap.Service, Layer patterns
18. `Route.ts` — Schema migration for route params

### Phase 6: Schema & Tests

19. Schema usage in route definitions
20. Test file updates
21. Demo app updates

### Phase 7: Verification

22. Type-check passes
23. Tests pass
24. Demo app renders

## Risks & Mitigations

| Risk                                                  | Mitigation                                                               |
| ----------------------------------------------------- | ------------------------------------------------------------------------ |
| `@effect-atom/atom` breaks with v4 runtime            | Isolate behind wrapper module; fork if necessary                         |
| `FiberRef.currentContext` has no direct v4 equivalent | Research v4 source; may need architectural change to context propagation |
| `FiberSet` API changes                                | Verify in v4; may move to `effect/unstable/*`                            |
| Stream API changes not documented                     | Stream module appears stable; verify at migration time                   |
| v4 beta instability                                   | Pin exact beta version; monitor for breaking changes                     |

## References

- [Effect v4 Beta Blog Post](https://effect.website/blog/releases/effect/40-beta/)
- [MIGRATION.md](https://github.com/Effect-TS/effect-smol/blob/main/MIGRATION.md)
- [Schema v4 Guide](https://github.com/Effect-TS/effect-smol/blob/main/packages/effect/SCHEMA.md)
- [effect-atom repo](https://github.com/tim-smart/effect-atom)
