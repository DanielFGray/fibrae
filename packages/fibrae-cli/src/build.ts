/**
 * SSG build pipeline.
 *
 * Orchestrates: Vite client build → route discovery → pre-render → write HTML.
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { renderToStringWith, SSRAtomRegistryLayer } from "fibrae/server";
import { Router, RouterHandlers, getPrerenderRoutes } from "fibrae/router";
import type { HeadData, PrerenderRoute, RouteHandler } from "fibrae/router";
import type { VElement } from "fibrae/shared";
import { buildPage } from "./html.js";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Render a single route to an HTML string.
 */
const renderRoute = (config: {
  readonly router: Router.Router;
  readonly handlersLayer: Layer.Layer<RouterHandlers>;
  readonly appShell: (element: VElement) => VElement;
  readonly pathname: string;
  readonly basePath: string;
  readonly clientScript?: string;
  readonly title?: string;
  readonly headTags?: HeadData;
}): Effect.Effect<string, unknown> =>
  Effect.gen(function* () {
    const serverLayer = Router.serverLayer({
      router: config.router,
      pathname: config.pathname,
      search: "",
      basePath: config.basePath,
    });

    const fullLayer = Layer.provideMerge(
      serverLayer,
      Layer.merge(config.handlersLayer, SSRAtomRegistryLayer),
    );

    const { html, dehydratedState, head } = yield* Effect.gen(function* () {
      const { element, head } = yield* Router.CurrentRouteElement;
      const renderResult = yield* renderToStringWith<never>(config.appShell(element));
      return { ...renderResult, head };
    }).pipe(Effect.provide(fullLayer));

    return yield* buildPage({
      html,
      dehydratedState: dehydratedState as unknown[],
      clientScript: config.clientScript,
      title: config.title,
      head,
      headTags: config.headTags,
    });
  });

/**
 * Compute all (pathname, handler) pairs from prerender routes.
 */
const expandRoutes = (
  prerenderRoutes: ReadonlyArray<PrerenderRoute>,
  basePath: string,
): ReadonlyArray<{ pathname: string; handler: RouteHandler }> =>
  prerenderRoutes.flatMap(({ handler, paramSets }) =>
    paramSets.map((params) => ({
      pathname: basePath + handler.route.interpolate(params as Record<string, never>),
      handler,
    })),
  );

/**
 * Write an HTML string to the appropriate file path under outDir.
 * Creates directories as needed.
 *
 * /           → outDir/index.html
 * /about      → outDir/about/index.html
 * /posts/1    → outDir/posts/1/index.html
 */
const writePageFile = (outDir: string, pathname: string, html: string): void => {
  const filePath = pathname === "/" || pathname === ""
    ? path.join(outDir, "index.html")
    : path.join(outDir, pathname, "index.html");

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, html, "utf-8");
};

export interface BuildOptions {
  /** The fibrae router instance */
  readonly router: Router.Router;
  /** Layer providing RouterHandlers */
  readonly handlersLayer: Layer.Layer<RouterHandlers>;
  /** Wraps each route's rendered element in the app shell */
  readonly appShell: (element: VElement) => VElement;
  /** Output directory */
  readonly outDir: string;
  /** Base path prefix for routes (e.g. "/app") */
  readonly basePath?: string;
  /** Path to client JS bundle (relative to site root) */
  readonly clientScript?: string;
  /** Default page title */
  readonly title?: string;
  /** Global head tags injected into every page */
  readonly headTags?: HeadData;
}

/**
 * Pre-render all routes marked with `prerender: true` to static HTML files.
 */
export const build = (options: BuildOptions): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const {
      router,
      handlersLayer,
      appShell,
      outDir,
      basePath = "",
      clientScript,
      title,
      headTags,
    } = options;

    // Resolve handlers to get prerender routes
    const handlers = yield* Effect.provide(
      Effect.flatMap(RouterHandlers, (h) => getPrerenderRoutes(h)),
      handlersLayer,
    );

    const routes = expandRoutes(handlers, basePath);

    if (routes.length === 0) {
      console.log("No prerender routes found.");
      return;
    }

    console.log(`Pre-rendering ${routes.length} page(s)...`);

    // Render all routes
    const pages = yield* Effect.all(
      routes.map(({ pathname }) =>
        renderRoute({
          router,
          handlersLayer,
          appShell,
          pathname,
          basePath,
          clientScript,
          title,
          headTags,
        }).pipe(Effect.map((html) => ({ pathname, html }))),
      ),
    );

    // Write all pages to disk
    pages.forEach(({ pathname, html }) => {
      writePageFile(outDir, pathname, html);
      console.log(`  ${pathname} → ${outDir}${pathname === "/" ? "/index.html" : `${pathname}/index.html`}`);
    });

    console.log(`Done. ${pages.length} page(s) written to ${outDir}/`);
  });
