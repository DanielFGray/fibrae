/**
 * Type test: verify h() preserves Effect channels.
 * Checked by `bun --filter demo types:check`, never imported at runtime.
 */
import * as Effect from "effect/Effect";
import * as Context from "effect/Context";
import * as Schema from "effect/Schema";
import type { VElement } from "fibrae/shared";
import { h } from "fibrae";

// === Test services/errors ===

class Auth extends Context.Tag("Auth")<Auth, { readonly userId: string }>() {}
class Db extends Context.Tag("Db")<Db, { readonly query: (sql: string) => string }>() {}

class NotFound extends Schema.TaggedError<NotFound>()("NotFound", {
  id: Schema.String,
}) {}

// === Components ===

const NeedsAuth = (_props: {}) =>
  Effect.gen(function* () {
    const auth = yield* Auth;
    return h.div(`User: ${auth.userId}`);
  });

const NeedsDb = (_props: {}) =>
  Effect.gen(function* () {
    const db = yield* Db;
    return h.span(db.query("SELECT 1"));
  });

const MightFail = (_props: {}) =>
  Effect.gen(function* () {
    yield* Effect.fail(new NotFound({ id: "123" }));
    return h.div("never");
  });

const Pure = (_props: {}): VElement => h.span("pure");

// === Type assertions ===

type AssertExact<T, U> = [T] extends [U] ? ([U] extends [T] ? true : false) : false;
type Assert<_T extends true> = true;

// --- h(Component, props) preserves channels ---

const c1 = h(NeedsAuth, {});
type _c1 = Assert<AssertExact<typeof c1, Effect.Effect<VElement, never, Auth>>>;

const c2 = h(NeedsDb, {});
type _c2 = Assert<AssertExact<typeof c2, Effect.Effect<VElement, never, Db>>>;

const c3 = h(MightFail, {});
type _c3 = Assert<AssertExact<typeof c3, Effect.Effect<VElement, NotFound, never>>>;

const c4 = h(Pure, {});
type _c4 = Assert<AssertExact<typeof c4, VElement>>;

// --- h.tag() element factories ---

const e1 = h.div("hello");
type _e1 = Assert<AssertExact<typeof e1, VElement>>;

const e2 = h.div({ class: "app" }, h.h1("Title"), h.p("Body"));
type _e2 = Assert<AssertExact<typeof e2, VElement>>;

// --- Channel propagation through element children ---

// Effect child inside h.div → should propagate R
const e3 = h.div(h(NeedsAuth, {}), h.span("hi"));
type _e3 = Assert<AssertExact<typeof e3, Effect.Effect<VElement, never, Auth>>>;

// Multiple Effect children → union of channels
const e4 = h.div(h(NeedsAuth, {}), h(NeedsDb, {}));
type _e4 = Assert<AssertExact<typeof e4, Effect.Effect<VElement, never, Auth | Db>>>;

// Effect with error + deps → both propagate
const e5 = h.div(h(MightFail, {}), h(NeedsAuth, {}));
type _e5 = Assert<AssertExact<typeof e5, Effect.Effect<VElement, NotFound, Auth>>>;

// --- Nested propagation ---

const e6 = h.div(h.section(h(NeedsAuth, {})));
type _e6 = Assert<AssertExact<typeof e6, Effect.Effect<VElement, never, Auth>>>;

// --- yield* in Effect.gen composes naturally ---

const App = () =>
  Effect.gen(function* () {
    const auth = yield* h(NeedsAuth, {});
    const db = yield* h(NeedsDb, {});
    return h.div(auth, db, h.footer("copyright"));
  });

type _app = Assert<AssertExact<ReturnType<typeof App>, Effect.Effect<VElement, never, Auth | Db>>>;

// Prevent unused warnings
export const _tests = {
  c1,
  c2,
  c3,
  c4,
  e1,
  e2,
  e3,
  e4,
  e5,
  e6,
  App,
};
