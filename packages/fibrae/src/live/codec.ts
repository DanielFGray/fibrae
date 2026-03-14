/**
 * @since 1.0.0
 * SSE encode/decode helpers for LiveSync.
 */

const encoder = new TextEncoder();

/**
 * Encode an SSE event as a Uint8Array.
 *
 * Format: `[id: <id>\n]event: <name>\ndata: <json>\n\n`
 *
 * @since 1.0.0
 */
export const encodeSSE = (name: string, data: unknown, id?: string): Uint8Array =>
  encoder.encode(
    (id !== undefined ? `id: ${id}\n` : "") + `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`,
  );

/**
 * Encode an SSE comment (keepalive).
 *
 * Format: `: <text>\n\n`
 *
 * @since 1.0.0
 */
export const encodeComment = (text: string): Uint8Array => encoder.encode(`: ${text}\n\n`);

/**
 * Encode an SSE retry directive.
 *
 * Tells the client how many milliseconds to wait before reconnecting.
 *
 * Format: `retry: <millis>\n\n`
 *
 * @since 1.0.0
 */
export const encodeRetry = (millis: number): Uint8Array => encoder.encode(`retry: ${millis}\n\n`);

/**
 * Standard SSE response headers.
 *
 * @since 1.0.0
 */
export const SSE_HEADERS = {
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
} as const;
