# SSR E2E Test Plan: Effect HTTP Server + Vite Proxy

## Goal

Create a real E2E test for SSR → hydration flow using Effect HTTP server. Vite dev server proxies SSR routes to Effect server. This validates the complete SSR/hydration pipeline works correctly.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Browser (Cypress)                         │
│                         │                                    │
│                         ▼                                    │
│              http://localhost:5173/ssr                       │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                 Vite Dev Server (:5173)                      │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  proxy: { '/ssr': 'http://localhost:3001' }         │    │
│  └─────────────────────────────────────────────────────┘    │
│                          │                                   │
│       /ssr/* ────────────┼──────────────► Effect Server     │
│       /src/* ◄───────────┴─────── serve client assets       │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│              Effect HTTP Server (:3001)                      │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  GET /ssr → renderToString(<App />) → HTML          │    │
│  │            + embedded state + hydration script ref   │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

## Long-Term Vision

This is Phase 1 of a larger framework architecture:

### Phase 1: SSR E2E Test (Current)
- Effect HTTP server serves SSR HTML
- Vite proxies to Effect server
- Validates core SSR/hydration APIs

### Phase 2: Vite Plugin (`vite-plugin-fibrae`)
- Development experience: HMR, fast refresh
- SSR middleware for dev mode
- Build configuration for client + server bundles

### Phase 3: Router Integration
- File-based routing or explicit routes
- Route-level code splitting
- Data loading (loader functions)

### Phase 4: Production HTTP Server Package
- `@fibrae/server` or similar
- Built on Effect HTTP platform
- Serves static assets + SSR routes
- Streaming SSR support

---

## Phase 1 Implementation Plan

### Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `packages/demo/server/ssr-server.ts` | Create | Effect HTTP server with SSR route |
| `packages/demo/src/ssr-app.tsx` | Create | Shared component (server + client) |
| `packages/demo/src/ssr-hydrate.tsx` | Create | Client hydration entry point |
| `packages/demo/vite.config.ts` | Modify | Add proxy for `/ssr` → `:3001` |
| `packages/demo/package.json` | Modify | Add `dev:ssr` script |
| `packages/demo/cypress/e2e/ssr-hydration.cy.ts` | Create | E2E test |
| `packages/fibrae/src/core.ts` | Modify | Add `initialState` option to `render()` |

---

## Subtasks

### 1. Add `initialState` option to `render()` (prerequisite)

**File:** `packages/fibrae/src/core.ts`

Modify `render()` to accept `options.initialState`:
- If `initialState` is provided and container has children → hydration mode
- Call `Hydration.hydrate(registry, initialState)` before hydrating DOM
- This rehydrates atom values from SSR state

```typescript
export interface RenderOptions {
  layer?: Layer.Layer<unknown, unknown, AtomRegistry.AtomRegistry>;
  initialState?: ReadonlyArray<Hydration.DehydratedAtom>;
}

export function render(
  element: VElement,
  container: HTMLElement,
  options?: RenderOptions
): Effect.Effect<never, never, never>;
```

**TDD approach:**
1. Write test first: E2E test that passes initialState and verifies atoms have correct values
2. Implement the feature
3. Verify test passes

---

### 2. Create shared SSR app component

**File:** `packages/demo/src/ssr-app.tsx`

Counter component that works on both server and client:

```tsx
/** @jsxImportSource fibrae */
import * as Effect from "effect/Effect";
import { Atom, AtomRegistry } from "@effect-atom/atom";

// Use Atom.serializable for state transfer
export const countAtom = Atom.serializable("count", 0);

export const Counter = () => {
  return Effect.gen(function* () {
    const registry = yield* AtomRegistry.AtomRegistry;
    const count = registry.get(countAtom);

    return (
      <div data-cy="ssr-counter">
        <p data-cy="ssr-count">{String(count)}</p>
        <button
          data-cy="ssr-increment"
          onClick={() => registry.update(countAtom, (c: number) => c + 1)}
        >
          Increment
        </button>
      </div>
    );
  });
};

export const App = () => (
  <div>
    <h1 data-cy="ssr-title">SSR Counter</h1>
    <Counter />
  </div>
);
```

**Key:** Uses `Atom.serializable("count", 0)` - the string key enables state serialization/deserialization.

---

### 3. Create Effect HTTP SSR server

**File:** `packages/demo/server/ssr-server.ts`

```typescript
import * as Effect from "effect/Effect";
import { HttpServer, HttpServerResponse, HttpRouter } from "@effect/platform";
import { BunRuntime, BunHttpServer } from "@effect/platform-bun";
import { Layer } from "effect";
import { h } from "fibrae";
import { renderToString } from "fibrae/server";
import { App } from "../src/ssr-app.js";

// SSR route handler
const ssrHandler = Effect.gen(function* () {
  const { html, dehydratedState } = yield* renderToString(h(App));
  
  const page = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Fibrae SSR</title>
</head>
<body>
  <div id="root">${html}</div>
  <script>window.__FIBRAE_STATE__ = ${JSON.stringify(dehydratedState)};</script>
  <script type="module" src="/src/ssr-hydrate.tsx"></script>
</body>
</html>`;

  return HttpServerResponse.html(page);
});

// Router
const router = HttpRouter.empty.pipe(
  HttpRouter.get("/ssr", ssrHandler)
);

// Server
const server = HttpServer.serve(router).pipe(
  HttpServer.withLogAddress,
  Layer.provide(BunHttpServer.layer({ port: 3001 }))
);

BunRuntime.runMain(Layer.launch(server));
```

**Key points:**
- Serves on port 3001
- GET `/ssr` returns full HTML page
- Embeds `window.__FIBRAE_STATE__` with serialized atom state
- References hydration script from Vite: `/src/ssr-hydrate.tsx`

---

### 4. Create client hydration entry

**File:** `packages/demo/src/ssr-hydrate.tsx`

```tsx
/** @jsxImportSource fibrae */
import * as Effect from "effect/Effect";
import * as BrowserPlatform from "@effect/platform-browser";
import { render } from "fibrae";
import { App } from "./ssr-app.js";

declare global {
  interface Window {
    __FIBRAE_STATE__?: unknown;
  }
}

const container = document.getElementById("root") as HTMLElement;
const initialState = window.__FIBRAE_STATE__ as ReadonlyArray<unknown> | undefined;

Effect.gen(function* () {
  yield* Effect.fork(render(<App />, container, { initialState }));
  
  // Give hydration a moment to complete
  yield* Effect.sleep("10 millis");
  
  // Mark hydration complete for testing
  container.setAttribute("data-hydrated", "true");
  
  return yield* Effect.never;
}).pipe(
  Effect.catchAllDefect((e) => Effect.log(e)),
  BrowserPlatform.BrowserRuntime.runMain
);
```

**Key:** Passes `initialState` to `render()` so atoms are rehydrated with server values.

---

### 5. Configure Vite proxy

**File:** `packages/demo/vite.config.ts`

Add to the config:

```typescript
export default defineConfig({
  server: {
    proxy: {
      '/ssr': 'http://localhost:3001',
    },
  },
  // ... existing config
});
```

**Effect:** Requests to `http://localhost:5173/ssr` are proxied to `http://localhost:3001/ssr`.

---

### 6. Add npm scripts

**File:** `packages/demo/package.json`

Add scripts:

```json
{
  "scripts": {
    "dev:ssr": "bun server/ssr-server.ts",
    "dev:all": "run-p dev:server dev:ssr"
  }
}
```

- `dev:ssr` - Start the Effect SSR server
- `dev:all` - Start both Vite and SSR server in parallel

---

### 7. Create E2E test

**File:** `packages/demo/cypress/e2e/ssr-hydration.cy.ts`

```typescript
describe("SSR Hydration", () => {
  beforeEach(() => {
    // Both servers should be running: Vite on 5173, SSR on 3001
    cy.visit("/ssr");
  });

  it("renders on server and hydrates on client", () => {
    // 1. Verify pre-rendered content is visible immediately
    cy.get("[data-cy='ssr-title']").should("contain", "SSR Counter");
    cy.get("[data-cy='ssr-count']").should("contain", "0");

    // 2. Wait for hydration to complete
    cy.get("#root[data-hydrated='true']", { timeout: 5000 }).should("exist");

    // 3. Verify interactivity works (event handlers attached)
    cy.get("[data-cy='ssr-increment']").click();
    cy.get("[data-cy='ssr-count']").should("contain", "1");

    // 4. Click again to verify reactivity
    cy.get("[data-cy='ssr-increment']").click();
    cy.get("[data-cy='ssr-count']").should("contain", "2");
  });

  it("preserves server-rendered state during hydration", () => {
    // The count should be 0 (server-rendered value)
    cy.get("[data-cy='ssr-count']").should("contain", "0");
    
    // After hydration, the atom should still have value 0
    cy.get("#root[data-hydrated='true']", { timeout: 5000 });
    cy.get("[data-cy='ssr-count']").should("contain", "0");
  });
});
```

---

## Open Questions

1. **Atom.serializable API**: Need to verify `Atom.serializable("key", defaultValue)` exists in effect-atom. If not, we may need to use a different approach for state serialization.

2. **Test runner strategy**: Should the E2E test assume SSR server is already running? Options:
   - **A)** Assume both servers running (like current Vite assumption) - simpler
   - **B)** Use `start-server-and-test` to auto-start SSR server - more robust for CI

3. **Error handling in SSR**: If `renderToString` fails, what should the SSR server return? 500 error? Fallback HTML?

4. **HTML structure**: The SSR HTML must have no whitespace between elements (per our strict hydration decision). Need to ensure the template string doesn't introduce whitespace.

---

## Execution Order

1. **First**: Implement `initialState` option in `render()` (task fibrae-8q0)
2. **Second**: Create `ssr-app.tsx` (shared component)
3. **Third**: Create `ssr-server.ts` (Effect HTTP server)
4. **Fourth**: Create `ssr-hydrate.tsx` (client entry)
5. **Fifth**: Update `vite.config.ts` (proxy)
6. **Sixth**: Update `package.json` (scripts)
7. **Seventh**: Create E2E test
8. **Eighth**: Run test and iterate

---

## Success Criteria

- [ ] SSR server renders HTML with embedded state
- [ ] Vite correctly proxies `/ssr` to SSR server
- [ ] Client hydration attaches event handlers without DOM changes
- [ ] Atom state is preserved across SSR → hydration
- [ ] E2E test passes: click increments counter after hydration
- [ ] No hydration mismatch errors in console
