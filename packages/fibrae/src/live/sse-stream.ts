import * as Stream from "effect/Stream";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/**
 * Create an Effect Stream from a Server-Sent Events endpoint.
 *
 * Each emission is a decoded value of type `A`. The stream
 * stays open until the scope is closed (component unmounts).
 */
export const sseStream = <A, I>(options: {
  readonly url: string;
  readonly event: string;
  readonly schema: Schema.Schema<A, I>;
  readonly withCredentials?: boolean;
}): Stream.Stream<A, never, never> => {
  const decode = Schema.decodeUnknownSync(Schema.parseJson(options.schema));

  return Stream.async<A>((emit) => {
    const es = new EventSource(options.url, {
      withCredentials: options.withCredentials ?? false,
    });

    es.addEventListener(options.event, (e: MessageEvent) => {
      try {
        emit.single(decode(e.data));
      } catch {
        // Decode errors are silently skipped — atom stays at previous value
      }
    });

    es.onerror = () => {
      // EventSource auto-reconnects; don't end the stream
    };

    return Effect.sync(() => es.close());
  });
};
