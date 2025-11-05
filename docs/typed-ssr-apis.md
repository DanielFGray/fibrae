Title: Typed SSR/Hydration APIs — What They Do and Where To Find Them
Overview
- Goal: Summarize @typed’s SSR and hydration primitives to inform Didact’s SSR design.
- Key ideas: environment-driven rendering, streaming HTML, hydration markers, scheduling abstraction, and template/cache layering.
Core Services
- RenderTemplate
  - What: Context service to render a tagged template into streamable render events (environment-pluggable).
  - Why: Decouples the act of rendering from DOM/HTML specifics; easy to switch between DOM, server, and static.
  - Where: packages/typed/packages/template/src/RenderTemplate.ts:16
- RenderContext
  - What: Holds environment and caches for roots and parsed templates.
    - environment: “dom” | “server” | “static” | test variants
    - renderCache: WeakMap per root
    - templateCache: WeakMap per TemplateStringsArray
  - Why: Central hub that shapes behavior per environment and avoids repeated parsing.
  - Where: packages/typed/packages/template/src/RenderContext.ts:21
  - Layers:
    - dom(window): packages/typed/packages/template/src/RenderContext.ts:92
    - server: packages/typed/packages/template/src/RenderContext.ts:110
    - static: packages/typed/packages/template/src/RenderContext.ts:120
Server/Static HTML Rendering
- serverLayer and staticLayer
  - What: Compose RenderTemplate with server/static RenderContext and sync RenderQueue.
  - Why: One-liners to provide all server/static services for SSR or static HTML.
  - Where: packages/typed/packages/template/src/Html.ts:36 (serverLayer), packages/typed/packages/template/src/Html.ts:49 (staticLayer)
- renderToHtml and renderToHtmlString
  - What: Project stream of render events to HTML chunks; join to a string.
  - Why: Enables streaming SSR and non-streaming string output with the same pipeline.
  - Where: packages/typed/packages/template/src/Html.ts:62 (renderToHtml), packages/typed/packages/template/src/Html.ts:71 (renderToHtmlString)
- renderHtmlTemplate
  - What: Server-side renderer implementation that:
    - Emits HTML chunks for static text and dynamic parts
    - In “server” mode includes hydration markers around dynamic regions; in “static” mode omits them
    - Skips directives/events (not rendered to HTML)
  - Why: Core HTML emission logic for SSR, grounded in template parsing + part-based rendering.
  - Where: packages/typed/packages/template/src/Html.ts:80
Hydration
- hydrate and hydrateToLayer
  - What: Client-side attachment that walks server-emitted markers to attach event handlers/effects without re-rendering nodes.
  - Why: Efficient, marker-guided hydration; supports nested templates and “many” lists.
  - Where: packages/typed/packages/template/src/Hydrate.ts:21 (hydrate), packages/typed/packages/template/src/Hydrate.ts:45 (hydrateToLayer)
- HydrateContext
  - What: Context flag and root pointer for hydration; may carry “manyKey” during list hydration.
  - Why: Controls whether current rendering step hydrates or renders fresh.
  - Where: packages/typed/packages/template/src/internal/HydrateContext.ts:8
- Hydration internals and part mapping
  - What: Locator and setup for hydrating each part/path; handles nested and sparse parts and lists.
  - Why: Robust mapping between server markers and client nodes.
  - Where: packages/typed/packages/template/src/internal/v2/render.ts:681 (setupHydrateParts and friends)
Browser Rendering
- renderLayer (browser)
  - What: Provides RenderTemplate bound to DOM via Document + RenderContext.dom(window).
  - Why: Single entry to set up browser runtime for rendering Fx into the root.
  - Where: packages/typed/packages/template/src/Render.ts:30
- render and renderToLayer
  - What: Attach render stream to a RootElement using the RenderContext’s render cache and DOM implementation.
  - Why: Entry points for interactive client rendering.
  - Where: packages/typed/packages/template/src/Render.ts:61 (render), packages/typed/packages/template/src/Render.ts:78 (renderToLayer)
Scheduling
- RenderQueue
  - What: Abstraction for scheduling render work; sync vs raf.
  - Why: Keeps scheduling environment-specific (e.g., sync on server/tests, raf on browser).
  - Where:
    - Tag/exports: packages/typed/packages/template/src/index.ts:58
    - Used in layers: packages/typed/packages/template/src/Html.ts:42, packages/typed/packages/template/src/Html.ts:55
Key Behaviors To Mirror
- Environment-driven semantics
  - Server/static: one-shot emission for reactive sources; no long-lived subscriptions.
  - Dom: full reactivity with ongoing subscriptions.
  - Where (design note): packages/typed/packages/ui/CHANGELOG.md:117
- Hydration markers strategy
  - Use stable comment or sentinel markers around dynamic holes and text to enable precise client attachment.
  - Where: packages/typed/packages/template/src/Html.ts:205 (node part markers and TEXT_START handling)
- Directives/events excluded from HTML
  - Server skips rendering of events/refs; they’re only considered during hydration.
  - Where: packages/typed/packages/template/src/Html.ts:196
- Template + root caches
  - Cache parsed templates and root attachments for performance and correctness across re-renders.
  - Where: packages/typed/packages/template/src/RenderContext.ts:30, packages/typed/packages/template/src/RenderContext.ts:35
How This Informs Didact
- Introduce a DidactRenderTemplate service and DidactRenderContext with environment + caches.
- Provide server/static layers that expose renderToHtml/renderToString.
- Add hydrate(root, app) that locates server markers and attaches handlers without node recreation.
- Gate Atoms/Streams to single emission in “server” env, remain reactive in “dom”.
- Add RenderQueue abstraction: sync for server/static/tests; raf for browser.
- Offer streaming SSR (chunks) and non-streaming (string) helpers.
