
## Project Overview

**Verso** is a streaming SSR framework, and **isomorphic-stores** is its state management layer — a framework-agnostic adapter system for plugging Zustand, Redux, etc. into Verso's SSR model.

Verso owns the server and the bundler. It ships as a Vite plugin (`build/plugin.ts`). Configuration lives in `vite.config.ts` via the plugin options — there is no separate `verso.config.ts`. The user does not own a server file.

### Architecture

**Server request flow:** `handleRoute` → `startRequest` (enters `AsyncLocalStorage`) → `createHandlerChain` (builds page + middleware) → `getRouteDirective` (data fetching, redirects) → `handlePage` → `makeStreamer` → `stream()`.

**Streaming:** `writePage` writes `<head>` synchronously, then `writeBody` renders roots via a token queue (PENDING → RENDERED → WRITTEN). Each root's `scheduleRender` resolves a React element, which is `renderToString`'d. Roots are written in order — a slow root blocks later ones. An `AbortSignal.timeout` marks still-PENDING roots as TIMEOUT. After the body, `bootstrapClient` dehydrates the fetch cache and injects `<script>` tags. Late-arriving fetch responses are piped to the client via `VersoPipe` after the fold.

**Client hydration:** `ClientController.hydrate()` reads the `VersoPipe`, rehydrates the fetch cache, then hydrates React roots as their DOM nodes stream in. `VersoPipe.onCallFn(FN_HYDRATE_ROOTS_UP_TO)` triggers hydration progressively. `CLIENT_READY_DFD` resolves when all roots are hydrated.

**Client navigation:** `ClientController.navigate()` re-runs the handler chain client-side, unmounts old roots, and renders new ones via `createRoot`/`flushSync`.

### Page composition model

Pages are **multi-root** — a page returns an array of React elements, not a single tree. The element array is tokenized into a flat stream of `Root`, `RootContainer`, `TheFold`, and container open/close tokens.

- **Root**: an independent React application. Each root is `renderToString`'d on the server and `hydrateRoot`'d on the client. Roots render in parallel but are written to the stream in order.
- **RootContainer**: a structural wrapper (`<div>` with props like `id`, `className`). Groups roots for layout. Not a rendered React component — it's metadata consumed by the tokenizer.
- **TheFold**: a control element that marks where client bootstrap happens. Roots before the fold stream as inert HTML; the client bootstraps at the fold (scripts injected, fetch cache dehydrated), then hydrates roots progressively as their DOM arrives. If omitted, bootstrap happens after the last root.

### Handler definitions

- `definePage(init)` and `defineEndpoint(init)` are the user-facing APIs for route handlers. `init` receives a `RouteHandlerCtx` with `getConfig()`, `getRoute()`, and `getRequest()`.
- **Pages** must implement `getRouteDirective()` (returns `{ status, location?, hasDocument? }`) and `getElements()` (returns `ReactElement[]`). Optional: `getTitle()`, `getStylesheets()`, `getScripts()`, `getLinkTags()`, `getMetaTags()`, `getBodyClasses()`, `getHeaders()`.
- **Endpoints** must implement `getRouteDirective()`, `getContentType()`, and `getResponseData()` (returns string, ArrayBuffer, or ReadableStream).
- Non-2XX page responses don't stream HTML unless `hasDocument: true` is set in the route directive.

### Routing

Routes are defined in config as a `RoutesMap`: `{ routeName: { path, handler, method? } }`. Uses `path-to-regexp` for matching. Routes are matched in declaration order (first match wins). The same route definitions are used on both client and server.

### Middleware

Middleware wraps handler methods via a `next()` chain (like Express). Defined with `defineMiddleware(scope, init)`. Each middleware can wrap any handler method — e.g., `getRouteDirective(next)` calls `next()` to delegate. Middleware can declare config keys via `addConfigValues()` and set them via `setConfigValues()`. Config keys must be pre-declared before handlers can read them.

### Fetch subsystem

`Fetch` (`core/fetch/Fetch.ts`) is an isomorphic fetch wrapper backed by `FetchCache`. It is the way app code should make data requests.

- **Server:** fetches go through native fetch, responses are cached in `FetchCache`. The cache is keyed by url + method + query + body. Deduplicates parallel requests to the same resource. The cache is dehydrated and sent to the client at bootstrap (before the fold).
- **Client:** on hydration, the cache is rehydrated from the server's dehydrated payload. Client-side `fetch()` calls hit the cache first; cache hits replay the server's response isomorphically. Post-hydration or cache-miss requests fall through to native fetch.
- **Late arrivals:** fetch requests still pending at the fold are "late arrivals." The server waits for them via `Promise.allSettled`, then pipes each resolved response to the client via `VersoPipe`'s `FN_RECEIVE_LATE_DATA_ARRIVAL`.
- **Interceptors:** `setFetchInterceptor` lets apps rewrite URLs/headers per-request (e.g. CSRF tokens, private origins). Does not affect the cache key.
- **Cookie forwarding:** same-origin server fetches automatically forward the page request's cookies. Cross-origin requires `credentials: 'include'` or `forceForwardRequestCookies`.

### Workspace layout

Bun workspace monorepo:

```
packages/
├── verso/                 # SSR framework — "@verso-js/verso"
├── stores/                # isomorphic-stores core — "@verso-js/stores"
├── store-adapter-zustand/ # "@verso-js/store-adapter-zustand"
├── store-adapter-redux/   # "@verso-js/store-adapter-redux"
├── store-adapter-valtio/  # "@verso-js/store-adapter-valtio"
└── demo/                  # demo app
```

### Key conventions

- The demo package uses `@/*` as a path alias to its own `src/`. Non-demo packages use relative imports.
- `IS_SERVER` and `IS_DEV` are compile-time constants (declared in `globals.d.ts`, defined by the Vite plugin). Use them for dead code elimination.
- Five modules hold per-request state via a single `AsyncLocalStorage` in `RequestLocalStorage.ts`. All request-path code must go through the same module loader or singletons break silently.
- `stores/` has no dependency on any SSR or store framework — integration is at the call site.
- Middleware scope defaults to `'page'`. Pass `'all'` or `'endpoint'` explicitly for other scopes.
- Cookies can only be set before streaming begins (i.e. during `getRouteDirective()` or handler init), not during element rendering.
- The Vite plugin produces a dual build: client bundle (ES modules + manifest in `bundles/`) and server bundle (static handler imports in `server/`). Virtual modules generate the entrypoints.

### TODOs
TODOs are tracked in ./TODO

---

## Dev runtime

Bun is used for running/building/installing during development, but framework code must avoid Bun-specific APIs (the framework targets Node's standard HTTP APIs).

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun install`, `bun run <script>`, `bunx <package>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `vitest` to run tests from within `packages/verso/`. Config is in `packages/verso/vitest.config.ts`.

Tests that need DOM globals use a per-file annotation:
```ts
// @vitest-environment jsdom
```

### E2E tests

E2E tests use Playwright in `packages/demo/e2e/`. Three suites: `smoke.spec.ts`, `stores.spec.ts`, `transitions.spec.ts`.

Run with:
- `cd packages/demo && bunx playwright test -c playwright.dev.config.ts` (or `bun run test:e2e`)
- `cd packages/demo && bunx playwright test -c playwright.prod.config.ts` (or `bun run test:e2e:prod`)

Fixtures (`e2e/helpers/fixtures.ts`):
- Patches `page.goto` to wait for verso client hydration (`CLIENT_READY_DFD`). Import `test` and `expect` from `./helpers/fixtures`.
- `consoleErrors` fixture auto-asserts no console errors after each test.
- Card components use `data-card` attribute for stable test locators.
