/**
 * @since 1.0.0
 * LiveChannel — shared definition imported by both server and client.
 */
import type * as Schema from "effect/Schema"
import type { Atom } from "@effect-atom/atom"

/**
 * A LiveChannel defines a named server→client sync point:
 * - `name`: SSE event name (used as `event:` field)
 * - `schema`: Effect Schema for type-safe encode/decode over the wire
 * - `atom`: Writable atom that the client updates on each SSE event
 *
 * @since 1.0.0
 */
export interface LiveChannel<A, I = A> {
  readonly _tag: "LiveChannel"
  readonly name: string
  readonly schema: Schema.Schema<A, I>
  readonly atom: Atom.Writable<A>
}

/**
 * Construct a LiveChannel.
 *
 * @deprecated Use `live()` to create live atoms instead.
 * @example
 * ```ts
 * const LightsChannel = LiveSync.channel({
 *   name: "lights",
 *   schema: Schema.Array(Light),
 *   atom: LightsAtom,
 * })
 * ```
 *
 * @since 1.0.0
 */
export const channel = <A, I>(opts: {
  readonly name: string
  readonly schema: Schema.Schema<A, I>
  readonly atom: Atom.Writable<A>
}): LiveChannel<A, I> => ({
  _tag: "LiveChannel" as const,
  ...opts,
})
