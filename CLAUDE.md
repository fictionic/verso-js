
## Project Overview

**Verso** is a streaming SSR framework, and **isomorphic-stores** is its state management layer — a framework-agnostic adapter system for plugging Zustand, Redux, etc. into Verso's SSR model.

**Architecture**: Verso owns the server and the bundler. The server targets Node's standard HTTP APIs (works on Bun/Deno via Node compat). The bundler is Vite — verso ships as a Vite plugin (`build/plugin.ts`). Both are theoretically pluggable via adapters later, but there is no formal adapter system now — `BundleResult` (`build/bundle.ts`) is the clean boundary for the bundler, and standard `Request`/`Response` is the boundary for the server.

**CLI** (in progress): `verso dev` starts a Vite dev server with HMR composed with verso's SSR handler. `verso build` writes production bundles to disk + `manifest.json`. `verso start` serves pre-built bundles + SSR. The user does not own the server file — verso orchestrates HTTP serving, and the user provides configuration (routes, API endpoints, etc.) via `verso.config.ts`.

**Dev runtime**: Bun is used for running/building/installing during development, but framework code must avoid Bun-specific APIs.

The core idea: stores are created server-side before render, async data is declared via `waitFor`, and Verso's `Root` component blocks rendering until the store is ready. Client-side components can also create stores independently via `useCreateClientStore`.

A secondary goal: replace the pattern of bubbling all UI updates up through a root element (which triggers full-tree re-renders) with granular per-component subscriptions via selectors.

### Workspace layout

This is a Bun workspace monorepo:

```
package.json                # workspace root
tsconfig.base.json          # shared compiler options
bunfig.toml
packages/
├── verso/                 # SSR framework
│   ├── package.json        # name: "@verso-js/verso"
│   ├── tsconfig.json       # extends ../../tsconfig.base.json
│   ├── vitest.config.ts    # @/ alias
│   ├── tsup.config.ts      # builds the vite plugin to dist/
│   └── src/                # SSR framework source (flat — no src/verso/ nesting)
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
├── store-adapter-valtio/   # Valtio adapter implementation
│   ├── package.json        # name: "@verso-js/store-adapter-valtio", depends on @verso-js/stores
│   ├── tsconfig.json
│   └── src/
│       └── valtio.ts       # Valtio adapter + defineValtioIsoStore
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
- `@verso-js/verso` → `src/index.ts` — primary authoring API: `definePage`, `defineMiddleware`, `defineEndpoint`, `Root`, `RootContainer`, `TheFold`, `makeRootComponent`, `RouteHandlerCtx` (type), `RouteDirective` (type), `LinkTag` (type), `isServer`, `getCookie`, `setCookie`, `getNamespace`
- `@verso-js/verso/fetch` → `src/core/fetch/index.ts` — isomorphic `fetch`
- `@verso-js/verso/cookies` → `src/cookies.ts` — `getCookie`, `setCookie`
- `@verso-js/verso/config` → `src/VersoConfig.ts` — `VersoConfig` type
- `@verso-js/verso/env` → `src/env.ts` — `isServer()`
- `@verso-js/verso/request-local` → `src/RequestLocalStorage.ts` — `getNamespace`
- `@verso-js/verso/plugin` → `dist/plugin.js` — pre-built Vite plugin (built via tsup)

### stores package exports
- `@verso-js/stores` → `src/index.ts` — `defineIsoStore`, `IsoStoreProvider`, store types (`IsoStoreDefinition`, `IsoStoreInstance`, etc.)
- `@verso-js/stores/adapter` → `src/adapter.ts` — adapter author API: `Adapter` type + `defineIsoStore`

### store-adapter-zustand package exports
- `@verso-js/store-adapter-zustand` → `src/zustand.ts` — Zustand adapter + `defineZustandIsoStore`

### store-adapter-redux package exports
- `@verso-js/store-adapter-redux` → `src/redux.ts` — Redux adapter + `defineReduxIsoStore`

### store-adapter-valtio package exports
- `@verso-js/store-adapter-valtio` → `src/valtio.ts` — Valtio adapter + `defineValtioIsoStore`

### verso source layout

```
src/
├── index.ts              # root barrel: re-exports handler APIs + components + utilities
├── env.ts                # isServer() / IS_SERVER environment detection
├── VersoConfig.ts        # VersoConfig type for verso.config.ts
├── RequestLocalStorage.ts # AsyncLocalStorage-based request-local storage
├── cookies.ts            # isomorphic cookie get/set util
├── build/
│   ├── cli.ts            # CLI entry point (verso build, verso start, verso dev)
│   ├── commands/
│   │   ├── build.ts      # verso build: client bundle + server bundle + write to disk
│   │   ├── start.ts      # verso start: thin shell, import()s pre-built server entry
│   │   └── dev.ts        # verso dev: Vite dev server + SSR
│   ├── bundle.ts         # bundler-agnostic types (RouteAssets, BundleManifest, BundleResult)
│   ├── createVersoServer.ts # wires up routing, bundle serving, and SSR handler
│   ├── collectCss.ts     # dev-only: walks Vite module graph to find CSS imports for a handler
│   ├── entrypoint.ts     # virtual entry code generators (client + server)
│   ├── importModule.ts   # jiti wrapper for loading .ts/.tsx at runtime under Node
│   └── plugin.ts         # Vite plugin: config, virtual modules, manifest generation, dev server
├── core/
│   ├── RequestContext.ts  # server-side escape hatch: raw Request + cookies; RLS-backed
│   ├── VersoRequest.ts   # isomorphic request facade (URL, query params, route params)
│   ├── VersoPipe.ts      # typed server→client pipe instance
│   ├── constants.ts      # DOM attribute names
│   ├── elementTokenizer.ts
│   ├── router.ts         # route matching via path-to-regexp
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
│   ├── components/
│   │   ├── index.ts
│   │   ├── Root.tsx
│   │   ├── RootContainer.tsx
│   │   └── TheFold.tsx
│   ├── middleware/
│   │   └── ViteBundleLoader.ts  # system middleware: injects bundle scripts, stylesheets, and modulepreload link tags
│   └── util/
│       └── ServerClientPipe.ts  # generic typed server→client pipe factory
├── client/
│   ├── bootstrap.ts      # client entry point; matches route, dynamically loads page, hydrates
│   ├── controller.ts     # ClientController: orchestrates hydration, navigation, style transitions
│   ├── globals.ts        # client-side global declarations
│   ├── scripts.ts        # client-side script management during navigation
│   ├── styles.ts         # client-side stylesheet transitions (dev: Vite style adoption; prod: link tags)
│   └── url.ts            # URL normalization utility (strip origin for same-origin resources)
├── server/
│   ├── ServerCookies.ts  # response cookie accumulator; RLS-backed
│   ├── handleRoute.ts    # common setup for all route types
│   ├── handlePage.ts     # orchestrates per-request SSR
│   ├── handleEndpoint.ts # handler for JSON endpoints
│   ├── stream.ts         # streaming HTML writer (header, roots, bootstrap, late arrivals)
│   ├── writeHeader.ts    # <head> rendering (title, stylesheets, link tags)
│   ├── writeBody.ts      # body rendering (roots, containers, TheFold)
│   └── nodeHttp.ts       # shared Node HTTP helpers (toWebRequest, sendWebResponse)
├── tests/
└── util/
    └── array.ts
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

### Middleware

`defineMiddleware(init)` or `defineMiddleware(scope, init)`. Scope defaults to `'page'` (the common case); pass `'all'` or `'endpoint'` explicitly for other scopes. Middleware is generic over a config type parameter: `defineMiddleware<MyConfig>(...)` forces middleware authors to define and export their config shape, which consumers import for typed `ctx.getConfig<MyConfig>('key')` access.

Middleware methods are wrapped in `Chained<T>` — each method receives `next` as its first argument and calls it to delegate to the next middleware or the handler. The type system uses `ForbiddenMethodsMap` (mapped `?: never` keys) to prohibit implementing methods that belong to other scopes (e.g., `getElements` in endpoint middleware). This is necessary because TypeScript's excess property checking does not fire on `Partial<intersection>` types — mapped types are not valid EPC targets, so without `?: never` the type system would silently accept wrong-scope methods.

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
- **`RouteHandlerCtx`** (`core/handler/RouteHandlerCtx.ts`) — the context object passed to route handler `init` functions as `ctx`. Exposes `getConfig()`, `getRequest()`, and `getRoute()`. Created via `createCtx(config, versoRequest, route)`. This is the primary API surface for route handler authors.
- **`RequestContext`** (`core/RequestContext.ts`) — server-side escape hatch, RLS-backed. Holds the raw `Request` and `cookies` (derived from request headers, throws client-side). Accessible anywhere via `getCurrentRequestContext()`. Intended for framework internals and advanced use cases, not everyday route handler code.

### Verso SSR pipeline

- `build/createVersoServer.ts` — wires everything together. Takes a `SiteConfig` and a `BundleResult`. Constructs a `ViteBundleLoader` system middleware from the manifest (scripts, stylesheets, modulepreloads per route) and prepends it to the user middleware chain. Returns `serve` (a unified request handler that serves client bundles and SSR pages, matching routes and delegating to `handleRoute`).
- `handleRoute.ts` — common setup for all route types. Initializes RLS (`RequestContext`, `ServerCookies`, `Fetch`), creates `VersoRequest` and `RouteHandlerCtx`, builds the handler chain, calls `getRouteDirective()`, then delegates to `handlePage` or `handleEndpoint`.
- `handlePage.ts` — orchestrates per-request SSR. Delegates to `makeStreamer` for streaming HTML. Takes `routeAssets: RouteAssets` (per-route scripts and stylesheets from the bundle manifest).
- `stream.ts` — streaming HTML writer. Writes the shell (`<head>`, styles, bundle stylesheets), then streams root elements in document order. At `TheFold`, injects the dehydrated fetch cache and per-route `<script>` tags from `routeAssets.scripts`. Below-fold roots get inline `hydrateRootsUpTo` pipe calls. Handles late data arrivals and timeouts.
- `core/router.ts` — route matching via `path-to-regexp`. Routes are defined in a `SiteConfig` — a map of route names to `{ path, handler, method? }` plus optional global middleware. `createRouter` compiles patterns and returns `matchRoute(path, method) => RouteMatch | null`.
- `Root.tsx` — pass-through component; `when` is read directly from props by the stream writer.
- `TheFold.tsx` — null-rendering sentinel; identifies the above/below-fold boundary.
- `fetch/` — isomorphic fetch subsystem. Two audiences: consumers import `fetch` from `index.ts`; the framework uses `Fetch.serverInit()` / `Fetch.clientInit()`, `Fetch.fetch()`, and `Fetch.getCache()` from `Fetch.ts`. `Fetch.serverInit(urlPrefix)` creates a per-request `FetchCache` in RLS and sets `urlPrefix` for resolving relative URLs to absolute (required server-side since `fetch('/path')` has no implicit origin). `urlPrefix` is optional in config — defaults to the origin from `req.url`. `Fetch.clientInit()` creates the cache without a prefix (browser resolves relative URLs natively). GETs are cached, deduplicated, and dehydrated; non-GETs pass through with `urlPrefix` applied. `FetchCache` exposes `server()` and `client()` accessor objects with environment-specific APIs. `nativeFetch.ts` provides an indirection over `globalThis.fetch` for testability.
- `core/util/ServerClientPipe.ts` — generic factory (`createPipe<Schema>`) for typed server→client data transport via inline `<script>` tags. `core/VersoPipe.ts` is the verso-specific instance.
- `client/bootstrap.ts` — client entry point. A single unified entry is generated with `() => import()` loaders for each page route. Bootstrap receives `(siteConfig, pageLoaders)`, matches `location.pathname` against the route table, dynamically imports the matched page module (resolves instantly on initial load since the chunk is already loaded via `<script>` or `<link rel="modulepreload">`), then creates `VersoRequest.client()` and `RouteHandlerCtx`, initializes `RequestContext` (client mode) and `Fetch`, rehydrates the fetch cache from the pipe, builds the handler chain, tokenizes elements, and hydrates roots as `hydrateRootsUpTo` events arrive. This unified code path is shared between initial hydration and future client-side transitions.
- `build/bundle.ts` — bundler-agnostic types. `RouteAssets = { scripts, preloads?, inlineScripts?, stylesheets }`, `BundleManifest = { [routeName]: RouteAssets }`, `BundleResult = { manifest, bundleContents, handlersByRoute }`. `scripts` are the shared entry chunks, `preloads` are per-route dynamic import chunks (emitted as `<link rel="modulepreload">`). This is the contract between bundler implementations and the framework.
### Dev server architecture (`verso dev`)

`verso dev` starts a Vite dev server in middleware mode composed with verso's SSR handler. Run with `cd packages/demo && node packages/verso/bin/verso.js dev` (or via the `verso` bin).

**Three module loading strategies, by context:**

- **jiti** (`build/importModule.ts`): Used only for CLI bootstrap and loading `verso.config.ts` (pure config, no JSX). The CLI entry (`bin/verso.js`) uses jiti to load `cli.ts` without a build step, making the CLI work under Node without Bun. Also used at build time to load the site config and handlers for the client bundle (these run at build time only, not in the request path). Configured with `jsx: { runtime: 'automatic' }` so it handles JSX correctly if needed.
- **Vite `ssrLoadModule`** (dev only): Used for everything in the request path during `verso dev` — the site config (`routes.ts`, which may import `.tsx` middleware), route handlers, and `handleRoute.ts` itself. This is critical: all code in the request path must go through the same module loader so singletons (RLS/AsyncLocalStorage, fetch cache) share one instance.
- **Pre-built server bundle** (prod only): `verso build` runs a Vite SSR build that bundles the framework runtime + site config + all route handlers into a single module graph (`dist/server/entry.js`). `verso start` loads this via native `import()`. Since everything is in one bundle, singletons are shared. Only `react` and `react-dom` are external (resolved from `node_modules` at runtime).

**Why not jiti for the prod request path?** jiti's Babel-based JSX transform uses classic mode (`React.createElement`), but user `.tsx` files use the automatic JSX runtime (no `import React`). More importantly, loading framework code via jiti while loading handlers separately would create duplicate module instances — the singleton problem.

**Why not `ssrLoadModule` for everything in dev?** Chicken-and-egg: we need `verso.config.ts` to know the routes file path before Vite is created. jiti handles this one-time config load.

**Singleton problem:** Five modules hold per-request state via RLS (`RequestLocalStorage.ts`, `Fetch.ts`, `ServerCookies.ts`, `RequestContext.ts`, `ResponderConfig.ts`). All are rooted in a single `AsyncLocalStorage` instance in `RequestLocalStorage.ts`. If any of these modules are loaded twice (from different module graphs), per-request state breaks silently.

**Dev solution — `ssr.noExternal`:** Setting `ssr.noExternal: ['@verso-js/verso', '@verso-js/stores']` forces Vite to process framework code through its own module graph, so `import { ... } from '@verso-js/verso'` in user code resolves to the same modules that `handleRoute.ts` uses. This matches what SvelteKit, Remix, Astro, and Nuxt all do.

**Prod solution — self-contained server bundle:** `verso build` runs two Vite builds via the plugin. The second pass (`build.ssr: true`) uses a virtual server entry module (`virtual:verso/server-entry`, generated by `makeServerEntry` in `entrypoint.ts`) that imports `createVersoServer`, the site config, and all route handlers. Since workspace packages (`@verso-js/*`) resolve to local `.ts` source (not `node_modules`), Vite bundles them into the output — framework runtime and user code share one module graph. This is the same pattern as SvelteKit's adapter-node (secondary Rollup pass bundling the framework + routes together).

**Per-request loading:** `handleRoute` and the route handler are loaded via `ssrLoadModule` on every request. Vite caches modules and only re-evaluates when files change, so this is effectively free — but it means server-side code changes take effect on the next request without restarting.

**Vite plugin structure:** The plugin (`build/plugin.ts`) returns three sub-plugins:
- `@verso-js/verso:config` — `config` hook: sets `define` constants (`IS_SERVER`, `IS_DEV`, `__BUILD_ID__`), configures `ssr.noExternal`, sets build input/output options. `configResolved` captures root and outDir.
- `@verso-js/verso:virtual-modules` — `resolveId`/`load`: serves two virtual modules. `virtual:verso/entry` (client entry, generated by `makeUnifiedEntrypoint`) and `virtual:verso/server-entry` (server entry, generated by `makeServerEntry`). `writeBundle`: parses Vite's manifest to produce the verso `BundleManifest` during client build.
- `@verso-js/verso:dev-server` — `configureServer`: wires up the dev request handler. Loads routes, creates router, sets up `ViteBundleLoader` middleware with Vite dev scripts. Handles the `/__verso/route-css` endpoint (calls `collectCss` to walk Vite's module graph). On each request: loads handler via `ssrLoadModule`, collects CSS, delegates to `handleRoute`.

**Client virtual entry:** `virtual:verso/entry` generates a unified client entry with `() => import()` loaders for all page routes. In dev, the plugin builds `routeScripts` pointing all routes to this single virtual module URL (`/@id/__x00__virtual:verso/entry`), which is injected via the `ViteBundleLoader` middleware and served by Vite with HMR support. Vite code-splits each dynamic import target into its own module.

**Environment detection:** `env.ts` exports `isServer()`. Two compile-time constants are defined via the Vite plugin's `config` hook:

- **`IS_SERVER`**: In dev (`env.command === 'serve'`), defaults to `'true'` (SSR) with a `environments.client.define` override to `'false'`. In build (`env.command === 'build'`), set to `isSSRBuild ? 'true' : 'false'`. Also set in `bin/verso.js` via `globalThis.IS_SERVER = true` before jiti loads any modules, so the CLI path works under Node.
- **`IS_DEV`**: Set to `'true'` in dev (both server and client), `'false'` in build. Used to gate dev-only client logic (e.g. Vite style adoption in `styles.ts`) so it's tree-shaken from production bundles.

Both are declared in `globals.d.ts` and can be used directly for dead code elimination (e.g. `if (IS_DEV) { ... }`). The `isServer()` function wraps `IS_SERVER` for ergonomic runtime checks.

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
TODOs are tracked in ./TODO

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
