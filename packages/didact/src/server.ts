import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Option from "effect/Option";
import * as Deferred from "effect/Deferred";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Fiber from "effect/Fiber";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Random from "effect/Random";
import * as S from "effect/Schema";
import {
  type VElement,
  isPrimitive,
  isComponent,
  isProperty,
  isStream,
} from "./shared.js";

// ============================================================================
// Bridge Service - Phase 2: Server-Client Bridge Implementation
// ============================================================================

/**
 * Status of a bridge promise
 */
type BridgePromiseStatus = "pending" | "resolved" | "rejected";

/**
 * A promise-like Effect registered for server-client handoff
 */
export interface BridgePromise<A> {
  readonly id: string;
  readonly status: BridgePromiseStatus;
  readonly value?: A;
  readonly error?: unknown;
  readonly effect: Effect.Effect<A>;
}

/**
 * A stream registered for server-client continuation
 */
export interface BridgeStream<A> {
  readonly id: string;
  readonly initial?: A;
  readonly stream: Stream.Stream<A>;
}

/**
 * Internal registry entry for promises
 */
interface PromiseEntry<A = unknown> {
  readonly kind: "promise";
  readonly id: string;
  readonly deferred: Deferred.Deferred<A>;
  readonly status: Ref.Ref<BridgePromiseStatus>;
  readonly value: Ref.Ref<Option.Option<A>>;
  readonly error: Ref.Ref<Option.Option<unknown>>;
}

/**
 * Internal registry entry for streams
 */
interface StreamEntry<A = unknown> {
  readonly kind: "stream";
  readonly id: string;
  readonly queue: Queue.Queue<A>;
  readonly initial: Ref.Ref<Option.Option<A>>;
  readonly drainFiber: Ref.Ref<Option.Option<Effect.Fiber<void>>>;
}

/**
 * Union of all bridge entry types
 */
type BridgeEntry = PromiseEntry<any> | StreamEntry<any>;

/**
 * Manifest entry for client bootstrap (serializable)
 */
interface ManifestPromiseEntry {
  readonly kind: "promise";
  readonly id: string;
  readonly status: BridgePromiseStatus;
  readonly value?: unknown;
  readonly error?: unknown;
}

interface ManifestStreamEntry {
  readonly kind: "stream";
  readonly id: string;
  readonly initial?: unknown;
}

type ManifestEntry = ManifestPromiseEntry | ManifestStreamEntry;

/**
 * Bridge service interface
 */
export interface Bridge {
  /**
   * Register a Promise-like Effect for handoff
   */
  readonly promise: <A>(effect: Effect.Effect<A>) => Effect.Effect<BridgePromise<A>>;

  /**
   * Register a Stream for continuation
   */
  readonly stream: <A>(stream: Stream.Stream<A>) => Effect.Effect<BridgeStream<A>>;

  /**
   * Generate manifest for client bootstrap (JSON)
   */
  readonly renderManifest: () => Effect.Effect<string>;
}

/**
 * Bridge service tag
 */
export const Bridge = Context.GenericTag<Bridge>("@didact/Bridge");

/**
 * Generate a cryptographically random ID for bridge entries
 */
const generateId = (prefix: string): Effect.Effect<string> =>
  Random.nextInt.pipe(
    Effect.map(n => `${prefix}_${Math.abs(n).toString(36)}`)
  );

/**
 * Bridge service implementation
 */
const makeBridge = Effect.gen(function*() {
  const scope = yield* Scope.Scope;
  const registry = yield* Ref.make(new Map<string, BridgeEntry>());

  /**
   * Register a promise-like Effect
   */
  const promise = <A>(effect: Effect.Effect<A>): Effect.Effect<BridgePromise<A>> =>
    Effect.gen(function*() {
      const id = yield* generateId("br_p");
      const deferred = yield* Deferred.make<A>();
      const status = yield* Ref.make<BridgePromiseStatus>("pending");
      const value = yield* Ref.make<Option.Option<A>>(Option.none());
      const error = yield* Ref.make<Option.Option<unknown>>(Option.none());

      const entry: PromiseEntry<A> = {
        kind: "promise",
        id,
        deferred,
        status,
        value,
        error,
      };

      // Register entry
      yield* Ref.update(registry, map => new Map(map).set(id, entry));

      // Add cleanup finalizer
      yield* Scope.addFinalizer(scope,
        Ref.update(registry, map => {
          const newMap = new Map(map);
          newMap.delete(id);
          return newMap;
        })
      );

      // Fork the effect to resolve the deferred
      yield* Effect.gen(function*() {
        const result = yield* Effect.either(effect);

        if (result._tag === "Right") {
          yield* Deferred.succeed(deferred, result.right);
          yield* Ref.set(status, "resolved");
          yield* Ref.set(value, Option.some(result.right));
        } else {
          yield* Deferred.fail(deferred, result.left);
          yield* Ref.set(status, "rejected");
          yield* Ref.set(error, Option.some(result.left));
        }
      }).pipe(Effect.forkIn(scope));

      // Return bridge promise interface
      return {
        id,
        status: "pending",
        effect: Deferred.await(deferred),
      };
    });

  /**
   * Register a stream for continuation
   */
  const stream = <A>(sourceStream: Stream.Stream<A>): Effect.Effect<BridgeStream<A>> =>
    Effect.gen(function*() {
      const id = yield* generateId("br_s");
      const queue = yield* Queue.unbounded<A>();
      const initial = yield* Ref.make<Option.Option<A>>(Option.none());
      const drainFiber = yield* Ref.make<Option.Option<Effect.Fiber<void>>>(Option.none());

      const entry: StreamEntry<A> = {
        kind: "stream",
        id,
        queue,
        initial,
        drainFiber,
      };

      // Register entry
      yield* Ref.update(registry, map => new Map(map).set(id, entry));

      // Add cleanup finalizer
      yield* Scope.addFinalizer(scope,
        Effect.gen(function*() {
          // Interrupt drain fiber if running
          const fiber = yield* Ref.get(drainFiber);
          if (Option.isSome(fiber)) {
            yield* Effect.fiberIdWith(id => Effect.log(`Interrupting drain fiber for ${entry.id} from ${id}`));
            yield* Fiber.interrupt(fiber.value);
          }
          // Remove from registry
          yield* Ref.update(registry, map => {
            const newMap = new Map(map);
            newMap.delete(id);
            return newMap;
          });
        })
      );

      // Fork fiber to drain stream into queue
      const fiber = yield* Effect.gen(function*() {
        let isFirst = true;
        yield* Stream.runForEach(sourceStream, (value: A) =>
          Effect.gen(function*() {
            // Capture first value for SSR
            if (isFirst) {
              yield* Ref.set(initial, Option.some(value));
              isFirst = false;
            }
            // Enqueue value
            yield* Queue.offer(queue, value);
          })
        );
      }).pipe(Effect.forkIn(scope));

      yield* Ref.set(drainFiber, Option.some(fiber));

      // Return bridge stream interface
      return {
        id,
        stream: Stream.fromQueue(queue),
      };
    });

  /**
   * Generate manifest JSON for client bootstrap
   */
  const renderManifest = (): Effect.Effect<string> =>
    Effect.gen(function*() {
      const entries = yield* Ref.get(registry);
      const manifestEntries: ManifestEntry[] = [];

      for (const [, entry] of entries) {
        if (entry.kind === "promise") {
          const statusValue = yield* Ref.get(entry.status);
          const valueOption = yield* Ref.get(entry.value);
          const errorOption = yield* Ref.get(entry.error);

          const manifestEntry: ManifestPromiseEntry = {
            kind: "promise",
            id: entry.id,
            status: statusValue,
            value: Option.isSome(valueOption) ? valueOption.value : undefined,
            error: Option.isSome(errorOption) ? errorOption.value : undefined,
          };
          manifestEntries.push(manifestEntry);
        } else {
          const initialValue = yield* Ref.get(entry.initial);
          const manifestEntry: ManifestStreamEntry = {
            kind: "stream",
            id: entry.id,
            initial: Option.isSome(initialValue) ? initialValue.value : undefined,
          };
          manifestEntries.push(manifestEntry);
        }
      }

      return JSON.stringify(manifestEntries, null, 2);
    });

  return Bridge.of({
    promise,
    stream,
    renderManifest,
  });
});

/**
 * Bridge service layer
 * Scoped - cleanup handled automatically when scope closes
 */
export const BridgeLayer = Layer.scoped(Bridge, makeBridge);

// ============================================================================
// Phase 3: SSR Integration with Bridge
// ============================================================================

/**
 * Render context for tracking paths during SSR traversal
 */
interface RenderContext {
  path: string; // e.g., "p:0.2.1"
  bridgeIds: Map<string, string>; // path -> bridge id mapping
}

/**
 * Create a child context with an appended index
 */
const childContext = (ctx: RenderContext, index: number): RenderContext => {
  return {
    path: ctx.path === "" ? `p:${index}` : `${ctx.path}.${index}`,
    bridgeIds: ctx.bridgeIds, // Share the same map reference
  };
};

/**
 * Schema for BridgePromise - validates the structure of a bridge promise
 */
const BridgePromiseSchema = S.Struct({
  id: S.String.pipe(S.startsWith("br_p_")),
  status: S.Literal("pending", "resolved", "rejected"),
  value: S.optional(S.Unknown),
  error: S.optional(S.Unknown),
  effect: S.Unknown, // Effect is not directly schematizable, so use Unknown
});

/**
 * Schema for BridgeStream - validates the structure of a bridge stream
 */
const BridgeStreamSchema = S.Struct({
  id: S.String.pipe(S.startsWith("br_s_")),
  initial: S.optional(S.Unknown),
  stream: S.Unknown, // Stream is not directly schematizable, so use Unknown
});

/**
 * Type guard to check if a value is a BridgePromise
 */
const isBridgePromise = S.is(BridgePromiseSchema);

/**
 * Type guard to check if a value is a BridgeStream
 */
const isBridgeStream = S.is(BridgeStreamSchema);

/**
 * HTML entity escaping for safe rendering
 */
const escapeHtml = (text: string): string => {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
};

/**
 * Escape attribute values (double quotes need escaping)
 */
const escapeAttr = (value: string): string => {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
};

/**
 * Convert prop name to HTML attribute name
 */
const propToAttrName = (prop: string): string => {
  // Handle special cases
  if (prop === "className") return "class";
  if (prop === "htmlFor") return "for";
  return prop;
};

/**
 * Render props as HTML attributes
 */
const renderAttributes = (props: Record<string, unknown>): string => {
  const attrs: string[] = [];

  for (const [key, value] of Object.entries(props)) {
    // Skip non-properties (children, events, refs)
    if (!isProperty(key) || value === undefined || value === null) {
      continue;
    }

    const attrName = propToAttrName(key);

    // Handle boolean attributes
    if (typeof value === "boolean") {
      if (value) {
        attrs.push(attrName);
      }
      continue;
    }

    // Handle class arrays
    if ((key === "class" || key === "className") && Array.isArray(value)) {
      attrs.push(`${attrName}="${escapeAttr(value.join(" "))}"`);
      continue;
    }

    // Handle style objects
    if (key === "style" && typeof value === "object") {
      const styleStr = Object.entries(value as Record<string, any>)
        .map(([k, v]) => `${k.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`)}:${v}`)
        .join(";");
      attrs.push(`style="${escapeAttr(styleStr)}"`);
      continue;
    }

    // Skip non-serializable values (functions and objects)
    // These shouldn't be rendered in SSR output
    if (typeof value === "function" || typeof value === "object") {
      continue;
    }

    // Default: string attribute
    attrs.push(`${attrName}="${escapeAttr(String(value))}"`);
  }

  return attrs.length > 0 ? " " + attrs.join(" ") : "";
};

/**
 * Self-closing HTML tags that don't have closing tags
 */
const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr"
]);

/**
 * Render a single VElement to HTML string
 * This is the core SSR serializer
 */
const renderElement = (element: VElement, ctx: RenderContext): Effect.Effect<string> =>
  Effect.gen(function*() {
    const { type, props } = element;

    // Handle text nodes
    if (type === "TEXT_ELEMENT") {
      const text = String(props.nodeValue ?? "");

      // Add bridge attribute if this text is from a bridged component
      const bridgeId = ctx.bridgeIds.get(ctx.path);
      const bridgeAttr = bridgeId !== undefined ? ` data-dx-bridge="${escapeAttr(bridgeId)}"` : "";

      // Wrap dynamic text with data-dx-t for hydration
      return `<span data-dx-t="${ctx.path}"${bridgeAttr}>${escapeHtml(text)}</span>`;
    }

    // Handle fragments
    if (type === "FRAGMENT") {
      const children = props.children ?? [];
      const childHtml = yield* Effect.forEach(
        children,
        (child, index) => renderElement(child, childContext(ctx, index))
      );
      return childHtml.join("");
    }

    // Handle component functions
    if (isComponent(type)) {
      const initial = type(props);

      // Resolve Effects first to handle Effect<BridgePromise|BridgeStream|VElement|Stream>
      const result = Effect.isEffect(initial) ? (yield* (initial as Effect.Effect<any>)) : initial;

      // BridgePromise returned
      if (isBridgePromise(result)) {
        ctx.bridgeIds.set(ctx.path, result.id);
        const vElement = yield* (result.effect as Effect.Effect<VElement>);
        return yield* renderElement(vElement, ctx);
      }

      // BridgeStream returned
      if (isBridgeStream(result)) {
        ctx.bridgeIds.set(ctx.path, result.id);
        const firstValue = yield* Stream.runHead(result.stream as Stream.Stream<VElement>);
        return yield* Option.match(firstValue, {
          onNone: () => Effect.succeed(""),
          onSome: (vElement) => renderElement(vElement, ctx),
        });
      }

      // Raw Stream returned - take first emission only
      if (isStream(result)) {
        const firstValue = yield* Stream.runHead(result as Stream.Stream<VElement>);
        return yield* Option.match(firstValue, {
          onNone: () => Effect.succeed(""),
          onSome: (vElement) => renderElement(vElement, ctx),
        });
      }

      // VElement returned directly
      return yield* renderElement(result as VElement, ctx);
    }

    // Handle primitive HTML elements
    if (isPrimitive(type)) {
      const tag = type;
      const attrs = renderAttributes(props);
      const children = props.children ?? [];

      // Add key attribute if present
      const keyAttr = props.key !== undefined ? ` data-dx-k="${escapeAttr(String(props.key))}"` : "";

      // Add bridge attribute if this element is from a bridged component
      const bridgeId = ctx.bridgeIds.get(ctx.path);
      const bridgeAttr = bridgeId !== undefined ? ` data-dx-bridge="${escapeAttr(bridgeId)}"` : "";

      // Void elements (self-closing)
      if (VOID_ELEMENTS.has(tag)) {
        return `<${tag}${attrs} data-dx="${ctx.path}"${keyAttr}${bridgeAttr} />`;
      }

      // Regular elements with children
      const childHtml = yield* Effect.forEach(
        children,
        (child, index) => renderElement(child, childContext(ctx, index))
      );
      const childContent = childHtml.join("");

      return `<${tag}${attrs} data-dx="${ctx.path}"${keyAttr}${bridgeAttr}>${childContent}</${tag}>`;
    }

    return "";
  });

/**
 * Render a VElement tree to an HTML string
 * Main entry point for SSR
 *
 * @param element - Root VElement to render
 * @returns Effect that produces the complete HTML string
 *
 * @example
 * ```ts
 * const App = () => h("div", {}, ["Hello, SSR!"]);
 * const html = await Effect.runPromise(renderToString(h(App, {}, [])));
 * ```
 */
export const renderToString = (element: VElement): Effect.Effect<string> =>
  renderElement(element, { path: "", bridgeIds: new Map() });

/**
 * Convenience wrapper that runs the Effect and returns a Promise
 *
 * @param element - Root VElement to render
 * @returns Promise that resolves to the HTML string or rejects with error
 */
export const renderToStringPromise = (element: VElement): Promise<string> =>
  Effect.runPromiseExit(renderToString(element)).then(exit => {
    if (exit._tag === "Success") {
      return exit.value;
    }
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw exit.cause;
  });

/**
 * Result of rendering with bridge support
 */
export interface RenderWithBridgeResult {
  readonly html: string;
  readonly manifest: string;
}

/**
 * Render a VElement tree to HTML with Bridge service support.
 * Components can use Bridge.promise() and Bridge.stream() to register
 * server-client handoffs. Returns both the HTML and a JSON manifest.
 *
 * @param element - Root VElement to render
 * @returns Effect that produces HTML string and manifest JSON
 *
 * @example
 * ```ts
 * const App = () => Effect.gen(function*() {
 *   const bridge = yield* Bridge;
 *   const dataPromise = bridge.promise(fetchData());
 *   const data = yield* dataPromise.effect;
 *   return h("div", {}, [JSON.stringify(data)]);
 * });
 *
 * const result = await Effect.runPromise(renderToStringWithBridge(h(App, {}, [])));
 * // result.html contains the rendered HTML with data-dx-bridge attributes
 * // result.manifest contains the JSON manifest for client bootstrap
 * ```
 */
export const renderToStringWithBridge = (
  element: VElement
): Effect.Effect<RenderWithBridgeResult, never, Bridge> =>
  Effect.gen(function*() {
    const bridge = yield* Bridge;

    // Render element with bridge context
    const ctx: RenderContext = { path: "", bridgeIds: new Map() };
    const html = yield* renderElement(element, ctx);

    // Generate manifest
    const manifest = yield* bridge.renderManifest();

    return { html, manifest };
  });

/**
 * Inject the bridge manifest script tag into HTML.
 * This should be called with the result of renderToStringWithBridge.
 * Typically you'd inject this before the closing </body> tag.
 *
 * @param html - The rendered HTML string
 * @param manifest - The JSON manifest string
 * @returns HTML with manifest script injected
 *
 * @example
 * ```ts
 * const { html, manifest } = await Effect.runPromise(renderToStringWithBridge(app));
 * const fullHtml = `
 *   <!DOCTYPE html>
 *   <html>
 *     <body>
 *       <div id="root">${html}</div>
 *       ${injectBridgeManifest(manifest)}
 *     </body>
 *   </html>
 * `;
 * ```
 */
export const injectBridgeManifest = (manifest: string): string => {
  return `<script id="__DX_BRIDGE" type="application/json">${manifest}</script>`;
};
