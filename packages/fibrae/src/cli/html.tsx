/**
 * HTML page template for static site generation.
 *
 * Uses fibrae JSX to generate full HTML documents wrapping
 * pre-rendered content with dehydrated state and client scripts.
 */
// eslint-disable-next-line no-unused-vars -- jsx is used by the JSX transform (jsxFactory)
import { jsx } from "../jsx-runtime/index.js";
import { h } from "../h.js";
import type { HeadData, MetaDescriptor } from "../router/RouterBuilder.js";
import { renderToString } from "../server.js";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Array from "effect/Array";
import type { VElement } from "../shared.js";

export interface PageOptions {
  readonly html: string;
  readonly dehydratedState: ReadonlyArray<unknown>;
  readonly clientScript?: string;
  readonly title?: string;
  readonly head: Option.Option<HeadData>;
  /** Global head tags from config, merged with per-route head */
  readonly headTags?: HeadData;
}

const metaToElement = (meta: MetaDescriptor): Option.Option<VElement> => {
  if ("title" in meta) return Option.none();
  if ("charset" in meta) return Option.some(<meta charset={meta.charset} />);
  if ("script:ld+json" in meta)
    return Option.some(
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={JSON.stringify(meta["script:ld+json"])}
      />,
    );
  if ("name" in meta) return Option.some(<meta name={meta.name} content={meta.content} />);
  if ("property" in meta)
    return Option.some(<meta property={meta.property} content={meta.content} />);
  if ("httpEquiv" in meta)
    return Option.some(<meta http-equiv={meta.httpEquiv} content={meta.content} />);
  if ("tagName" in meta) {
    const { tagName, ...attrs } = meta;
    // Dynamic tag name -- JSX requires literal tags, so use h() directly
    return Option.some(h(tagName, attrs));
  }
  return Option.none();
};

/**
 * Get the dedup key for a meta descriptor.
 * Per TanStack Router pattern: meta tags with the same name/property are
 * deduplicated, with per-route tags winning over global tags.
 */
const metaKey = (meta: MetaDescriptor): string | undefined => {
  if ("name" in meta) return `name:${meta.name}`;
  if ("property" in meta) return `property:${meta.property}`;
  if ("httpEquiv" in meta) return `httpEquiv:${meta.httpEquiv}`;
  if ("charset" in meta) return "charset";
  return undefined;
};

/**
 * Merge meta arrays with deduplication. Per-route entries override globals
 * when they share the same name/property/httpEquiv key.
 */
const dedupMeta = (
  global: ReadonlyArray<MetaDescriptor>,
  perRoute: ReadonlyArray<MetaDescriptor>,
): ReadonlyArray<MetaDescriptor> => {
  const routeKeys = new Set(perRoute.map(metaKey).filter(Boolean));
  const filtered = global.filter((m) => {
    const key = metaKey(m);
    return key === undefined || !routeKeys.has(key);
  });
  return [...filtered, ...perRoute];
};

const buildHeadChildren = (
  title: string | undefined,
  head: Option.Option<HeadData>,
  headTags?: HeadData,
): VElement[] => {
  const headData = Option.getOrUndefined(head);
  // Per-route title wins, then global headTags title, then config title
  const pageTitle = headData?.title ?? headTags?.title ?? title;

  // Merge global headTags with per-route head.
  // Meta tags are deduplicated by name/property (per-route wins).
  // Links and scripts are concatenated (global first, then per-route).
  const allMeta = dedupMeta(headTags?.meta ?? [], headData?.meta ?? []);
  const allLinks = [...(headTags?.links ?? []), ...(headData?.links ?? [])];
  const allScripts = [...(headTags?.scripts ?? []), ...(headData?.scripts ?? [])];

  return [
    <meta charset="UTF-8" />,
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />,
    ...Option.match(Option.fromNullable(pageTitle), {
      onNone: () => [] as VElement[],
      onSome: (t) => [<title>{t}</title>],
    }),
    ...Array.filterMap(allMeta, metaToElement),
    ...allLinks.map((attrs) => <link {...attrs} />),
    ...allScripts.flatMap((script) =>
      script.src
        ? [<script type={script.type} src={script.src} />]
        : script.content
          ? [<script type={script.type} dangerouslySetInnerHTML={script.content} />]
          : [],
    ),
  ];
};

const PageShell = (props: PageOptions) => (
  <html lang="en">
    <head>{buildHeadChildren(props.title, props.head, props.headTags)}</head>
    <body>
      <div id="root" dangerouslySetInnerHTML={props.html} />
      <script
        type="application/json"
        id="__fibrae-state__"
        dangerouslySetInnerHTML={JSON.stringify(props.dehydratedState)}
      />
      {props.clientScript ? <script type="module" src={props.clientScript} /> : null}
    </body>
  </html>
);

export const buildPage = (options: PageOptions): Effect.Effect<string, unknown> =>
  renderToString(PageShell(options)).pipe(Effect.map(({ html }) => `<!DOCTYPE html>\n${html}`));
