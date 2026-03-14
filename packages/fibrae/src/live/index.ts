/**
 * @since 1.0.0
 * fibrae/live — first-class server↔client atom sync over SSE.
 *
 * @example
 * ```ts
 * import { LiveSync } from "fibrae/live"
 * ```
 */

export { LiveConfig } from "./config.js";
export type { LiveConfigShape } from "./config.js";
/** @deprecated Use `live()` to create live atoms instead. */
export { channel } from "./types.js";
/** @deprecated Use `LiveAtom` type instead. */
export type { LiveChannel } from "./types.js";
export { encodeSSE, encodeComment, encodeRetry, SSE_HEADERS } from "./codec.js";
export { serve, serveGroup } from "./server.js";
export type { ServeOptions, ServeGroupChannelOptions } from "./server.js";
/** @deprecated Live atoms auto-connect via LiveConfig. */
export { connect, connectGroup } from "./client.js";
/** @deprecated Live atoms auto-connect via LiveConfig. */
export type { ConnectOptions } from "./client.js";
export { sseStream } from "./sse-stream.js";
export { live, isLiveAtom } from "./atom.js";
export type { LiveAtom, LiveMeta } from "./atom.js";
