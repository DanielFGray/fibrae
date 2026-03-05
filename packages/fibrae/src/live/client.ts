/**
 * @since 1.0.0
 * Client-side LiveSync — connects to SSE endpoint and syncs atoms.
 */
import * as Effect from "effect/Effect"
import * as Either from "effect/Either"
import * as Runtime from "effect/Runtime"
import * as Scope from "effect/Scope"
import * as Schema from "effect/Schema"
import { Registry as AtomRegistry } from "@effect-atom/atom"
import { ComponentScope } from "../shared.js"
import type { LiveChannel } from "./types.js"

/**
 * Options for `connect()`.
 *
 * @since 1.0.0
 */
export interface ConnectOptions {
  /** SSE endpoint URL (e.g. "/api/live"). */
  readonly url: string
  /** Whether to send cookies cross-origin. Required for cookie-based auth. */
  readonly withCredentials?: boolean
}

/**
 * Connect to a LiveSync SSE endpoint and sync a single channel's atom.
 *
 * @deprecated Live atoms auto-connect via LiveConfig — just read the atom.
 * Must be called inside a fibrae component — uses `ComponentScope` for
 * automatic EventSource cleanup on unmount, and `AtomRegistry` to set
 * the atom value on each event.
 *
 * Decode errors are logged via Effect and skipped (no crash).
 *
 * @example
 * ```ts
 * const LiveLights = () =>
 *   Effect.gen(function* () {
 *     yield* LiveSync.connect(LightsChannel, { url: "/api/live" })
 *     return <span class="live-dot" />
 *   })
 * ```
 *
 * @since 1.0.0
 */
export const connect = <A, I>(
  channel: LiveChannel<A, I>,
  options: ConnectOptions,
): Effect.Effect<void, never, AtomRegistry.AtomRegistry | ComponentScope> =>
  Effect.gen(function* () {
    // Skip during SSR
    if (typeof window === "undefined") return

    const registry = yield* AtomRegistry.AtomRegistry
    const { scope } = yield* ComponentScope
    const rt = yield* Effect.runtime<never>()
    const run = Runtime.runSync(rt)
    const decode = Schema.decodeUnknownEither(Schema.parseJson(channel.schema))

    const es = new EventSource(options.url, { withCredentials: options.withCredentials ?? false })

    es.addEventListener(channel.name, (e: MessageEvent) => {
      const result = decode(e.data)
      if (Either.isRight(result)) {
        registry.set(channel.atom, result.right)
      } else {
        run(
          Effect.logWarning("LiveSync decode error").pipe(
            Effect.annotateLogs({ channel: channel.name, error: String(result.left) }),
          ),
        )
      }
    })

    es.onerror = () => {
      run(Effect.logWarning("LiveSync connection error").pipe(
        Effect.annotateLogs("channel", channel.name),
      ))
    }

    yield* Scope.addFinalizer(scope, Effect.sync(() => es.close()))
  })

/**
 * Connect to a multiplexed SSE endpoint and sync multiple channels' atoms.
 *
 * @deprecated Live atoms auto-connect via LiveConfig — just read the atoms.
 * Single EventSource, dispatches to correct atom by event name.
 *
 * @since 1.0.0
 */
export const connectGroup = (
  channels: readonly LiveChannel<any, any>[],
  options: ConnectOptions,
): Effect.Effect<void, never, AtomRegistry.AtomRegistry | ComponentScope> =>
  Effect.gen(function* () {
    if (typeof window === "undefined") return

    const registry = yield* AtomRegistry.AtomRegistry
    const { scope } = yield* ComponentScope
    const rt = yield* Effect.runtime<never>()
    const run = Runtime.runSync(rt)

    const es = new EventSource(options.url, { withCredentials: options.withCredentials ?? false })

    for (const ch of channels) {
      const decode = Schema.decodeUnknownEither(Schema.parseJson(ch.schema))
      es.addEventListener(ch.name, (e: MessageEvent) => {
        const result = decode(e.data)
        if (Either.isRight(result)) {
          registry.set(ch.atom, result.right)
        } else {
          run(
            Effect.logWarning("LiveSync decode error").pipe(
              Effect.annotateLogs({ channel: ch.name, error: String(result.left) }),
            ),
          )
        }
      })
    }

    es.onerror = () => {
      run(Effect.logWarning("LiveSync connection error").pipe(
        Effect.annotateLogs("channels", channels.map((c) => c.name).join(",")),
      ))
    }

    yield* Scope.addFinalizer(scope, Effect.sync(() => es.close()))
  })
