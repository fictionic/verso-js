
## Project Overview

**Verso** is a streaming SSR framework, and **isomorphic-stores** is its state management layer — a framework-agnostic adapter system for plugging Zustand, Redux, etc. into Verso's SSR model.

**Architecture**: Verso owns the server and the bundler. The server targets Node's standard HTTP APIs (works on Bun/Deno via Node compat). The bundler is Vite. Both are theoretically pluggable via adapters later, but there is no formal adapter system now — `BundleResult` (`bundle.ts`) is the clean boundary for the bundler, and standard `Request`/`Response` is the boundary for the server. `viteBundler.ts` is the Vite-based bundler.

**CLI** (in progress): `verso dev` starts a Vite dev server with HMR composed with verso's SSR handler. `verso build` writes production bundles to disk + `manifest.json`. `verso start` serves pre-built bundles + SSR. The user does not own the server file — verso orchestrates HTTP serving, and the user provides configuration (routes, API endpoints, etc.) via `verso.config.ts`.

**Dev runtime**: Bun is used for running/building/installing during development, but framework code must avoid Bun-specific APIs.

The core idea: stores are created server-side before render, async data is declared via `waitFor`, and Verso's `Root` component blocks rendering until the store is ready. Client-side components can also create stores independently via `useCreateClientStore`.

A secondary goal: replace the pattern of bubbling all UI updates up through a root element (which triggers full-tree re-renders) with granular per-component subscriptions via selectors.

### Workspace layout

This is a Bun workspace monorepo with three packages:

```
package.json                # workspace root
tsconfig.base.json          # shared compiler options
bunfig.toml
packages/
├── verso/                 # SSR framework
│   ├── package.json        # name: "@verso-js/verso"
│   ├── tsconfig.json       # extends ../../tsconfig.base.json
│   ├── vitest.config.ts    # @/ alias
│   └── src/verso/          # SSR framework source
├── stores/                # isomorphic-stores core library (defineIsoStore, IsoStoreProvider, types)
│   ├── package.json        # name: "@verso-js/stores"
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   └── src/
│       ├── index.ts        # public API: types + defineIsoStore + IsoStoreProvider
│       ├── adapter.ts      # adapter author API (Adapter type + defineIsoStore)
│       ├── provider.tsx    # IsoStoreProvider component
│       ├── core/           # internal: define, types, StoreProvider, lifecycle, constants
│       └── tests/
├── store-adapter-zustand/  # Zustand adapter implementation
│   ├── package.json        # name: "@verso-js/store-adapter-zustand", depends on @verso-js/stores
│   ├── tsconfig.json
│   └── src/
│       └── zustand.ts      # Zustand adapter + defineZustandIsoStore
├── store-adapter-redux/    # Redux adapter implementation
│   ├── package.json        # name: "@verso-js/store-adapter-redux", depends on @verso-js/stores
│   ├── tsconfig.json
│   └── src/
│       └── redux.ts        # Redux adapter + defineReduxIsoStore
└── demo/                   # demo app (exercises verso + stores)
    ├── package.json        # name: "@verso-js/demo", depends on verso + @verso-js/stores
    ├── tsconfig.json
    ├── playwright.config.ts
    ├── verso.config.ts    # demo's verso configuration
    ├── src/
    │   ├── routes.ts       # route definitions (SiteConfig)
    │   ├── DemoPage.tsx
    │   ├── LinkPage.tsx
    │   ├── stores/         # demo store definitions
    │   ├── components/
    │   └── endpoints/
    └── e2e/                # Playwright E2E tests
```

Each package uses `@/*` as a path alias to its own `src/` directory.

### verso package exports
- `@verso-js/verso` → `src/verso/index.ts` — primary authoring API: `definePage`, `defineMiddleware`, `defineEndpoint`, `Root`, `RootContainer`, `TheFold`, `makeRootComponent`, `RouteHandlerCtx` (type), `RouteDirective` (type), `LinkTag` (type)
- `@verso-js/verso/fetch` → `src/verso/core/fetch/index.ts` — isomorphic `fetch`
- `@verso-js/verso/cookies` → `src/verso/util/cookies.ts` — `getCookie`, `setCookie`
- `@verso-js/verso/server` → `src/verso/server/index.ts` — `createVersoServer`, `SiteConfig`, `Routes`
- `@verso-js/verso/bundler` → `src/verso/viteBundler.ts` — `bundle`, `bundleServer`
- `@verso-js/verso/config` → `src/verso/config.ts` — `VersoConfig` type

### stores package exports
- `@verso-js/stores` → `src/index.ts` — `defineIsoStore`, `IsoStoreProvider`, store types (`IsoStoreDefinition`, `IsoStoreInstance`, etc.)
- `@verso-js/stores/adapter` → `src/adapter.ts` — adapter author API: `Adapter` type + `defineIsoStore`

### store-adapter-zustand package exports
- `@verso-js/store-adapter-zustand` → `src/zustand.ts` — Zustand adapter + `defineZustandIsoStore`

### store-adapter-redux package exports
- `@verso-js/store-adapter-redux` → `src/redux.ts` — Redux adapter + `defineReduxIsoStore`

### verso source layout

```
src/verso/
├── index.ts         # root barrel: re-exports handler APIs + components
├── env.ts           # isServer() / IS_SERVER environment detection
├── entrypoint.ts    # unified client entry code generator (used by viteBundler + dev plugin)
├── bundle.ts        # bundler-agnostic types (RouteAssets, BundleManifest, BundleResult)
├── viteBundler.ts   # Vite-based bundler; produces BundleResult via vite.build()
├── config.ts        # VersoConfig type for verso.config.ts
├── cli.ts           # CLI entry point (verso build, verso start, verso dev)
├── cli/
│   ├── build.ts     # verso build: client bundle + server bundle + write to disk
│   ├── start.ts     # verso start: thin shell, import()s pre-built server entry
│   └── dev.ts       # verso dev: Vite dev server + SSR
├── dev/
│   ├── createDevServer.ts   # orchestrates Vite + Node HTTP server
│   └── versoVitePlugin.ts  # Vite plugin: single virtual entry module with per-route dynamic imports
├── constants.ts     # DOM attribute names
├── core/
│   ├── RequestContext.ts   # server-side escape hatch: raw Request + cookies; RLS-backed
│   ├── VersoRequest.ts    # isomorphic request facade (URL, query params, route params)
│   ├── VersoPipe.ts       # typed server→client pipe instance
│   ├── elementTokenizer.ts
│   ├── handler/
│   │   ├── Page.ts             # definePage + Page interface + LinkTag type
│   │   ├── Middleware.ts       # defineMiddleware + Middleware interface
│   │   ├── Endpoint.ts         # defineEndpoint + Endpoint interface
│   │   ├── RouteHandler.ts     # defineRouteHandler + base types
│   │   ├── RouteHandlerCtx.ts  # RouteHandlerCtx interface + createCtx factory
│   │   ├── ResponderConfig.ts  # BaseConfig interface
│   │   └── chain.ts            # handler chain building logic
│   ├── fetch/
│   │   ├── index.ts        # consumer-facing export: just `fetch`
│   │   ├── Fetch.ts        # framework-facing interface: serverInit, clientInit, fetch, getCache
│   │   ├── cache.ts        # FetchCache class (server/client accessor objects)
│   │   └── nativeFetch.ts  # indirection for globalThis.fetch (mockable in tests)
│   └── components/
│       ├── index.ts
│       ├── Root.tsx
│       ├── RootContainer.tsx
│       └── TheFold.tsx
├── client/
│   └── bootstrap.ts # client entry point; matches route, dynamically loads page, hydrates
├── middleware/
│   └── ViteBundleLoader.ts  # system middleware: injects bundle scripts, stylesheets, and modulepreload link tags
├── server/
│   ├── index.ts              # barrel export
│   ├── createVersoServer.ts # wires up routing, bundle serving, and SSR handler
│   ├── handleRoute.ts        # common setup for all route types
│   ├── handlePage.ts         # orchestrates per-request SSR
│   ├── handleEndpoint.ts     # handler for JSON endpoints
│   ├── stream.ts             # streaming HTML writer (header, roots, bootstrap, late arrivals)
│   ├── writeHeader.ts        # <head> rendering (title, stylesheets, link tags)
│   ├── writeBody.ts          # body rendering (roots, containers, TheFold)
│   ├── nodeHttp.ts           # shared Node HTTP helpers (toWebRequest, sendWebResponse)
│   ├── ServerCookies.ts      # response cookie accumulator; RLS-backed
│   └── router.ts             # route matching via path-to-regexp
├── tests/
└── util/
    ├── ServerClientPipe.ts  # generic typed server→client pipe factory
    ├── cookies.ts           # isomorphic cookie get/set util
    ├── importModule.ts      # jiti wrapper for loading .ts/.tsx at runtime under Node
    └── requestLocal.ts
```

### isomorphic-stores Architecture

Two-layer factory pattern:
- **Outer layer** (user-written `IsoStoreInit`): `(opts, { waitFor, onMessage, clientOnly }) => NativeStoreInit` — receives opts and a `fns` object, returns a native store initializer
- **Inner layer** (framework): e.g. `(set, get) => State` for Zustand — the native store creator

The `Adapter` bridges the two: `createNativeStore(nativeStoreInit)` turns the inner-layer result into an actual store instance.

Three levels of abstraction:
1. **`defineIsoStore(isoInit, adapter, options?)`** — core library function; framework-agnostic
2. **`getAdapter<State>()`** — adapter module (e.g. `store-adapter-zustand/src/zustand.ts`); encapsulates framework-specific types. Must be called as `getAdapter<State>()` to ensure TypeScript infers `State` from the adapter.
3. **`defineZustandIsoStore(isoInit, options?)`** — convenience wrapper exported from `@verso-js/store-adapter-zustand`; combines adapter + `defineIsoStore`.

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

### Request architecture

Three layers:
- **`VersoRequest`** (`core/VersoRequest.ts`) — isomorphic request facade. Constructed via `VersoRequest.server(req)` (from the native `Request`) or `VersoRequest.client()` (from `window.location`). Currently exposes `getURL()`, `getQuery()` (returns `URLSearchParams`), and `getParams()` (route params). Fields that require piping (method, headers) are not yet implemented. Not stored in RLS — only accessible via `RouteHandlerCtx`.
- **`RouteHandlerCtx`** (`core/RouteHandlerCtx.ts`) — the context object passed to route handler `init` functions as `ctx`. Exposes `getConfig()` and `getRequest()`. Created via `createCtx(config, versoRequest)`. This is the primary API surface for route handler authors.
- **`RequestContext`** (`core/RequestContext.ts`) — server-side escape hatch, RLS-backed. Holds the raw `Request` and `cookies` (derived from request headers, throws client-side). Accessible anywhere via `getCurrentRequestContext()`. Intended for framework internals and advanced use cases, not everyday route handler code.

### Verso SSR pipeline

- `createVersoServer.ts` — wires everything together. Takes a `SiteConfig` and a `BundleResult`. Constructs a `ViteBundleLoader` system middleware from the manifest (scripts, stylesheets, modulepreloads per route) and prepends it to the user middleware chain. Returns `serve` (a unified request handler that serves client bundles and SSR pages, matching routes and delegating to `handleRoute`).
- `handleRoute.ts` — common setup for all route types. Initializes RLS (`RequestContext`, `ServerCookies`, `Fetch`), creates `VersoRequest` and `RouteHandlerCtx`, builds the handler chain, calls `getRouteDirective()`, then delegates to `handlePage` or `handleEndpoint`.
- `handlePage.ts` — orchestrates per-request SSR. Delegates to `makeStreamer` for streaming HTML. Takes `routeAssets: RouteAssets` (per-route scripts and stylesheets from the bundle manifest).
- `stream.ts` — streaming HTML writer. Writes the shell (`<head>`, styles, bundle stylesheets), then streams root elements in document order. At `TheFold`, injects the dehydrated fetch cache and per-route `<script>` tags from `routeAssets.scripts`. Below-fold roots get inline `hydrateRootsUpTo` pipe calls. Handles late data arrivals and timeouts.
- `router.ts` — route matching via `path-to-regexp`. Routes are defined in a `SiteConfig` — a map of route names to `{ path, handler, method? }` plus optional global middleware. `createRouter` compiles patterns and returns `matchRoute(path, method) => RouteMatch | null`.
- `Root.tsx` — pass-through component; `when` is read directly from props by the stream writer.
- `TheFold.tsx` — null-rendering sentinel; identifies the above/below-fold boundary.
- `fetch/` — isomorphic fetch subsystem. Two audiences: consumers import `fetch` from `index.ts`; the framework uses `Fetch.serverInit()` / `Fetch.clientInit()`, `Fetch.fetch()`, and `Fetch.getCache()` from `Fetch.ts`. `Fetch.serverInit(urlPrefix)` creates a per-request `FetchCache` in RLS and sets `urlPrefix` for resolving relative URLs to absolute (required server-side since `fetch('/path')` has no implicit origin). `urlPrefix` is optional in config — defaults to the origin from `req.url`. `Fetch.clientInit()` creates the cache without a prefix (browser resolves relative URLs natively). GETs are cached, deduplicated, and dehydrated; non-GETs pass through with `urlPrefix` applied. `FetchCache` exposes `server()` and `client()` accessor objects with environment-specific APIs. `nativeFetch.ts` provides an indirection over `globalThis.fetch` for testability.
- `ServerClientPipe.ts` — generic factory (`createPipe<Schema>`) for typed server→client data transport via inline `<script>` tags. `VersoPipe.ts` is the verso-specific instance.
- `client/bootstrap.ts` — client entry point. A single unified entry is generated with `() => import()` loaders for each page route. Bootstrap receives `(siteConfig, pageLoaders)`, matches `location.pathname` against the route table, dynamically imports the matched page module (resolves instantly on initial load since the chunk is already loaded via `<script>` or `<link rel="modulepreload">`), then creates `VersoRequest.client()` and `RouteHandlerCtx`, initializes `RequestContext` (client mode) and `Fetch`, rehydrates the fetch cache from the pipe, builds the handler chain, tokenizes elements, and hydrates roots as `hydrateRootsUpTo` events arrive. This unified code path is shared between initial hydration and future client-side transitions.
- `bundle.ts` — bundler-agnostic types. `RouteAssets = { scripts, preloads?, inlineScripts?, stylesheets }`, `BundleManifest = { [routeName]: RouteAssets }`, `BundleResult = { manifest, bundleContents, handlersByRoute }`. `scripts` are the shared entry chunks, `preloads` are per-route dynamic import chunks (emitted as `<link rel="modulepreload">`). This is the contract between bundler implementations and the framework.
### Dev server architecture (`verso dev`)

`verso dev` starts a Vite dev server in middleware mode composed with verso's SSR handler. Run with `cd packages/demo && node packages/verso/bin/verso.js dev` (or via the `verso` bin).

**Three module loading strategies, by context:**

- **jiti** (`util/importModule.ts`): Used only for CLI bootstrap and loading `verso.config.ts` (pure config, no JSX). The CLI entry (`bin/verso.js`) uses jiti to load `cli.ts` without a build step, making the CLI work under Node without Bun. Also used at build time to load the site config and handlers for the client bundle (these run at build time only, not in the request path). Configured with `jsx: { runtime: 'automatic' }` so it handles JSX correctly if needed.
- **Vite `ssrLoadModule`** (dev only): Used for everything in the request path during `verso dev` — the site config (`routes.ts`, which may import `.tsx` middleware), route handlers, and `handleRoute.ts` itself. This is critical: all code in the request path must go through the same module loader so singletons (RLS/AsyncLocalStorage, fetch cache) share one instance.
- **Pre-built server bundle** (prod only): `verso build` runs a Vite SSR build that bundles the framework runtime + site config + all route handlers into a single module graph (`dist/server/entry.js`). `verso start` loads this via native `import()`. Since everything is in one bundle, singletons are shared. Only `react` and `react-dom` are external (resolved from `node_modules` at runtime).

**Why not jiti for the prod request path?** jiti's Babel-based JSX transform uses classic mode (`React.createElement`), but user `.tsx` files use the automatic JSX runtime (no `import React`). More importantly, loading framework code via jiti while loading handlers separately would create duplicate module instances — the singleton problem.

**Why not `ssrLoadModule` for everything in dev?** Chicken-and-egg: we need `verso.config.ts` to know the routes file path before Vite is created. jiti handles this one-time config load.

**Singleton problem:** Five modules hold per-request state via RLS (`requestLocal.ts`, `Fetch.ts`, `ServerCookies.ts`, `RequestContext.ts`, `ResponderConfig.ts`). All are rooted in a single `AsyncLocalStorage` instance in `requestLocal.ts`. If any of these modules are loaded twice (from different module graphs), per-request state breaks silently.

**Dev solution — `ssr.noExternal`:** Setting `ssr.noExternal: ['@verso-js/verso', '@verso-js/stores']` forces Vite to process framework code through its own module graph, so `import { ... } from '@verso-js/verso'` in user code resolves to the same modules that `handleRoute.ts` uses. This matches what SvelteKit, Remix, Astro, and Nuxt all do.

**Prod solution — self-contained server bundle:** `verso build` generates a virtual entry module that imports `createVersoServer`, the site config, and all route handlers, then runs a Vite SSR build (`build.ssr: true`). Since workspace packages (`@verso-js/*`) resolve to local `.ts` source (not `node_modules`), Vite bundles them into the output — framework runtime and user code share one module graph. This is the same pattern as SvelteKit's adapter-node (secondary Rollup pass bundling the framework + routes together).

**Per-request loading:** `handleRoute` and the route handler are loaded via `ssrLoadModule` on every request. Vite caches modules and only re-evaluates when files change, so this is effectively free — but it means server-side code changes take effect on the next request without restarting.

**Client-side virtual entry:** The `versoVitePlugin` registers a single virtual module (`virtual:verso/entry`) that generates a unified client entry with `() => import()` loaders for all page routes. In dev, `createDevServer.ts` builds `routeScripts` pointing all routes to this single virtual module URL (`/@id/__x00__virtual:verso/entry`), which is injected via the `ViteBundleLoader` middleware and served by Vite with HMR support. Vite code-splits each dynamic import target into its own module.

**Environment detection:** `env.ts` exports `isServer()`. `IS_SERVER` is set in four places: (1) `bin/verso.js` sets `globalThis.IS_SERVER = true` before jiti loads any modules, so the CLI path works under Node; (2) the Vite dev server sets it via `define` (server default) and overrides in `environments.client.define`; (3) `viteBundler.ts` defines `IS_SERVER: 'false'` for client builds; (4) `bundleServer()` defines `IS_SERVER: 'true'` for the production server build. `globals.d.ts` declares `IS_SERVER` globally so consumers can use it directly for dead code elimination (e.g. `if (IS_SERVER) { await import('node:...') }`) without needing `declare const`. The `isServer()` function wraps this for ergonomic runtime checks.

**SSR correctness note:** Zustand's `useStore` uses `useSyncExternalStore` with `getInitialState()` as the server snapshot, which returns state at construction time — before `waitFor` resolves. The Zustand adapter overrides `store.getInitialState = store.getState` so `renderToString` (called after `whenReady`) sees the resolved async values.

### Fetch subsystem

Two-audience design:
- **Consumer** (`fetch/index.ts`): exports only the `fetch` function — a drop-in isomorphic replacement for `globalThis.fetch`.
- **Framework** (`fetch/Fetch.ts`): exports the `Fetch` object with `serverInit(urlPrefix)` / `clientInit()`, `fetch()`, and `getCache()`. `handleRoute` calls `Fetch.serverInit()` to create a per-request `FetchCache` in RLS; `writeBody` calls `Fetch.getCache()` to dehydrate/stream cached responses.

`FetchCache` (`fetch/cache.ts`) uses a server/client accessor pattern:
- `cache.server()` — `receiveRequest(url)` returns `{ first, promise }`: creates the entry + deferred on first call, increments requesters on subsequent calls, always returns the deferred's promise. All callers (first and dedup) resolve through the same promise. `receiveResponse(url, Response)` consumes the body, caches the result, and resolves the deferred. `receiveError(url, Error)` rejects the deferred and stores the error message for dehydration. `dehydrate()` returns the serializable data. `getPending()` returns entries that are neither resolved nor errored, for streaming late arrivals.
- `cache.client()` — `rehydrate(data)` populates from dehydrated server data; resolves or rejects each entry's deferred based on `response`/`errorMessage`. `receiveRequest(url)` returns the cached promise or `null`. `receiveCachedResponse(url, CachedResponse)` resolves late-arrival entries. `consumeResponse(url)` decrements the requester count and removes the entry (both `data` and `pending`) when exhausted.
- `CacheEntry` shape: `{ response: CachedResponse | null, errorMessage: string | null, requesters: number }` — network failures are serialized as `errorMessage` so the client can replay the same rejection for hydration consistency.

`nativeFetch.ts` — captures `globalThis.fetch` at module load time behind a named export, so vitest can mock the module without fighting hoisting.

Server-side error handling: `Fetch.fetch()` fires the native fetch as a fire-and-forget side effect that feeds the deferred via `receiveResponse` or `receiveError`. Since all callers (including the first) use the deferred's promise, there are no orphaned promises on rejection. HTTP error statuses (4xx/5xx) are not errors — native `fetch()` resolves normally for those, and they flow through the cache like any other response. Only network failures (DNS, connection refused, etc.) trigger `receiveError`.

### Cross-root communication
Stores are scoped to React context trees. `broadcast` is a minimal escape hatch: send a message to all mounted instances of a store type from anywhere. Fire-and-forget, no request/response semantics.

### verso.config.ts

User configuration for the CLI. Points to the routes file and provides server/build options:

```ts
import type { VersoConfig } from '@verso-js/verso/config';

export default {
  routes: './src/routes.ts',        // path to SiteConfig file (routes + middleware)
  server: {
    port: 3000,                          // optional, default 3000
    urlPrefix: 'http://localhost:3000',  // optional, defaults to http://localhost:{port}
    renderTimeout: 20_000,               // optional
  },
  build: {
    outDir: './dist',                    // optional, default 'dist'
    cdnPrefix: undefined,                // optional, for CDN prod mode
  },
} satisfies VersoConfig;
```

The routes file (`SiteConfig`) is a separate concern from the framework config — the bundler only needs the routes file path to follow handler imports.

### Demo site
Run with `cd packages/demo && verso dev` (or `npm run dev`). For production: `npm run build` then `npm run start`. Routes are defined in `src/routes.ts` as string handler paths (e.g. `'./DemoPage'`), typed with `SiteConfig`. Exercises verso + isomorphic-stores together with Zustand stores, streaming roots, TheFold, late data arrivals, routing, and cross-root broadcast.

### TODOs

#### overall
- switch from Bun to pnpm?
- add a `files` field to `packages/verso/package.json` before publishing to npm — `dist/` is gitignored, so it will be excluded from the published package unless explicitly included (e.g. `"files": ["dist", "src", "bin", "globals.d.ts"]`)

#### verso (SSR framework)
- [ ] Implement an optional `onError` handler in `SiteConfig` to provide custom `PageDefinition` or `Response` for pre-stream 500/404 errors.
- [ ] Implement `Readable.fromWeb` in `packages/verso/src/verso/server/nodeHttp.ts` for more efficient, backpressure-aware response streaming (Node 18+).
- Verify client-side HMR works end-to-end in `verso dev` (virtual entry modules are served by Vite with HMR support, but this hasn't been tested in a browser yet)
- Client-side transitions (SPA navigation) — `navigateTo()` function that lazy-loads the target route's page entry, unmounts the current page, and mounts the new one without a full page reload
- API to allow page authors to transport arbitrary server-side data down to the client
- pipe server-only request data (method, headers) to the client via VersoPipe so `VersoRequest` can be fully isomorphic
- add the ability to register a callback on Root mount for a particular Root
- fetch: support for opting into response replaying of non-GET requests
- fetch: binary (non-text) responses should bypass the cache rather than being corrupted by `response.text()`
- make Roots show up properly in react devtools (right now they're Anonymous)
- `failArrival`: when the stream ends, send a pipe call that tells the client to reject any still-pending `rootDomNodeDfds`. Without this, timed-out roots (server wrote `hydrateRootsUpTo` but the DOM node was never rendered) leave the client hanging — `CLIENT_READY_DFD` never resolves. The server should write this as the last thing before closing the stream in both `finish()` and the error `.catch` path in `stream.ts`.
- filter out extraneous middleware methods when wiring up the chain, as an extra layer of safety (maybe as a method on MiddlewareDefinition?)
- redo the middleware types to be less complex
- Object.freeze on ctx?
- Adapter system for deployment targets (Node, Bun, Deno, Cloudflare Workers, Vercel Edge). The adapter owns the HTTP listener and injects platform-specific startup code into the server entry at build time. `verso start` goes away — the build output is a standalone `node dist/server/entry.js` (or equivalent). Pattern matches SvelteKit/Astro: framework produces a `Request �� Response` handler, adapter wraps it. Note: Cloudflare and Vercel now support AsyncLocalStorage, so edge runtimes are viable targets — update the ALS note below.
- logging system

#### isomorphic-stores
- Add a mechanism for adapters to integrate the isomorphic-stores `StoreProvider` with a framework-native provider — e.g. so the Redux adapter can render a react-redux `<Provider store={store}>` alongside the isomorphic-stores context
- `useCreateClientStore` should return a `StoreProvider` so descendants can use `useStore` rather than threading `useClientStore` through the tree
- Stores that depend on other stores — not yet designed
- Client-side re-fetching / "going pending again" — not yet designed
- Cross-root communication: request/response pattern not yet designed

#### demo
- Add a demo of `nativeStore` access in `DemoPage`: a component that reads state imperatively via `instance.nativeStore.getState()` on button click

#### Notes for the future
- **`verso dev`**: Implemented. Vite dev server with HMR, composed with verso's SSR handler. See "Dev server architecture" section above and `specs/vite-dev-server.md`.
- **`verso build`**: Implemented. Two Vite build passes: (1) client build — bundles client entry + per-route chunks to `dist/bundles/` + `manifest.json`; (2) server build — bundles framework runtime + site config + all route handlers into a self-contained `dist/server/entry.js` (+ chunks) via Vite SSR build. The server entry exports `createServer(config)`.
- **`verso start`**: Implemented. Thin shell — reads client manifest + bundles from disk, `import()`s the pre-built `dist/server/entry.js`, starts Node HTTP server. No jiti or runtime transpilation in the request path. Two bundle serving modes planned: (1) local prod — from disk (current), (2) CDN — manifest only, bundles served externally (not yet implemented).
- **API routes**: Support non-SSR route handlers (JSON endpoints, redirects) in the routes config so the full app can be expressed without a custom server.
- **ALS requirement**: Verso requires `AsyncLocalStorage` (via `requestLocal.ts`). As of late 2023, this is supported on Node, Bun, Deno, Cloudflare Workers (with `nodejs_compat` flag), and Vercel Edge Runtime. No longer a blocker for edge deployment.

---

Bun is the current dev runtime. Use it for running, building, and installing — but verso framework code itself must not depend on Bun-specific APIs (the framework will support Node/Deno in production).

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `vitest` for testing (not `bun test` or `jest`). Config is in `packages/verso/vitest.config.ts`. Tests needing DOM globals use `// @vitest-environment jsdom` per-file annotation.
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

Use `vitest` to run tests from within `packages/verso/`. Config is in `packages/verso/vitest.config.ts` (defines `@` path alias).

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

E2E tests use Playwright. Tests are in `packages/demo/e2e/`, split into two suites:

- **`smoke.spec.ts`** — SSR + hydration smoke test (page loads, hydrates within 5s, no browser errors). Runs against both dev and prod modes.
- **`stores.spec.ts`** — Demo-specific interactivity tests (SSR content, interactions, client-only async data, cross-root broadcast, streaming). Runs against dev mode only.

Three Playwright configs:
- `playwright.config.ts` — shared base (no `webServer`)
- `playwright.dev.config.ts` — extends base with `verso dev`
- `playwright.prod.config.ts` — extends base with `verso build && verso start`, only runs `smoke.spec.ts`

Run with:
- `cd packages/demo && bunx playwright test -c playwright.dev.config.ts` (or `bun run test:e2e`)
- `cd packages/demo && bunx playwright test -c playwright.prod.config.ts` (or `bun run test:e2e:prod`)
- `bun run test:e2e:all` — runs both

Fixtures (`e2e/helpers/fixtures.ts`):
- Patches `page.goto` to wait for verso client hydration (`CLIENT_READY_DFD`) by default. Import `test` and `expect` from `./helpers/fixtures` in e2e tests.
- Provides a `consoleErrors` fixture that collects `console.error` and `pageerror` events and auto-asserts empty after each test.
- Card components render a `data-card` attribute with the card title for stable test locators (e.g. `page.locator('[data-card="User Profile"]')`).
