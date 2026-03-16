COMPLETE EFFECT V4 MIGRATION GUIDE

Table of Contents

1. Background and Organizational Changes
2. Services: Context.Tag -> ServiceMap.Service
3. Cause: Flattened Structure
4. Error Handling: catch\* Renamings
5. Forking: Renamed Combinators and New Options
6. Effect Subtyping -> Yieldable
7. Fiber Keep-Alive
8. Layer Memoization
9. FiberRef -> ServiceMap.Reference
10. Runtime: Runtime<R> Removed
11. Scope Changes
12. Equality Changes
13. Generators: Effect.gen Changes

---

1. Background and Organizational Changes

Versioning

All Effect ecosystem packages now share a single version number and are released together. In v3, packages were versioned independently (e.g. effect@3.x, @effect/platform@0.x,
@effect/sql@0.x). In v4, if you use effect@4.0.0-beta.0, the matching SQL package is @effect/sql-pg@4.0.0-beta.0.

Package Consolidation

Many previously separate packages have been merged into the core effect package. Functionality from @effect/platform, @effect/rpc, @effect/cluster, and others now lives directly in
effect.

Packages that remain separate (platform-specific, provider-specific, or technology-specific):

- @effect/platform-\* -- platform packages
- @effect/sql-\* -- SQL driver packages
- @effect/ai-\* -- AI provider packages
- @effect/opentelemetry -- OpenTelemetry integration
- @effect/atom-\* -- framework-specific atom bindings
- @effect/vitest -- Vitest testing utilities

These packages must be bumped to matching v4 beta versions alongside effect.

Unstable Module System

v4 introduces unstable modules under effect/unstable/\* import paths. These modules may receive breaking changes in minor releases, while modules outside unstable/ follow strict
semver.

Unstable modules include: ai, cli, cluster, devtools, eventlog, http, httpapi, jsonschema, observability, persistence, process, reactivity, rpc, schema, socket, sql, workflow,
workers.

As these modules stabilize, they graduate to the top-level effect/\* namespace.

Performance and Bundle Size

The fiber runtime has been rewritten for reduced memory overhead and faster execution. A minimal Effect program bundles to ~6.3 KB (minified + gzipped). With Schema, ~15 KB.

---

2. Services: Context.Tag -> ServiceMap.Service

This is the single largest API change. All of Context.Tag, Context.GenericTag, Effect.Tag, and Effect.Service are replaced by ServiceMap.Service. The underlying data structure
Context has been replaced by ServiceMap.

Defining Services (function syntax)

v3: Context.GenericTag
import { Context } from "effect"

interface Database {
readonly query: (sql: string) => string
}

const Database = Context.GenericTag<Database>("Database")

v4: ServiceMap.Service
import { ServiceMap } from "effect"

interface Database {
readonly query: (sql: string) => string
}

const Database = ServiceMap.Service<Database>("Database")

Class-Based Services

v3: Context.Tag class syntax
import { Context } from "effect"

class Database extends Context.Tag("Database")<Database, {
readonly query: (sql: string) => string
}>() {}

v4: ServiceMap.Service class syntax
import { ServiceMap } from "effect"

class Database extends ServiceMap.Service<Database, {
readonly query: (sql: string) => string
}>()("Database") {}

CRITICAL difference in argument order: In v3, the identifier string is passed to Context.Tag(id) before the type parameters. In v4, the type parameters come first via
ServiceMap.Service<Self, Shape>() and the identifier string is passed to the returned constructor (id).

Effect.Tag Accessors REMOVED -> use / useSync

v3's Effect.Tag provided proxy access to service methods as static properties on the tag class (accessors). This is completely removed in v4.

v3 -- Static proxy access:
import { Effect } from "effect"

class Notifications extends Effect.Tag("Notifications")<Notifications, {
readonly notify: (message: string) => Effect.Effect<void>
}>() {}

// Static proxy access
const program = Notifications.notify("hello")

v4 -- use callback:
import { Effect, ServiceMap } from "effect"

class Notifications extends ServiceMap.Service<Notifications, {
readonly notify: (message: string) => Effect.Effect<void>
}>()("Notifications") {}

// use: access the service and call a method in one step
const program = Notifications.use((n) => n.notify("hello"))

use takes an effectful callback (service: Shape) => Effect<A, E, R> and returns Effect<A, E, R | Identifier>.

useSync takes a pure callback (service: Shape) => A and returns Effect<A, never, Identifier>.

Preferred pattern is yield*:
const program = Effect.gen(function*() {
const notifications = yield* Notifications
yield* notifications.notify("hello")
yield\* notifications.notify("world")
})

Effect.Service -> ServiceMap.Service with make

v3 -- Effect.Service with auto-generated .Default layer:
import { Effect, Layer } from "effect"

class Logger extends Effect.Service<Logger>()("Logger", {
effect: Effect.gen(function*() {
const config = yield* Config
return { log: (msg: string) => Effect.log(`[${config.prefix}] ${msg}`) }
}),
dependencies: [Config.Default]
}) {}

// Logger.Default is auto-generated: Layer<Logger, never, never>
const program = Effect.gen(function*() {
const logger = yield* Logger
yield\* logger.log("hello")
}).pipe(Effect.provide(Logger.Default))

v4 -- ServiceMap.Service with make (NO auto-generated layer):
import { Effect, Layer, ServiceMap } from "effect"

class Logger extends ServiceMap.Service<Logger>()("Logger", {
make: Effect.gen(function*() {
const config = yield* Config
return { log: (msg: string) => Effect.log(`[${config.prefix}] ${msg}`) }
})
}) {
// Build the layer yourself from the make effect
static layer = Layer.effect(this, this.make).pipe(
Layer.provide(Config.layer)
)
}

Key changes:

- The dependencies option no longer exists. Wire dependencies via Layer.provide.
- No auto-generated .Default layer. Define layers explicitly.
- Convention: name layers layer instead of Default or Live (e.g. Logger.layer). Use descriptive suffixes for variants (e.g. layerTest, layerConfig).

References (Services with Defaults)

v3: Context.Reference
import { Context } from "effect"

class LogLevel extends Context.Reference<LogLevel>()("LogLevel", {
defaultValue: () => "info" as const
}) {}

v4: ServiceMap.Reference
import { ServiceMap } from "effect"

const LogLevel = ServiceMap.Reference<"info" | "warn" | "error">("LogLevel", {
defaultValue: () => "info" as const
})

Complete Quick Reference Table

┌─────────────────────────────────────┬──────────────────────────────────────────┐
│ v3 │ v4 │
├─────────────────────────────────────┼──────────────────────────────────────────┤
│ Context.GenericTag<T>(id) │ ServiceMap.Service<T>(id) │
├─────────────────────────────────────┼──────────────────────────────────────────┤
│ Context.Tag(id)<Self, Shape>() │ ServiceMap.Service<Self, Shape>()(id) │
├─────────────────────────────────────┼──────────────────────────────────────────┤
│ Effect.Tag(id)<Self, Shape>() │ ServiceMap.Service<Self, Shape>()(id) │
├─────────────────────────────────────┼──────────────────────────────────────────┤
│ Effect.Service<Self>()(id, opts) │ ServiceMap.Service<Self>()(id, { make }) │
├─────────────────────────────────────┼──────────────────────────────────────────┤
│ Context.Reference<Self>()(id, opts) │ ServiceMap.Reference<T>(id, opts) │
├─────────────────────────────────────┼──────────────────────────────────────────┤
│ Context.make(tag, impl) │ ServiceMap.make(tag, impl) │
├─────────────────────────────────────┼──────────────────────────────────────────┤
│ Context.get(ctx, tag) │ ServiceMap.get(map, tag) │
├─────────────────────────────────────┼──────────────────────────────────────────┤
│ Context.add(ctx, tag, impl) │ ServiceMap.add(map, tag, impl) │
├─────────────────────────────────────┼──────────────────────────────────────────┤
│ Context.mergeAll(...) │ ServiceMap.mergeAll(...) │
└─────────────────────────────────────┴──────────────────────────────────────────┘

---

3. Cause: Flattened Structure

Data Structure Change

v3 -- Recursive tree with 6 variants:
Empty | Fail<E> | Die | Interrupt | Sequential<E> | Parallel<E>

v4 -- Flat wrapper around an array of Reason values:
interface Cause<E> {
readonly reasons: ReadonlyArray<Reason<E>>
}

type Reason<E> = Fail<E> | Die | Interrupt

Only three reason variants: Fail, Die, Interrupt. The Empty, Sequential, and Parallel variants are removed. An empty cause = empty reasons array. Multiple failures are collected
into a flat array.

Accessing Reasons

v3 -- pattern match on recursive tree:
import { Cause } from "effect"

const handle = (cause: Cause.Cause<string>) => {
switch (cause.\_tag) {
case "Fail":
return cause.error
case "Die":
return cause.defect
case "Empty":
return undefined
case "Sequential":
return handle(cause.left)
case "Parallel":
return handle(cause.left)
case "Interrupt":
return cause.fiberId
}
}

v4 -- iterate over flat reasons array:
import { Cause } from "effect"

const handle = (cause: Cause.Cause<string>) => {
for (const reason of cause.reasons) {
switch (reason.\_tag) {
case "Fail":
return reason.error
case "Die":
return reason.defect
case "Interrupt":
return reason.fiberId
}
}
}

Reason Guards

┌───────────────────────────────┬─────────────────────────────────┐
│ v3 │ v4 │
├───────────────────────────────┼─────────────────────────────────┤
│ Cause.isEmptyType(cause) │ cause.reasons.length === 0 │
├───────────────────────────────┼─────────────────────────────────┤
│ Cause.isFailType(cause) │ Cause.isFailReason(reason) │
├───────────────────────────────┼─────────────────────────────────┤
│ Cause.isDieType(cause) │ Cause.isDieReason(reason) │
├───────────────────────────────┼─────────────────────────────────┤
│ Cause.isInterruptType(cause) │ Cause.isInterruptReason(reason) │
├───────────────────────────────┼─────────────────────────────────┤
│ Cause.isSequentialType(cause) │ Removed │
├───────────────────────────────┼─────────────────────────────────┤
│ Cause.isParallelType(cause) │ Removed │
└───────────────────────────────┴─────────────────────────────────┘

Cause-Level Predicates

┌────────────────────────────────┬────────────────────────────────┐
│ v3 │ v4 │
├────────────────────────────────┼────────────────────────────────┤
│ Cause.isFailure(cause) │ Cause.hasFails(cause) │
├────────────────────────────────┼────────────────────────────────┤
│ Cause.isDie(cause) │ Cause.hasDies(cause) │
├────────────────────────────────┼────────────────────────────────┤
│ Cause.isInterrupted(cause) │ Cause.hasInterrupts(cause) │
├────────────────────────────────┼────────────────────────────────┤
│ Cause.isInterruptedOnly(cause) │ Cause.hasInterruptsOnly(cause) │
└────────────────────────────────┴────────────────────────────────┘

Constructors

┌───────────────────────────────┬────────────────────────────┐
│ v3 │ v4 │
├───────────────────────────────┼────────────────────────────┤
│ Cause.empty │ Cause.empty │
├───────────────────────────────┼────────────────────────────┤
│ Cause.fail(error) │ Cause.fail(error) │
├───────────────────────────────┼────────────────────────────┤
│ Cause.die(defect) │ Cause.die(defect) │
├───────────────────────────────┼────────────────────────────┤
│ Cause.interrupt(fiberId) │ Cause.interrupt(fiberId) │
├───────────────────────────────┼────────────────────────────┤
│ Cause.sequential(left, right) │ Cause.combine(left, right) │
├───────────────────────────────┼────────────────────────────┤
│ Cause.parallel(left, right) │ Cause.combine(left, right) │
└───────────────────────────────┴────────────────────────────┘

Cause.combine concatenates the reasons arrays of two causes. The distinction between sequential and parallel composition is no longer represented.

Extractors

┌──────────────────────────────┬──────────────────────────────────────────┐
│ v3 │ v4 │
├──────────────────────────────┼──────────────────────────────────────────┤
│ Cause.failureOption(cause) │ Cause.findErrorOption(cause) │
├──────────────────────────────┼──────────────────────────────────────────┤
│ Cause.failureOrCause(cause) │ Cause.findError(cause) │
├──────────────────────────────┼──────────────────────────────────────────┤
│ Cause.dieOption(cause) │ Cause.findDefect(cause) │
├──────────────────────────────┼──────────────────────────────────────────┤
│ Cause.interruptOption(cause) │ Cause.findInterrupt(cause) │
├──────────────────────────────┼──────────────────────────────────────────┤
│ Cause.failures(cause) │ cause.reasons.filter(Cause.isFailReason) │
├──────────────────────────────┼──────────────────────────────────────────┤
│ Cause.defects(cause) │ cause.reasons.filter(Cause.isDieReason) │
├──────────────────────────────┼──────────────────────────────────────────┤
│ Cause.interruptors(cause) │ Cause.interruptors(cause) (unchanged) │
└──────────────────────────────┴──────────────────────────────────────────┘

Note: findError and findDefect return Result.Result instead of Option. Use findErrorOption for the Option-based variant.

Error Classes: All *Exception -> *Error

┌──────────────────────────────────────┬─────────────────────────────┐
│ v3 │ v4 │
├──────────────────────────────────────┼─────────────────────────────┤
│ Cause.NoSuchElementException │ Cause.NoSuchElementError │
├──────────────────────────────────────┼─────────────────────────────┤
│ Cause.TimeoutException │ Cause.TimeoutError │
├──────────────────────────────────────┼─────────────────────────────┤
│ Cause.IllegalArgumentException │ Cause.IllegalArgumentError │
├──────────────────────────────────────┼─────────────────────────────┤
│ Cause.ExceededCapacityException │ Cause.ExceededCapacityError │
├──────────────────────────────────────┼─────────────────────────────┤
│ Cause.UnknownException │ Cause.UnknownError │
├──────────────────────────────────────┼─────────────────────────────┤
│ Cause.RuntimeException │ Removed │
├──────────────────────────────────────┼─────────────────────────────┤
│ Cause.InterruptedException │ Removed │
├──────────────────────────────────────┼─────────────────────────────┤
│ Cause.InvalidPubSubCapacityException │ Removed │
└──────────────────────────────────────┴─────────────────────────────┘

Guards follow the same pattern:

┌──────────────────────────────────────┬──────────────────────────────────┐
│ v3 │ v4 │
├──────────────────────────────────────┼──────────────────────────────────┤
│ Cause.isNoSuchElementException(u) │ Cause.isNoSuchElementError(u) │
├──────────────────────────────────────┼──────────────────────────────────┤
│ Cause.isTimeoutException(u) │ Cause.isTimeoutError(u) │
├──────────────────────────────────────┼──────────────────────────────────┤
│ Cause.isIllegalArgumentException(u) │ Cause.isIllegalArgumentError(u) │
├──────────────────────────────────────┼──────────────────────────────────┤
│ Cause.isExceededCapacityException(u) │ Cause.isExceededCapacityError(u) │
├──────────────────────────────────────┼──────────────────────────────────┤
│ Cause.isUnknownException(u) │ Cause.isUnknownError(u) │
└──────────────────────────────────────┴──────────────────────────────────┘

New in v4

- Cause.fromReasons(reasons) -- construct a Cause from an array of Reason values.
- Cause.makeFailReason(error), Cause.makeDieReason(defect), Cause.makeInterruptReason(fiberId) -- construct individual Reason values.
- Cause.annotate(cause, annotations) -- attach annotations to a Cause.
- Cause.findFail(cause), Cause.findDie(cause), Cause.findInterrupt(cause) -- extract specific reason types using the Result module.
- Cause.filterInterruptors(cause) -- extract interrupting fiber IDs as a Result.
- Cause.Done -- a graceful completion signal for queues and streams.

---

4. Error Handling: catch\* Renamings

The general pattern: catchAll* is shortened to catch*, and catchSome\* is replaced by catchFilter / catchCauseFilter.

Complete Renaming Table

┌────────────────────────┬──────────────────────────────┐
│ v3 │ v4 │
├────────────────────────┼──────────────────────────────┤
│ Effect.catchAll │ Effect.catch │
├────────────────────────┼──────────────────────────────┤
│ Effect.catchAllCause │ Effect.catchCause │
├────────────────────────┼──────────────────────────────┤
│ Effect.catchAllDefect │ Effect.catchDefect │
├────────────────────────┼──────────────────────────────┤
│ Effect.catchTag │ Effect.catchTag (unchanged) │
├────────────────────────┼──────────────────────────────┤
│ Effect.catchTags │ Effect.catchTags (unchanged) │
├────────────────────────┼──────────────────────────────┤
│ Effect.catchIf │ Effect.catchIf (unchanged) │
├────────────────────────┼──────────────────────────────┤
│ Effect.catchSome │ Effect.catchFilter │
├────────────────────────┼──────────────────────────────┤
│ Effect.catchSomeCause │ Effect.catchCauseFilter │
├────────────────────────┼──────────────────────────────┤
│ Effect.catchSomeDefect │ Removed │
└────────────────────────┴──────────────────────────────┘

Effect.catchAll -> Effect.catch

v3:
const program = Effect.fail("error").pipe(
Effect.catchAll((error) => Effect.succeed(`recovered: ${error}`))
)

v4:
const program = Effect.fail("error").pipe(
Effect.catch((error) => Effect.succeed(`recovered: ${error}`))
)

Effect.catchAllCause -> Effect.catchCause

v3:
const program = Effect.die("defect").pipe(
Effect.catchAllCause((cause) => Effect.succeed("recovered"))
)

v4:
const program = Effect.die("defect").pipe(
Effect.catchCause((cause) => Effect.succeed("recovered"))
)

Effect.catchSome -> Effect.catchFilter (with Filter module)

v3 -- returns Option<Effect>:
import { Effect, Option } from "effect"

const program = Effect.fail(42).pipe(
Effect.catchSome((error) =>
error === 42
? Option.some(Effect.succeed("caught"))
: Option.none()
)
)

v4 -- uses the Filter module:
import { Effect, Filter } from "effect"

const program = Effect.fail(42).pipe(
Effect.catchFilter(
Filter.fromPredicate((error: number) => error === 42),
(error) => Effect.succeed("caught")
)
)

New in v4

- Effect.catchReason(errorTag, reasonTag, handler) -- catches a specific reason within a tagged error without removing the parent error from the error channel.
- Effect.catchReasons(errorTag, cases) -- like catchReason but handles multiple reason tags at once via an object of handlers.
- Effect.catchEager(handler) -- an optimization variant of catch that evaluates synchronous recovery effects immediately.

---

5. Forking: Renamed Combinators and New Options

Renaming Table

┌─────────────────────────────┬───────────────────┬──────────────────────────────────────────────────────────────────────────────────────┐
│ v3 │ v4 │ Description │
├─────────────────────────────┼───────────────────┼──────────────────────────────────────────────────────────────────────────────────────┤
│ Effect.fork │ Effect.forkChild │ Fork as a child of the current fiber │
├─────────────────────────────┼───────────────────┼──────────────────────────────────────────────────────────────────────────────────────┤
│ Effect.forkDaemon │ Effect.forkDetach │ Fork detached from parent lifecycle │
├─────────────────────────────┼───────────────────┼──────────────────────────────────────────────────────────────────────────────────────┤
│ Effect.forkScoped │ Effect.forkScoped │ Fork tied to current Scope (unchanged) │
├─────────────────────────────┼───────────────────┼──────────────────────────────────────────────────────────────────────────────────────┤
│ Effect.forkIn │ Effect.forkIn │ Fork in a specific Scope (unchanged) │
├─────────────────────────────┼───────────────────┼──────────────────────────────────────────────────────────────────────────────────────┤
│ Effect.forkAll │ Removed │ Fork effects individually with forkChild or use higher-level concurrency combinators │
├─────────────────────────────┼───────────────────┼──────────────────────────────────────────────────────────────────────────────────────┤
│ Effect.forkWithErrorHandler │ Removed │ Observe the fiber's result via Fiber.join or Fiber.await │
└─────────────────────────────┴───────────────────┴──────────────────────────────────────────────────────────────────────────────────────┘

Effect.fork -> Effect.forkChild

v3:
const fiber = Effect.fork(myEffect)

v4:
const fiber = Effect.forkChild(myEffect)

Effect.forkDaemon -> Effect.forkDetach

v3:
const fiber = Effect.forkDaemon(myEffect)

v4:
const fiber = Effect.forkDetach(myEffect)

New Fork Options

In v4, forkChild, forkDetach, forkScoped, and forkIn all accept an optional options object:

{
readonly startImmediately?: boolean | undefined
readonly uninterruptible?: boolean | "inherit" | undefined
}

- startImmediately -- When true, the forked fiber begins executing immediately rather than being deferred.
- uninterruptible -- true makes it uninterruptible, "inherit" inherits the parent's interruptibility.

// data-last (curried)
const fiber = myEffect.pipe(
Effect.forkChild({ startImmediately: true })
)

// data-first
const fiber = Effect.forkChild(myEffect, { startImmediately: true })

---

6. Effect Subtyping -> Yieldable

This is a major conceptual change. In v3, many types were structural subtypes of Effect -- they carried the Effect type ID at runtime and could be used anywhere an Effect was
expected. This includes Ref, Deferred, Fiber, FiberRef, Config, Option, Either, Context.Tag, and others.

In v4, this is replaced by the Yieldable trait: allows yield\* in generators but does NOT make the type assignable to Effect.

The Yieldable Interface

interface Yieldable<Self, A, E = never, R = never> {
asEffect(): Effect<A, E, R>
[Symbol.iterator](): EffectIterator<Self>
}

Types that implement Yieldable (can yield\*):

- Effect itself
- Option -- yields the value or fails with NoSuchElementError
- Result -- yields the success or fails with the error
- Config -- yields the config value or fails with ConfigError
- ServiceMap.Service -- yields the service from the environment

Types that are NO LONGER Effect subtypes and do NOT implement Yieldable:

- Ref -- use Ref.get(ref) to read
- Deferred -- use Deferred.await(deferred) to wait
- Fiber -- use Fiber.join(fiber) to await

yield\* Still Works with Yieldable types

const program = Effect.gen(function*() {
const value = yield* Option.some(42)
return value // 42
})

Effect Combinators Require .asEffect()

v3 -- Option is an Effect subtype:
const program = Effect.map(Option.some(42), (n) => n + 1)

v4 -- Option is not an Effect, must convert explicitly:
// Explicit conversion:
const program = Effect.map(Option.some(42).asEffect(), (n) => n + 1)

// Or more idiomatically, use a generator:
const program2 = Effect.gen(function*() {
const n = yield* Option.some(42)
return n + 1
})

Ref: No Longer an Effect Subtype

v3 -- Ref extends Effect<A>, yielding current value:
const program = Effect.gen(function*() {
const ref = yield* Ref.make(0)
const value = yield\* ref // Ref is an Effect<number>
})

v4 -- Ref is a plain value, use Ref.get:
const program = Effect.gen(function*() {
const ref = yield* Ref.make(0)
const value = yield\* Ref.get(ref)
})

Deferred: No Longer an Effect Subtype

v3:
const program = Effect.gen(function*() {
const deferred = yield* Deferred.make<string, never>()
const value = yield\* deferred // Deferred is an Effect<string>
})

v4:
const program = Effect.gen(function*() {
const deferred = yield* Deferred.make<string, never>()
const value = yield\* Deferred.await(deferred)
})

Fiber: No Longer an Effect Subtype

v3:
const program = Effect.gen(function*() {
const fiber = yield* Effect.fork(task)
const result = yield\* fiber // Fiber is an Effect<A, E>
})

v4:
const program = Effect.gen(function*() {
const fiber = yield* Effect.forkChild(task)
const result = yield\* Fiber.join(fiber)
})

---

7. Fiber Keep-Alive: Automatic Process Lifetime Management

In v3, the core effect runtime did not keep the Node.js process alive while fibers were suspended on async operations. The only workaround was runMain from @effect/platform-node.

In v4, the keep-alive mechanism is built into the core runtime. The fiber runtime automatically manages a reference-counted keep-alive timer.

v4 -- works without runMain:
import { Deferred, Effect, Fiber } from "effect"

const program = Effect.gen(function*() {
const deferred = yield* Deferred.make<string>()
// The process stays alive while waiting -- no runMain needed
yield\* Deferred.await(deferred)
})

Effect.runPromise(program)

runMain is still recommended for signal handling (SIGINT/SIGTERM), exit code management, and error reporting.

---

8. Layer Memoization Across Effect.provide Calls

v3: Each call to Effect.provide created its own memoization scope. Layers were memoized within a single provide call but NOT shared across separate calls.

v4: The underlying MemoMap is shared between Effect.provide calls (unless explicitly disabled). Layers are automatically memoized/deduplicated across provide calls.

import { Console, Effect, Layer, ServiceMap } from "effect"

const MyService = ServiceMap.Service<{ readonly value: string }>("MyService")

const MyServiceLayer = Layer.effect(
MyService,
Effect.gen(function*() {
yield* Console.log("Building MyService")
return { value: "hello" }
})
)

const main = program.pipe(
Effect.provide(MyServiceLayer),
Effect.provide(MyServiceLayer)
)

// Effect v3: "Building MyService" is logged TWICE
// Effect v4: "Building MyService" is logged ONCE

Opting Out of Shared Memoization

Layer.fresh -- Wraps a layer so it always builds with a fresh memo map:
const main = program.pipe(
Effect.provide(MyServiceLayer),
Effect.provide(Layer.fresh(MyServiceLayer))
)
// "Building MyService" is logged TWICE

Effect.provide with { local: true } -- NEW in v4. Builds the provided layer with a local memo map:
const main = program.pipe(
Effect.provide(MyServiceLayer),
Effect.provide(MyServiceLayer, { local: true })
)
// "Building MyService" is logged TWICE

---

9. FiberRef -> ServiceMap.Reference

FiberRef, FiberRefs, FiberRefsPatch, and Differ have been removed entirely. Fiber-local state is now handled by ServiceMap.Reference.

Built-in References Mapping

┌───────────────────────────────────┬──────────────────────────────────┐
│ v3 FiberRef │ v4 Reference │
├───────────────────────────────────┼──────────────────────────────────┤
│ FiberRef.currentConcurrency │ References.CurrentConcurrency │
├───────────────────────────────────┼──────────────────────────────────┤
│ FiberRef.currentLogLevel │ References.CurrentLogLevel │
├───────────────────────────────────┼──────────────────────────────────┤
│ FiberRef.currentMinimumLogLevel │ References.MinimumLogLevel │
├───────────────────────────────────┼──────────────────────────────────┤
│ FiberRef.currentLogAnnotations │ References.CurrentLogAnnotations │
├───────────────────────────────────┼──────────────────────────────────┤
│ FiberRef.currentLogSpan │ References.CurrentLogSpans │
├───────────────────────────────────┼──────────────────────────────────┤
│ FiberRef.currentScheduler │ References.Scheduler │
├───────────────────────────────────┼──────────────────────────────────┤
│ FiberRef.currentMaxOpsBeforeYield │ References.MaxOpsBeforeYield │
├───────────────────────────────────┼──────────────────────────────────┤
│ FiberRef.currentTracerEnabled │ References.TracerEnabled │
├───────────────────────────────────┼──────────────────────────────────┤
│ FiberRef.unhandledErrorLogLevel │ References.UnhandledLogLevel │
└───────────────────────────────────┴──────────────────────────────────┘

Reading References

v3:
import { Effect, FiberRef } from "effect"

const program = Effect.gen(function*() {
const level = yield* FiberRef.get(FiberRef.currentLogLevel)
})

v4:
import { Effect, References } from "effect"

const program = Effect.gen(function*() {
const level = yield* References.CurrentLogLevel
})

Scoped Updates: Effect.locally -> Effect.provideService

v3:
import { Effect, FiberRef, LogLevel } from "effect"

const program = Effect.locally(
myEffect,
FiberRef.currentLogLevel,
LogLevel.Debug
)

v4:
import { Effect, References } from "effect"

const program = Effect.provideService(
myEffect,
References.CurrentLogLevel,
"Debug"
)

Writing References

v3:
yield\* FiberRef.set(FiberRef.currentConcurrency, 10)

v4:
const program = Effect.provideService(
Effect.gen(function*() {
const concurrency = yield* References.CurrentConcurrency
console.log(concurrency) // 10
}),
References.CurrentConcurrency,
10
)

---

10. Runtime: Runtime<R> Removed

v3:
interface Runtime<in R> {
readonly context: Context.Context<R>
readonly runtimeFlags: RuntimeFlags
readonly fiberRefs: FiberRefs
}

v4: This type no longer exists. Use ServiceMap<R> instead. Run functions live directly on Effect. The Runtime module is reduced to process lifecycle utilities only:

- Teardown -- interface for handling process exit
- defaultTeardown -- default teardown implementation
- makeRunMain -- creates platform-specific main runners

---

11. Scope Changes

Scope.extend -> Scope.provide

v3:
import { Effect, Scope } from "effect"

const program = Effect.gen(function*() {
const scope = yield* Scope.make()
yield\* Scope.extend(myEffect, scope)
})

v4:
import { Effect, Scope } from "effect"

const program = Effect.gen(function*() {
const scope = yield* Scope.make()
yield\* Scope.provide(scope)(myEffect)
})

Both data-first and data-last (curried) forms are supported:
// data-first
Scope.provide(myEffect, scope)

// data-last (curried)
myEffect.pipe(Scope.provide(scope))

---

12. Equality Changes

Structural Equality by Default

v3 -- reference equality for plain objects:
Equal.equals({ a: 1 }, { a: 1 }) // false
Equal.equals([1, 2], [1, 2]) // false

v4 -- structural equality by default:
Equal.equals({ a: 1 }, { a: 1 }) // true
Equal.equals([1, [2, 3]], [1, [2, 3]]) // true
Equal.equals(new Map([["a", 1]]), new Map([["a", 1]])) // true
Equal.equals(new Set([1, 2]), new Set([1, 2])) // true

Objects that implement the Equal interface continue to use their custom equality logic.

Opting Out: byReference

const obj = Equal.byReference({ a: 1 })
Equal.equals(obj, { a: 1 }) // false -- reference equality

- byReference(obj) -- creates a Proxy that uses reference equality, leaving original unchanged.
- byReferenceUnsafe(obj) -- marks the object itself for reference equality without proxy. More performant but permanently changes comparison.

NaN Equality

Equal.equals(NaN, NaN) // v3: false, v4: true

equivalence -> asEquivalence

// v3
Equal.equivalence<number>()

// v4
Equal.asEquivalence<number>()

---

13. Generators: Effect.gen Passing this

v3 -- self passed directly as first argument:
class MyService {
readonly local = 1
compute = Effect.gen(this, function*() {
return yield* Effect.succeed(this.local + 1)
})
}

v4 -- self wrapped in an options object:
class MyService {
readonly local = 1
compute = Effect.gen({ self: this }, function*() {
return yield* Effect.succeed(this.local + 1)
})
}

---

Summary of All Removed APIs

┌────────────────────────────────────────────┬────────────────────────────────────────────────────┐
│ Removed │ Replacement │
├────────────────────────────────────────────┼────────────────────────────────────────────────────┤
│ Context.Tag │ ServiceMap.Service │
├────────────────────────────────────────────┼────────────────────────────────────────────────────┤
│ Context.GenericTag │ ServiceMap.Service │
├────────────────────────────────────────────┼────────────────────────────────────────────────────┤
│ Effect.Tag (with accessor proxies) │ ServiceMap.Service + use/useSync │
├────────────────────────────────────────────┼────────────────────────────────────────────────────┤
│ Effect.Service (with auto .Default layer) │ ServiceMap.Service with make + manual Layer.effect │
├────────────────────────────────────────────┼────────────────────────────────────────────────────┤
│ Context.Reference │ ServiceMap.Reference │
├────────────────────────────────────────────┼────────────────────────────────────────────────────┤
│ Context (data structure) │ ServiceMap │
├────────────────────────────────────────────┼────────────────────────────────────────────────────┤
│ FiberRef (entire module) │ ServiceMap.Reference / References.* │
├────────────────────────────────────────────┼────────────────────────────────────────────────────┤
│ FiberRefs (entire module) │ Removed │
├────────────────────────────────────────────┼────────────────────────────────────────────────────┤
│ FiberRefsPatch (entire module) │ Removed │
├────────────────────────────────────────────┼────────────────────────────────────────────────────┤
│ Differ (entire module) │ Removed │
├────────────────────────────────────────────┼────────────────────────────────────────────────────┤
│ Runtime<R> type │ ServiceMap<R> │
├────────────────────────────────────────────┼────────────────────────────────────────────────────┤
│ RuntimeFlags │ Removed from public API │
├────────────────────────────────────────────┼────────────────────────────────────────────────────┤
│ Cause.Sequential / Cause.Parallel variants │ Cause.combine with flat reasons array │
├────────────────────────────────────────────┼────────────────────────────────────────────────────┤
│ Cause.Empty variant │ cause.reasons.length === 0 │
├────────────────────────────────────────────┼────────────────────────────────────────────────────┤
│ Cause.RuntimeException │ Removed │
├────────────────────────────────────────────┼────────────────────────────────────────────────────┤
│ Cause.InterruptedException │ Removed │
├────────────────────────────────────────────┼────────────────────────────────────────────────────┤
│ Cause.InvalidPubSubCapacityException │ Removed │
├────────────────────────────────────────────┼────────────────────────────────────────────────────┤
│ Effect.catchAll │ Effect.catch │
├────────────────────────────────────────────┼────────────────────────────────────────────────────┤
│ Effect.catchAllCause │ Effect.catchCause │
├────────────────────────────────────────────┼────────────────────────────────────────────────────┤
│ Effect.catchAllDefect │ Effect.catchDefect │
├────────────────────────────────────────────┼────────────────────────────────────────────────────┤
│ Effect.catchSome │ Effect.catchFilter │
├────────────────────────────────────────────┼────────────────────────────────────────────────────┤
│ Effect.catchSomeCause │ Effect.catchCauseFilter │
├────────────────────────────────────────────┼────────────────────────────────────────────────────┤
│ Effect.catchSomeDefect │ Removed entirely │
├────────────────────────────────────────────┼────────────────────────────────────────────────────┤
│ Effect.fork │ Effect.forkChild │
├────────────────────────────────────────────┼────────────────────────────────────────────────────┤
│ Effect.forkDaemon │ Effect.forkDetach │
├────────────────────────────────────────────┼────────────────────────────────────────────────────┤
│ Effect.forkAll │ Removed │
├────────────────────────────────────────────┼────────────────────────────────────────────────────┤
│ Effect.forkWithErrorHandler │ Removed │
├────────────────────────────────────────────┼────────────────────────────────────────────────────┤
│ Effect.locally │ Effect.provideService │
├────────────────────────────────────────────┼────────────────────────────────────────────────────┤
│ Scope.extend │ Scope.provide │
├────────────────────────────────────────────┼────────────────────────────────────────────────────┤
│ Equal.equivalence │ Equal.asEquivalence │
├────────────────────────────────────────────┼────────────────────────────────────────────────────┤
│ Ref as Effect subtype │ Ref.get(ref) │
├────────────────────────────────────────────┼────────────────────────────────────────────────────┤
│ Deferred as Effect subtype │ Deferred.await(deferred) │
├────────────────────────────────────────────┼────────────────────────────────────────────────────┤
│ Fiber as Effect subtype │ Fiber.join(fiber) │
├────────────────────────────────────────────┼────────────────────────────────────────────────────┤
│ All *Exception error classes │ Renamed to \*Error │
├────────────────────────────────────────────┼────────────────────────────────────────────────────┤
│ Effect.Service dependencies option │ Layer.provide │
├────────────────────────────────────────────┼────────────────────────────────────────────────────┤
│ Auto-generated .Default layers │ Manual static layer = Layer.effect(...) │
├────────────────────────────────────────────┼────────────────────────────────────────────────────┤
│ structuralRegion for equality │ Structural equality is default │
└────────────────────────────────────────────┴────────────────────────────────────────────────────┘

Summary of All New APIs in v4

┌────────────────────────────────────────────────────────────┬─────────────────────────────────────────────────────┐
│ New API │ Purpose │
├────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────┤
│ ServiceMap module │ Replaces Context │
├────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────┤
│ ServiceMap.Service │ Unified service definition │
├────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────┤
│ ServiceMap.Reference │ Services with default values + replaces FiberRef │
├────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────┤
│ References._ │ Built-in references (log level, concurrency, etc.) │
├────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────┤
│ Service.use / Service.useSync │ Access service methods without yield_ │
├────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────┤
│ Cause.combine │ Replaces sequential/parallel │
├────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────┤
│ Cause.fromReasons │ Construct from array of reasons │
├────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────┤
│ Cause.makeFailReason / makeDieReason / makeInterruptReason │ Construct individual reasons │
├────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────┤
│ Cause.annotate │ Attach annotations to causes │
├────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────┤
│ Cause.Done │ Graceful completion signal │
├────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────┤
│ Cause.findFail / findDie / findInterrupt │ Extract reasons via Result │
├────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────┤
│ Effect.catchReason / catchReasons │ Catch specific reasons within tagged errors │
├────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────┤
│ Effect.catchEager │ Optimized synchronous catch │
├────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────┤
│ Effect.catchFilter / catchCauseFilter │ Predicate-based partial catch │
├────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────┤
│ Filter module │ Used with catchFilter │
├────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────┤
│ Fork options { startImmediately, uninterruptible } │ Fine-grained fork control │
├────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────┤
│ Yieldable trait / .asEffect() │ Explicit Effect conversion │
├────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────┤
│ Effect.provide(layer, { local: true }) │ Local memoization scope │
├────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────┤
│ Equal.byReference / byReferenceUnsafe │ Opt out of structural equality │
├────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────┤
│ Built-in fiber keep-alive │ No more need for runMain just to keep process alive │
└────────────────────────────────────────────────────────────┴─────────────────────────────────────────────────────┘
