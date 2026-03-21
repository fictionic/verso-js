
## Project Overview

**Sluice** is a streaming SSR framework, and **isomorphic-stores** is its state management layer — a framework-agnostic adapter system for plugging Zustand, Redux, etc. into Sluice's SSR model. They live in one repo as a single package (`sluice`).

**Runtime strategy**: Sluice is not tied to Bun. Bun is used as the current dev runtime, but the framework will eventually use Vite for the dev server and support Node/Deno as production runtimes. Framework code should avoid Bun-specific APIs; Bun-specific code (like `bunBundler.ts`) is temporary and will be replaced.

The core idea: stores are created server-side before render, async data is declared via `waitFor`, and Sluice's `Root` component blocks rendering until the store is ready. Client-side components can also create stores independently via `useCreateClientStore`.

A secondary goal: replace the pattern of bubbling all UI updates up through a root element (which triggers full-tree re-renders) with granular per-component subscriptions via selectors.

### Source layout

```
src/
├── sluice/              # SSR framework
│   ├── Page.ts          # Page interface (handleRoute, getElements, getTitle, getStyles)
│   ├── bundle.ts        # bundler-agnostic types (RouteAssets, BundleManifest, BundleResult)
│   ├── bunBundler.ts    # Bun-specific bundler; produces BundleResult with per-route splitting
│   ├── constants.ts     # DOM attribute names (PAGE_ROOT_ELEMENT_ATTR, etc.)
│   ├── core/
│   │   ├── RequestContext.ts   # isomorphic request context (route params, cookies); RLS-backed
│   │   ├── SluicePipe.ts       # typed server→client pipe instance (schema + constants)
│   │   ├── elementTokenizer.ts
│   │   ├── fetch/
│   │   │   ├── index.ts        # consumer-facing export: just `fetch`
│   │   │   ├── Fetch.ts        # framework-facing interface: init, fetch, getCache
│   │   │   ├── cache.ts        # FetchCache class (server/client accessor objects)
│   │   │   └── nativeFetch.ts  # indirection for globalThis.fetch (mockable in tests)
│   │   └── components/
│   │       ├── Root.tsx
│   │       ├── RootContainer.tsx
│   │       └── TheFold.tsx
│   ├── client/
│   │   └── bootstrap.ts # client entry point; receives PageClass + route pattern
│   ├── server/
│   │   ├── createSluiceServer.ts  # wires up routing, bundle serving, and SSR handler
│   │   ├── handlePage.ts          # orchestrates per-request SSR
│   │   ├── stream.ts              # streaming HTML writer (header, roots, bootstrap, late arrivals)
│   │   ├── writeHeader.ts         # <head> rendering (title, styles, bundle stylesheets)
│   │   ├── writeBody.ts           # body rendering (roots, containers, TheFold)
│   │   ├── ResponseCookies.ts     # response cookie accumulator; RLS-backed
│   │   └── router.ts              # route matching via path-to-regexp
│   ├── tests/
│   └── util/
│       ├── ServerClientPipe.ts  # generic typed server→client pipe factory
│       ├── cookies.ts           # isomorphic cookie get/set util
│       └── requestLocal.ts
├── stores/              # isomorphic-stores library
│   ├── index.ts         # types-only entry point
│   ├── adapter.ts       # adapter author API
│   ├── provider.tsx     # IsoStoreProvider
│   ├── core/
│   │   ├── types.ts     # all public types (IsoStoreDefinition, IsoStoreInstance, etc.)
│   │   ├── define.ts    # defineIsoStore, internal logic
│   │   ├── constants.ts
│   │   ├── StoreProvider.tsx
│   │   └── lifecycle.ts
│   └── tests/
└── demo/                # demo app (exercises sluice + stores together)
    ├── server.tsx
    ├── routes.ts        # route definitions (path + page module path), typed as SluiceRoutes
    ├── DemoPage.tsx
    ├── LinkPage.tsx
    ├── StoreRoot.tsx
    ├── adapters/        # Zustand + Redux adapter implementations
    ├── stores/          # demo store definitions + defineZustandIsoStore wrapper
    └── components/
```

### Package exports
- `sluice` → `src/stores/index.ts` — types only
- `sluice/adapter` → `src/stores/adapter.ts` — adapter author API
- `sluice/provider` → `src/stores/provider.tsx` — `IsoStoreProvider`

### isomorphic-stores Architecture

Two-layer factory pattern:
- **Outer layer** (user-written `IsoStoreInit`): `(opts, { waitFor, onMessage, clientOnly }) => NativeStoreInit` — receives opts and a `fns` object, returns a native store initializer
- **Inner layer** (framework): e.g. `(set, get) => State` for Zustand — the native store creator

The `Adapter` bridges the two: `createNativeStore(nativeStoreInit)` turns the inner-layer result into an actual store instance.

Three levels of abstraction:
1. **`defineIsoStore(isoInit, adapter, options?)`** — core library function; framework-agnostic
2. **`getAdapter<State>()`** — adapter module (e.g. `demo/adapters/zustand.ts`); encapsulates framework-specific types. Must be called as `getAdapter<State>()` to ensure TypeScript infers `State` from the adapter.
3. **`defineZustandIsoStore(isoInit, options?)`** — application-layer wrapper in `demo/stores/define.ts`; combines adapter + `defineIsoStore`.

```ts
// Zustand example
defineZustandIsoStore<MyOpts, MyState, MyMessage>(
  ({ userId }, { waitFor, onMessage, clientOnly }) => (  // outer: opts + fns
    (set, get) => {                                      // inner: Zustand StateCreator
      onMessage((msg) => {
        if (msg.type === 'reset') set({ name: '' });
      });
      return {
        ...waitFor('name', fetchName(userId), ''),       // blocks SSR render until resolved
        ...clientOnly('recs', fetchRecs(userId), []),    // resolves after client mount
        setName: (name) => set({ name }),
      };
    }
  )
);

// Server-side usage
const store = MyStore.createStore({ userId: 1 });
// <Root when={store.whenReady}>
//   <IsoStoreProvider instances={[store]}>
//     <Widget />
//   </IsoStoreProvider>
// </Root>

// In server-rendered components
const name = MyStore.useStore(s => s.name);

// Client-only components
const { ready, useClientStore } = MyStore.useCreateClientStore({ userId: 1 });
const name = useClientStore(s => s.name); // undefined until ready

// Cross-root communication
MyStore.broadcast(message);
```

### Design decisions
- `waitFor(key, promise, initialValue)` — returns `{ key: initialValue }` to spread into state, registers promise; `setState` is called after native store is created (avoids chicken-and-egg). If a promise rejects, the key keeps its `initialValue` and `onError` is called if provided; `whenReady` still resolves.
- `clientOnly(key, promise, initialValue)` — same API as `waitFor` but doesn't contribute to `whenReady`; the promise is awaited after the component mounts (triggered via `onMount` in `STORE_INSTANCE_INTERNALS`, called from `useIsoStoreLifecycle`). Designed for late-arriving data that shouldn't block the initial render.
- `whenReady: Promise<void>` always resolves (never rejects), even if `waitFor` promises fail
- `stores/` has no dependency on any SSR or store framework — integration is at the call site
- `Adapter<State, NativeStore, NativeStoreInit, NativeHook, NativeClientHook>` is an interface with five methods: `createNativeStore(nativeStoreInit)`, `getSetState(nativeStore)`, `getHook(getNativeStore)`, `getClientHook(getNativeStore, ready)`, and `getEmpty()`. Adapters explicitly declare `NativeHook` and `NativeClientHook` as type aliases rather than using `typeof useNativeZustandStore`, since the actual hook signature (selector-only) differs from the underlying framework hook.
- `useStore` on `IsoStoreDefinition` is typed as `NativeHook` — fully transparent, delegates directly to the native framework hook.
- `onMessage(handler)` — registers a message handler on the store instance, returns `void`; called as a statement in the inner factory before returning state
- `broadcast(message)` — delivers a message to all currently-mounted instances of a store type (fire-and-forget). Is a no-op server-side.
- `options?: { onError?: (error: unknown) => void }` — third argument to `defineIsoStore`; called with a wrapped error when a `waitFor` promise rejects.
- Instance registration: `defineIsoStore` maintains `instancesByProvider: Map<ProviderID, IsoStoreInstance>` per definition. `StoreProvider` (internal) and `useCreateClientStore` each register/unregister independently under their own `ProviderID` (stable `useMemo` symbol).
- `STORE_INSTANCE_INTERNALS` symbol key on `IsoStoreInstance` holds `{ definition, identifier, nativeStore, messageHandlers, onMount }` — private to the library.
- `STORE_DEFINITION_INTERNALS` symbol key on `IsoStoreDefinition` holds `{ instancesByProvider, StoreProvider }` — keeps internals off the public API.

### Sluice SSR pipeline

- `createSluiceServer.ts` — wires everything together. Takes `routesPath` (path to routes module) and a `BundleResult`. Dynamically imports the routes module and each page class. Returns `routes` (static bundle-serving routes for `Bun.serve`) and `serve` (SSR request handler that matches routes, resolves page classes, and delegates to `handlePage`).
- `handlePage.ts` — orchestrates per-request SSR. Initializes RLS (`RequestContext`, `ResponseCookies`, `Fetch`), calls `page.handleRoute()`, then delegates to `makeStreamer` for streaming HTML. Takes `routeAssets: RouteAssets` (per-route scripts and stylesheets from the bundle manifest).
- `stream.ts` — streaming HTML writer. Writes the shell (`<head>`, styles, bundle stylesheets), then streams root elements in document order. At `TheFold`, injects the dehydrated fetch cache and per-route `<script>` tags from `routeAssets.scripts`. Below-fold roots get inline `hydrateRootsUpTo` pipe calls. Handles late data arrivals and timeouts.
- `router.ts` — route matching via `path-to-regexp`. Routes are defined as `SluiceRoutes` — a map of route names to `{ path, page }` where `page` is a module path string (not a class reference). `createRouter` compiles patterns and returns `matchRoute(path) => { routeName, page, params }`.
- `Root.tsx` — pass-through component; `when` is read directly from props by the stream writer.
- `TheFold.tsx` — null-rendering sentinel; identifies the above/below-fold boundary.
- `fetch/` — isomorphic fetch subsystem. Two audiences: consumers import `fetch` from `index.ts`; the framework uses `Fetch.init()`, `Fetch.fetch()`, and `Fetch.getCache()` from `Fetch.ts`. `Fetch.init()` creates a per-request `FetchCache` in RLS and sets `urlPrefix`. GETs are cached, deduplicated, and dehydrated; non-GETs pass through with `urlPrefix` applied. `FetchCache` exposes `server()` and `client()` accessor objects with environment-specific APIs. `nativeFetch.ts` provides an indirection over `globalThis.fetch` for testability.
- `ServerClientPipe.ts` — generic factory (`createPipe<Schema>`) for typed server→client data transport via inline `<script>` tags. `SluicePipe.ts` is the sluice-specific instance.
- `client/bootstrap.ts` — client entry point. Each route gets its own generated entry that imports the page class and calls `bootstrap(PageClass, routePattern)`. Bootstrap uses `path-to-regexp` to extract route params from `location.pathname`, initializes `RequestContext` (client mode) and `Fetch`, rehydrates the fetch cache from the pipe, tokenizes elements, then hydrates roots as `hydrateRootsUpTo` events arrive.
- `bundle.ts` — bundler-agnostic types. `RouteAssets = { scripts, stylesheets }`, `BundleManifest = { [routeName]: RouteAssets }`, `BundleResult = { manifest, bundleContents }`. This is the contract between bundler implementations and the framework.
- `bunBundler.ts` — Bun-specific bundler implementation. Generates per-route entry files in a `bundles/` directory, builds with `Bun.build` (`splitting: true`, `metafile: true`), correlates metafile outputs back to route names, and produces a `BundleResult`. Temporary — will be replaced by a Vite plugin.

**SSR correctness note:** Zustand's `useStore` uses `useSyncExternalStore` with `getInitialState()` as the server snapshot, which returns state at construction time — before `waitFor` resolves. The Zustand adapter overrides `store.getInitialState = store.getState` so `renderToString` (called after `whenReady`) sees the resolved async values.

### Fetch subsystem

Two-audience design:
- **Consumer** (`fetch/index.ts`): exports only the `fetch` function — a drop-in isomorphic replacement for `globalThis.fetch`.
- **Framework** (`fetch/Fetch.ts`): exports the `Fetch` object with `init()`, `fetch()`, and `getCache()`. `handlePage` calls `Fetch.init()` to create a per-request `FetchCache` in RLS; `writeBody` calls `Fetch.getCache()` to dehydrate/stream cached responses.

`FetchCache` (`fetch/cache.ts`) uses a server/client accessor pattern:
- `cache.server()` — `receiveRequest(url)` returns `{ first, promise }`: creates the entry + deferred on first call, increments requesters on subsequent calls, always returns the deferred's promise. All callers (first and dedup) resolve through the same promise. `receiveResponse(url, Response)` consumes the body, caches the result, and resolves the deferred. `receiveError(url, Error)` rejects the deferred and stores the error message for dehydration. `dehydrate()` returns the serializable data. `getPending()` returns entries that are neither resolved nor errored, for streaming late arrivals.
- `cache.client()` — `rehydrate(data)` populates from dehydrated server data; resolves or rejects each entry's deferred based on `response`/`errorMessage`. `receiveRequest(url)` returns the cached promise or `null`. `receiveCachedResponse(url, CachedResponse)` resolves late-arrival entries. `consumeResponse(url)` decrements the requester count and removes the entry (both `data` and `pending`) when exhausted.
- `CacheEntry` shape: `{ response: CachedResponse | null, errorMessage: string | null, requesters: number }` — network failures are serialized as `errorMessage` so the client can replay the same rejection for hydration consistency.

`nativeFetch.ts` — captures `globalThis.fetch` at module load time behind a named export, so vitest can mock the module without fighting hoisting.

Server-side error handling: `Fetch.fetch()` fires the native fetch as a fire-and-forget side effect that feeds the deferred via `receiveResponse` or `receiveError`. Since all callers (including the first) use the deferred's promise, there are no orphaned promises on rejection. HTTP error statuses (4xx/5xx) are not errors — native `fetch()` resolves normally for those, and they flow through the cache like any other response. Only network failures (DNS, connection refused, etc.) trigger `receiveError`.

### Cross-root communication
Stores are scoped to React context trees. `broadcast` is a minimal escape hatch: send a message to all mounted instances of a store type from anywhere. Fire-and-forget, no request/response semantics.

### Demo site
Run with `bun src/demo/server.tsx`. Routes are defined in `demo/routes.ts` as string page paths (e.g. `'./DemoPage'`), typed with `SluiceRoutes`. The server calls `bundle()` then `createSluiceServer()`. Exercises sluice + isomorphic-stores together with Zustand stores, streaming roots, TheFold, late data arrivals, routing, and cross-root broadcast.

### TODOs

#### sluice (SSR framework)
- HMR for the client bundle in the dev server — currently requires a restart to pick up changes; `Bun.build` has no watch mode, so this would need to be built on top of it
- Support pre-building the client bundle as a separate step (for prod), distinct from on-the-fly bundling at dev server startup
- Client-side transitions (SPA navigation) — `navigateTo()` function that lazy-loads the target route's page entry, unmounts the current page, and mounts the new one without a full page reload
- API to allow page authors to transport arbitrary server-side data down to the client
- expose a `getRouteParams()` helper function so Pages can access route params without importing `RequestContext` directly
- middleware
- add the ability to register a callback on Root mount for a particular Root
- fetch: support for opting into response replaying of non-GET requests
- fetch: binary (non-text) responses should bypass the cache rather than being corrupted by `response.text()`
- make Roots show up properly in react devtools (right now they're Anonymous)
- `failArrival`: when the stream ends, send a pipe call that tells the client to reject any still-pending `rootDomNodeDfds`. Without this, timed-out roots (server wrote `hydrateRootsUpTo` but the DOM node was never rendered) leave the client hanging — `CLIENT_READY_DFD` never resolves. The server should write this as the last thing before closing the stream in both `finish()` and the error `.catch` path in `stream.ts`.

#### isomorphic-stores
- Add a mechanism for adapters to integrate the isomorphic-stores `StoreProvider` with a framework-native provider — e.g. so the Redux adapter can render a react-redux `<Provider store={store}>` alongside the isomorphic-stores context
- `useCreateClientStore` should return a `StoreProvider` so descendants can use `useStore` rather than threading `useClientStore` through the tree
- Stores that depend on other stores — not yet designed
- Client-side re-fetching / "going pending again" — not yet designed
- Cross-root communication: request/response pattern not yet designed

#### demo
- Add a demo of `nativeStore` access in `DemoPage`: a component that reads state imperatively via `instance.nativeStore.getState()` on button click

#### Notes for the future
- **Vite migration**: Replace `bunBundler.ts` (Bun.build) with a Vite plugin. Vite will serve as the dev server runtime (replacing Bun.serve) and provide HMR and CSS integration. The bundler-agnostic boundary is already in place: `bundle.ts` defines the `BundleResult` contract (manifest + bundle contents) that any bundler implementation must produce. Production builds will target Node and Deno as runtimes.
- **ALS requirement**: Sluice currently requires `AsyncLocalStorage` (via `requestLocal.ts`). This limits deployment to Node, Bun, and Deno. Edge runtimes (Cloudflare Workers, Vercel Edge) don't support ALS. If edge support is needed, RLS would need an alternative implementation.
- **Package splitting**: The Vite plugin should eventually be a separate package (`vite-plugin-sluice`) so that not every sluice user needs Vite as a dependency. For now everything lives in one package.

---

Bun is the current dev runtime. Use it for running, building, and installing — but sluice framework code itself must not depend on Bun-specific APIs (the framework will support Node/Deno in production).

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `vitest` for testing (not `bun test` or `jest`). Config is in `vitest.config.ts`. Tests needing DOM globals use `// @vitest-environment jsdom` per-file annotation.
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
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

Use `vitest` to run tests. Config is in `vitest.config.ts` (defines `@` path alias and `SERVER_SIDE`).

```ts#index.test.ts
import { test, expect } from "vitest";

test("hello world", () => {
  expect(1).toBe(1);
});
```

Tests that need DOM globals (e.g. `document`, `window`) use a per-file annotation instead of a global preload:

```ts
// @vitest-environment jsdom
import { test, expect } from "vitest";
```

### E2E tests

E2E tests use Playwright. Config is in `playwright.config.ts`. Tests are in `e2e/`. Run with `bunx playwright test`.

- `e2e/helpers/fixtures.ts` provides a custom `test` fixture that patches `page.goto` to wait for sluice client hydration (`CLIENT_READY_DFD`) by default. Import `test` and `expect` from `./helpers/fixtures` in e2e tests.
- Card components render a `data-card` attribute with the card title for stable test locators (e.g. `page.locator('[data-card="User Profile"]')`).

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";
import { createRoot } from "react-dom/client";

// import .css files directly and it works
import './index.css';

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.
