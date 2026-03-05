import { Atom, Result } from "@effect-atom/atom"
import type * as Schema from "effect/Schema"

/** Metadata attached to live atoms for runtime discovery. */
export interface LiveMeta<A, I> {
  readonly event: string
  readonly schema: Schema.Schema<A, I>
}

/** A live atom — an atom backed by a remote SSE source. */
export type LiveAtom<A, I = A> = Atom.Writable<Result.Result<A>> & {
  readonly _live: LiveMeta<A, I>
}

/** Check if an atom is a live atom. */
export const isLiveAtom = (atom: Atom.Atom<any>): atom is LiveAtom<any> =>
  "_live" in atom && (atom as any)._live != null

/**
 * Create a live atom — an atom whose value is synced from a server SSE source.
 *
 * The atom's type is `Result<A>`:
 * - `Result.initial()` before SSE connects
 * - `Result.success(value)` on each event
 *
 * The atom is automatically serializable for SSR hydration.
 *
 * @example
 * ```ts
 * const ClockAtom = live("clock", { schema: Schema.String })
 * ```
 */
export const live = <A, I>(
  event: string,
  options: {
    readonly schema: Schema.Schema<A, I>
    readonly key?: string
  },
): LiveAtom<A, I> => {
  // Create a plain writable atom with Result.initial() as default.
  // The actual SSE stream subscription is wired up by the render
  // system when it detects a live atom via LiveConfig.
  const atom = Atom.make<Result.Result<A>>(Result.initial())

  // Mark as serializable for SSR hydration
  const serialized = Atom.serializable(atom, {
    key: options.key ?? event,
    schema: Result.Schema({ success: options.schema }) as any,
  })

  // Attach live metadata
  return Object.assign(serialized, {
    _live: { event, schema: options.schema } as LiveMeta<A, I>,
  }) as any
}
