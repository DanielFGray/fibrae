/**
 * @since 1.0.0
 * fibrae/live — first-class server↔client atom sync over SSE.
 *
 * @example
 * ```ts
 * import { LiveSync } from "fibrae/live"
 * ```
 */

export { LiveConfig } from "./config.js"
export type { LiveConfigShape } from "./config.js"
export { channel } from "./types.js"
export type { LiveChannel } from "./types.js"
export { encodeSSE, encodeComment, encodeRetry, SSE_HEADERS } from "./codec.js"
export { serve, serveGroup } from "./server.js"
export type { ServeOptions, ServeGroupChannelOptions } from "./server.js"
export { connect, connectGroup } from "./client.js"
export type { ConnectOptions } from "./client.js"
