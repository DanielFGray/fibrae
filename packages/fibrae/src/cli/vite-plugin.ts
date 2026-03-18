/**
 * Vite plugin for fibrae static site generation.
 *
 * Hooks into Vite's build pipeline to pre-render routes after the client build.
 * In dev mode, provides on-demand SSR middleware.
 */
import type { Plugin, ResolvedConfig, ViteDevServer, ModuleNode } from "vite";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Layer from "effect/Layer";
import { NodeContext } from "@effect/platform-node";
import { Router, RouterHandlers } from "../router/index.js";
import { renderToStringWith, SSRAtomRegistryLayer } from "../server.js";
import type { VElement } from "../shared.js";
import { buildPage } from "./html.js";
import type { FibraeConfig } from "./config.js";

/**
 * Render a single page for the dev server.
 */
const renderDevPage = (opts: {
  router: Router.Router;
  handlersLayer: Layer.Layer<RouterHandlers>;
  App?: () => VElement;
  appShell?: (element: VElement) => VElement;
  pathname: string;
  basePath: string;
  clientScript: string;
  title?: string;
  headTags?: import("fibrae/router").HeadData;
}): Effect.Effect<string, unknown> =>
  Effect.gen(function* () {
    const serverLayer = Router.serverLayer({
      router: opts.router,
      pathname: opts.pathname,
      search: "",
      basePath: opts.basePath,
    });

    const fullLayer = Layer.provideMerge(
      serverLayer,
      Layer.merge(opts.handlersLayer, SSRAtomRegistryLayer),
    );

    const { html, dehydratedState, head } = yield* Effect.gen(function* () {
      const { head: routeHead } = yield* Router.CurrentRouteElement;
      const renderResult = opts.App
        ? yield* renderToStringWith<never>(opts.App())
        : yield* Effect.gen(function* () {
            const { element } = yield* Router.CurrentRouteElement;
            const app = opts.appShell ? opts.appShell(element) : element;
            return yield* renderToStringWith<never>(app);
          });
      return { ...renderResult, head: routeHead };
    }).pipe(Effect.provide(fullLayer));

    return yield* buildPage({
      html,
      dehydratedState: dehydratedState as unknown[],
      clientScript: opts.clientScript,
      title: opts.title,
      head,
      headTags: opts.headTags,
    });
  });

/**
 * Walk the Vite module graph from an entry and collect CSS module URLs.
 * Injects these as <style> tags in the SSR HTML to prevent FOUC.
 */
const collectCss = async (server: ViteDevServer, entryUrl: string): Promise<string[]> => {
  // Warm the module graph so CSS deps are discovered
  await server.transformRequest(entryUrl);

  const seen = new Set<string>();
  const cssUrls: string[] = [];

  const walk = (mod: ModuleNode | undefined) => {
    if (!mod?.id || seen.has(mod.id)) return;
    seen.add(mod.id);
    if (mod.id.endsWith(".css")) {
      cssUrls.push(mod.url);
    }
    for (const dep of mod.importedModules) {
      walk(dep);
    }
  };

  walk(await server.moduleGraph.getModuleByUrl(entryUrl));
  return cssUrls;
};

export const fibrae = (config: FibraeConfig): Plugin => {
  let _resolvedConfig: ResolvedConfig;
  let clientEntryId: string | undefined;

  return {
    name: "fibrae-ssg",

    configResolved(resolved) {
      _resolvedConfig = resolved;
    },

    // Resolve the client entry path so we can match it in transform
    async resolveId(source) {
      if (source === config.client) {
        const resolved = await this.resolve(source);
        if (resolved) clientEntryId = resolved.id;
      }
      return null;
    },

    // Inject HMR accept into the client entry so Vite re-executes it on changes.
    // render() detects the previous render via WeakMap and does a clean re-render
    // with preserved atom state.
    transform(code, id) {
      if (_resolvedConfig.command !== "serve") return null;
      if (!clientEntryId || id !== clientEntryId) return null;

      return {
        code: code + "\n\nif (import.meta.hot) { import.meta.hot.accept(); }\n",
        map: null,
      };
    },

    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url;
        if (!url || url.startsWith("/@") || url.includes(".")) {
          return next();
        }

        try {
          const appModule = await server.ssrLoadModule(config.entry);
          const { router, handlersLayer, appShell, App } = appModule;

          if (!router || !handlersLayer) {
            return next();
          }

          // Only SSR routes the router knows about; pass everything else through
          if (Option.isNone(router.matchRoute(url))) {
            return next();
          }

          const rawHtml = await Effect.runPromise(
            renderDevPage({
              router,
              handlersLayer,
              App,
              appShell,
              pathname: url,
              basePath: config.basePath ?? "",
              clientScript: config.client,
              title: config.title,
              headTags: config.headTags,
            }),
          );

          // Collect CSS from client entry's module graph and inject into <head>
          const cssUrls = await collectCss(server, config.client);
          const cssTags = cssUrls.map((u) => `<link rel="stylesheet" href="${u}">`).join("\n");
          const withCss = cssTags ? rawHtml.replace("</head>", `${cssTags}\n</head>`) : rawHtml;

          // Let Vite inject HMR client
          const result = await server.transformIndexHtml(url, withCss);

          res.setHeader("Content-Type", "text/html");
          res.end(result);
        } catch {
          next();
        }
      });
    },

    async closeBundle() {
      if (_resolvedConfig.command !== "build") return;

      const outDir = config.outDir ?? _resolvedConfig.build.outDir ?? "dist";

      try {
        const entryPath = new URL(config.entry, `file://${process.cwd()}/`).pathname;
        const appModule = await import(entryPath);
        const { router, handlersLayer, appShell } = appModule;

        if (!router || !handlersLayer) {
          console.warn(
            "[fibrae-ssg] Entry module missing router or handlersLayer exports. Skipping SSG.",
          );
          return;
        }

        const { build: ssgBuild } = await import("./build.js");

        const clientScript = config.client
          ? `/${config.client.replace(/\.tsx?$/, ".js")}`
          : undefined;

        await Effect.runPromise(
          ssgBuild({
            router,
            handlersLayer,
            appShell: appShell ?? ((el: VElement) => el),
            outDir,
            basePath: config.basePath ?? "",
            clientScript,
            title: config.title,
            headTags: config.headTags,
          }).pipe(Effect.provide(NodeContext.layer)),
        );
      } catch (e) {
        console.error("[fibrae-ssg] Pre-render failed:", e);
      }
    },
  };
};
