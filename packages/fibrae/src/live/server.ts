/**
 * @since 1.0.0
 * Server-side LiveSync — polls an Effect source, diffs, and streams via SSE.
 */
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import * as Schedule from "effect/Schedule"
import * as Schema from "effect/Schema"
import * as Equal from "effect/Equal"
import * as Ref from "effect/Ref"
import * as Duration from "effect/Duration"
import { HttpServerResponse } from "@effect/platform"
import type { DurationInput } from "effect/Duration"
import type { LiveChannel } from "./types.js"
import { isLiveAtom, type LiveAtom } from "./atom.js"
import { encodeSSE, encodeComment, encodeRetry, SSE_HEADERS } from "./codec.js"

/** Extract event name and schema from a LiveChannel or LiveAtom */
const resolveChannel = (channelOrAtom: LiveChannel<any, any> | LiveAtom<any, any>): {
  readonly name: string
  readonly schema: Schema.Schema<any, any>
} => {
  if (isLiveAtom(channelOrAtom as any)) {
    const atom = channelOrAtom as LiveAtom<any, any>
    return { name: atom._live.event, schema: atom._live.schema }
  }
  const ch = channelOrAtom as LiveChannel<any, any>
  return { name: ch.name, schema: ch.schema }
}

/**
 * Options for `serve()`.
 *
 * @since 1.0.0
 */
export interface ServeOptions<A, R> {
  /** Effect that fetches the current state from the upstream source. */
  readonly source: Effect.Effect<A, never, R>
  /** Polling interval. Accepts Duration or duration string (e.g. "2 seconds"). */
  readonly interval?: DurationInput
  /**
   * Custom equality function for deduplication. Defaults to `Equal.equals`.
   * Set to `false` to disable deduplication entirely.
   *
   * Note: `Equal.equals` uses structural equality for Effect `Data` types
   * and reference equality (`Object.is`) for plain objects. If your source
   * returns plain objects, pass a custom equality function.
   */
  readonly equals?: ((a: A, b: A) => boolean) | false
  /** Interval for SSE keepalive comments. Set to false to disable. Defaults to "30 seconds". */
  readonly heartbeatInterval?: DurationInput | false
  /** SSE retry interval sent to client for reconnection timing. */
  readonly retryInterval?: DurationInput
}

/**
 * Create an SSE request handler for a single LiveChannel.
 *
 * Returns an `Effect` that produces an `HttpServerResponse` with a
 * streaming body. The source Effect's `R` requirement propagates
 * so the caller provides dependencies via `Effect.provide`.
 *
 * @example
 * ```ts
 * const handler = LiveSync.serve(LightsChannel, {
 *   source: bridge.get("/lights").pipe(Effect.map(dictToArray)),
 *   interval: "2 seconds",
 * })
 * HttpRouter.get("/api/live", handler)
 * ```
 *
 * @since 1.0.0
 */
export const serve = <A, I, R>(
  channel: LiveChannel<A, I> | LiveAtom<A, I>,
  options: ServeOptions<A, R>,
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, R> => {
  const { name, schema } = resolveChannel(channel as any)
  const interval = options.interval ?? "2 seconds"
  const eq = options.equals !== undefined ? options.equals : (a: A, b: A) => Equal.equals(a, b)
  const heartbeatInterval = options.heartbeatInterval ?? "30 seconds"

  return Effect.gen(function* () {
    const context = yield* Effect.context<R>()
    const idRef = yield* Ref.make(0)

    const pollStream = Stream.repeatEffect(options.source).pipe(
      Stream.schedule(Schedule.spaced(interval)),
    )

    const deduped = eq !== false
      ? pollStream.pipe(Stream.changesWith(eq))
      : pollStream

    const dataStream = deduped.pipe(
      Stream.mapEffect((value) => Schema.encode(schema)(value).pipe(Effect.orDie)),
      Stream.mapEffect((encoded) =>
        Ref.getAndUpdate(idRef, (n) => n + 1).pipe(
          Effect.map((id) => encodeSSE(name, encoded, String(id))),
        ),
      ),
    )

    const heartbeat =
      heartbeatInterval === false
        ? Stream.empty
        : Stream.repeatEffect(Effect.succeed(encodeComment("ping"))).pipe(
            Stream.schedule(Schedule.spaced(heartbeatInterval)),
          )

    const retry =
      options.retryInterval !== undefined
        ? Stream.make(encodeRetry(Duration.toMillis(options.retryInterval)))
        : Stream.empty

    const sseStream = Stream.mergeAll([retry, dataStream, heartbeat], { concurrency: "unbounded" }).pipe(
      Stream.provideContext(context),
    )

    // cast needed: effect/platform's StreamTypeId symbol differs from our effect version
    return HttpServerResponse.stream(sseStream as any, {
      contentType: "text/event-stream",
      headers: SSE_HEADERS,
    })
  })
}

/**
 * Options for a single channel within `serveGroup()`.
 *
 * @since 1.0.0
 */
export interface ServeGroupChannelOptions<A, I, R> {
  readonly channel: LiveChannel<A, I> | LiveAtom<A, I>
  readonly source: Effect.Effect<A, never, R>
  readonly interval?: DurationInput
  /**
   * Custom equality function for deduplication. Defaults to `Equal.equals`.
   * Set to `false` to disable deduplication entirely.
   */
  readonly equals?: ((a: A, b: A) => boolean) | false
}

/**
 * Create an SSE handler that multiplexes multiple channels over one connection.
 *
 * Each channel polls independently at its own interval. Events are tagged
 * with `event: <channel.name>` so the client can dispatch to the correct atom.
 * All events share a monotonic `id:` counter across channels.
 *
 * @since 1.0.0
 */
export const serveGroup = <Channels extends readonly ServeGroupChannelOptions<any, any, any>[]>(options: {
  readonly channels: Channels
  /** Interval for SSE keepalive comments. Set to false to disable. Defaults to "30 seconds". */
  readonly heartbeatInterval?: DurationInput | false
  /** SSE retry interval sent to client for reconnection timing. */
  readonly retryInterval?: DurationInput
}): Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  never,
  Channels[number] extends ServeGroupChannelOptions<any, any, infer R> ? R : never
> =>
  Effect.gen(function* () {
    type R = Channels[number] extends ServeGroupChannelOptions<any, any, infer R> ? R : never
    const context = yield* Effect.context<R>()
    const heartbeatInterval = options.heartbeatInterval ?? "30 seconds"
    const idRef = yield* Ref.make(0)

    const channelStreams = options.channels.map((opt) => {
      const { name, schema } = resolveChannel(opt.channel as any)
      const pollInterval = opt.interval ?? "2 seconds"
      const eq = opt.equals !== undefined ? opt.equals : (a: any, b: any) => Equal.equals(a, b)

      const pollStream = Stream.repeatEffect(opt.source).pipe(
        Stream.schedule(Schedule.spaced(pollInterval)),
      )

      const deduped = eq !== false
        ? pollStream.pipe(Stream.changesWith(eq))
        : pollStream

      return deduped.pipe(
        Stream.mapEffect((value) => Schema.encode(schema)(value).pipe(Effect.orDie)),
        Stream.mapEffect((encoded) =>
          Ref.getAndUpdate(idRef, (n) => n + 1).pipe(
            Effect.map((id) => encodeSSE(name, encoded, String(id))),
          ),
        ),
      )
    })

    const dataStream = Stream.mergeAll(channelStreams, { concurrency: "unbounded" })

    const heartbeat =
      heartbeatInterval === false
        ? Stream.empty
        : Stream.repeatEffect(Effect.succeed(encodeComment("ping"))).pipe(
            Stream.schedule(Schedule.spaced(heartbeatInterval)),
          )

    const retry =
      options.retryInterval !== undefined
        ? Stream.make(encodeRetry(Duration.toMillis(options.retryInterval)))
        : Stream.empty

    const sseStream = Stream.mergeAll([retry, dataStream, heartbeat], { concurrency: "unbounded" }).pipe(
      Stream.provideContext(context),
    )

    // cast needed: effect/platform's StreamTypeId symbol differs from our effect version
    return HttpServerResponse.stream(sseStream as any, {
      contentType: "text/event-stream",
      headers: SSE_HEADERS,
    })
  })
