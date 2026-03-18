/**
 * Head component — lets any component set document head elements.
 *
 * On the client, directly mutates document.head (title, meta, link tags).
 * On SSR, contributes to HeadCollector for server-side rendering.
 * Cleans up added/modified elements on unmount via ComponentScope finalizer.
 *
 * Usage:
 * ```tsx
 * const PostPage = (props: { title: string }) =>
 *   Effect.gen(function* () {
 *     return (
 *       <div>
 *         <Head title={`${props.title} | My Site`} meta={[
 *           { name: "description", content: "A blog post" }
 *         ]} />
 *         <h1>{props.title}</h1>
 *       </div>
 *     );
 *   });
 * ```
 */

import { jsx } from "./jsx-runtime/index.js";
import * as Effect from "effect/Effect";
import * as Context from "effect/Context";
import * as Scope from "effect/Scope";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import { ComponentScope, type VElement } from "./shared.js";
import type { HeadData, MetaDescriptor } from "./router/RouterBuilder.js";

// =============================================================================
// HeadCollector Service (SSR)
// =============================================================================

/**
 * Service for accumulating head elements during SSR.
 * Components call add() during render; the SSR layer calls collect() after.
 */
export interface HeadCollectorService {
  /** Register head data from a component. */
  readonly add: (data: HeadData) => Effect.Effect<void>;
  /** Collect all registered head data, merged and deduplicated. */
  readonly collect: () => Effect.Effect<HeadData>;
}

/**
 * Context tag for the HeadCollector service.
 * Only present during SSR — client-side Head components skip this.
 */
export class HeadCollector extends Context.Tag("fibrae/HeadCollector")<
  HeadCollector,
  HeadCollectorService
>() {}

/**
 * Dedup key for a meta descriptor — same logic as cli/html.ts.
 * Tags with matching keys are deduplicated (later wins).
 */
const metaKey = (meta: MetaDescriptor): string | undefined => {
  if ("name" in meta) return `name:${meta.name}`;
  if ("property" in meta) return `property:${meta.property}`;
  if ("httpEquiv" in meta) return `httpEquiv:${meta.httpEquiv}`;
  if ("charset" in meta) return "charset";
  return undefined;
};

/**
 * Merge two HeadData objects. Later data wins for title and deduped meta.
 * Links and scripts are concatenated.
 */
const mergeHeadData = (a: HeadData, b: HeadData): HeadData => {
  // Deduplicate meta: b overrides a when keys match
  const aMeta = a.meta ?? [];
  const bMeta = b.meta ?? [];
  const bKeys = new Set(bMeta.map(metaKey).filter(Boolean));
  const mergedMeta = [
    ...aMeta.filter((m) => {
      const key = metaKey(m);
      return key === undefined || !bKeys.has(key);
    }),
    ...bMeta,
  ];

  return {
    title: b.title ?? a.title,
    meta: mergedMeta.length > 0 ? mergedMeta : undefined,
    links: [...(a.links ?? []), ...(b.links ?? [])],
    scripts: [...(a.scripts ?? []), ...(b.scripts ?? [])],
  };
};

/**
 * Create a HeadCollector backed by a mutable Ref.
 * Returns a Layer providing the HeadCollector service.
 */
export const HeadCollectorLive = Effect.gen(function* () {
  const ref = yield* Ref.make<HeadData>({});
  return HeadCollector.of({
    add: (data) => Ref.update(ref, (current) => mergeHeadData(current, data)),
    collect: () => Ref.get(ref),
  });
}).pipe(Effect.map((service) => Context.make(HeadCollector, service)));

// =============================================================================
// Head Props
// =============================================================================

export interface HeadProps {
  readonly title?: string;
  readonly meta?: ReadonlyArray<MetaDescriptor>;
  readonly links?: ReadonlyArray<Record<string, string>>;
}

// =============================================================================
// Client-side DOM helpers
// =============================================================================

const DEV =
  typeof import.meta !== "undefined" && !!(import.meta as unknown as Record<string, unknown>).hot;

/**
 * Find an existing meta element by its dedup key.
 */
const findMetaElement = (meta: MetaDescriptor): HTMLElement | null => {
  if ("name" in meta && !("tagName" in meta))
    return document.head.querySelector(`meta[name="${meta.name}"]`);
  if ("property" in meta && !("tagName" in meta))
    return document.head.querySelector(`meta[property="${meta.property}"]`);
  if ("httpEquiv" in meta)
    return document.head.querySelector(`meta[http-equiv="${meta.httpEquiv}"]`);
  if ("charset" in meta) return document.head.querySelector("meta[charset]");
  return null;
};

/**
 * Set attributes on an element from a MetaDescriptor.
 */
const applyMetaAttrs = (el: HTMLElement, meta: MetaDescriptor): void => {
  if ("charset" in meta) {
    el.setAttribute("charset", meta.charset);
    return;
  }
  if ("name" in meta && "content" in meta && !("tagName" in meta)) {
    el.setAttribute("name", meta.name);
    el.setAttribute("content", meta.content);
    return;
  }
  if ("property" in meta && "content" in meta && !("tagName" in meta)) {
    el.setAttribute("property", meta.property);
    el.setAttribute("content", meta.content);
    return;
  }
  if ("httpEquiv" in meta && "content" in meta) {
    el.setAttribute("http-equiv", meta.httpEquiv);
    el.setAttribute("content", meta.content);
    return;
  }
  if ("script:ld+json" in meta) {
    el.setAttribute("type", "application/ld+json");
    el.textContent = JSON.stringify(meta["script:ld+json"]);
    return;
  }
  if ("tagName" in meta) {
    const { tagName: _, ...attrs } = meta;
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    return;
  }
};

/**
 * Apply a single MetaDescriptor to the document head.
 * Returns a cleanup function that restores the previous state.
 */
const applyMeta = (meta: MetaDescriptor): (() => void) => {
  // ld+json scripts are separate elements
  if ("script:ld+json" in meta) {
    const el = document.createElement("script");
    applyMetaAttrs(el, meta);
    document.head.appendChild(el);
    return () => el.remove();
  }

  // tagName meta — create element of specified tag
  if ("tagName" in meta) {
    const el = document.createElement(meta.tagName);
    applyMetaAttrs(el, meta);
    document.head.appendChild(el);
    return () => el.remove();
  }

  // title meta — handled by title prop, skip here
  if ("title" in meta) return () => {};

  // Standard meta tags — find existing or create new
  const existing = findMetaElement(meta);
  if (existing) {
    // Save previous attributes for restore
    const prevAttrs = new Map<string, string>();
    Array.from(existing.attributes).forEach((attr) => prevAttrs.set(attr.name, attr.value));
    applyMetaAttrs(existing, meta);
    return () => {
      // Restore previous attributes
      prevAttrs.forEach((v, k) => existing.setAttribute(k, v));
    };
  }

  // Create new element
  const el = document.createElement("meta");
  applyMetaAttrs(el, meta);
  document.head.appendChild(el);
  return () => el.remove();
};

/**
 * Apply a link descriptor to the document head.
 * Returns a cleanup function.
 */
const applyLink = (attrs: Record<string, string>): (() => void) => {
  // Try to find existing link by rel+href
  const selector =
    attrs.rel && attrs.href ? `link[rel="${attrs.rel}"][href="${attrs.href}"]` : null;
  const existing = selector ? document.head.querySelector(selector) : null;

  if (existing) {
    const prevAttrs = new Map<string, string>();
    Array.from(existing.attributes).forEach((attr) => prevAttrs.set(attr.name, attr.value));
    Object.entries(attrs).forEach(([k, v]) => existing.setAttribute(k, v));
    return () => {
      prevAttrs.forEach((v, k) => existing.setAttribute(k, v));
    };
  }

  const el = document.createElement("link");
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  document.head.appendChild(el);
  return () => el.remove();
};

// =============================================================================
// Head Component
// =============================================================================

/**
 * General-purpose Head component.
 *
 * Accepts title, meta, and link props. On the client, directly mutates
 * document.head and registers cleanup via ComponentScope. On SSR,
 * contributes to HeadCollector if available.
 *
 * Returns an empty fragment (renders nothing visible).
 */
export const Head = (props: HeadProps): Effect.Effect<VElement, never, ComponentScope> =>
  Effect.gen(function* () {
    const headData: HeadData = {
      title: props.title,
      meta: props.meta ? [...props.meta] : undefined,
      links: props.links ? [...props.links] : undefined,
    };

    // SSR path: contribute to HeadCollector if available
    const collectorOption = yield* Effect.serviceOption(HeadCollector);
    if (Option.isSome(collectorOption)) {
      yield* collectorOption.value.add(headData);
      return jsx("FRAGMENT", { children: [] });
    }

    // Client path: mutate document.head directly
    if (typeof document !== "undefined") {
      const { scope } = yield* ComponentScope;
      const cleanups: Array<() => void> = [];

      // Apply title
      if (props.title !== undefined) {
        const prevTitle = document.title;
        document.title = props.title;
        cleanups.push(() => {
          document.title = prevTitle;
        });
      }

      // Apply meta tags
      if (props.meta) {
        props.meta.forEach((meta) => {
          cleanups.push(applyMeta(meta));
        });
      }

      // Apply link tags
      if (props.links) {
        props.links.forEach((link) => {
          cleanups.push(applyLink(link));
        });
      }

      // Register cleanup on unmount
      yield* Scope.addFinalizer(
        scope,
        Effect.sync(() => {
          // Run cleanups in reverse order
          cleanups.toReversed().forEach((fn) => fn());
        }),
      );

      if (DEV) {
        yield* Effect.logDebug(`Head: applied ${cleanups.length} head mutations`);
      }
    }

    return jsx("FRAGMENT", { children: [] });
  });
