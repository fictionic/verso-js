
## Project Overview

**Sluice** is a Bun-powered streaming SSR framework, and **isomorphic-stores** is its state management layer — a framework-agnostic adapter system for plugging Zustand, Redux, etc. into Sluice's SSR model. They live in one repo as a single package (`sluice`).

The core idea: stores are created server-side before render, async data is declared via `waitFor`, and Sluice's `Root` component blocks rendering until the store is ready. Client-side components can also create stores independently via `useCreateClientStore`.

A secondary goal: replace the pattern of bubbling all UI updates up through a root element (which triggers full-tree re-renders) with granular per-component subscriptions via selectors.

### Source layout

```
src/
├── sluice/              # SSR framework
│   ├── Page.ts          # Page interface (createStores, getElements, getTitle, getStyles)
│   ├── buildClientBundle.ts
│   ├── client.ts        # client entry point (bootstrap)
│   ├── constants.ts     # DOM attribute names (PAGE_ROOT_ELEMENT_ATTR, etc.)
│   ├── core/
│   │   ├── SluicePipe.ts       # typed server→client pipe instance (schema + constants)
│   │   ├── elementTokenizer.ts
│   │   ├── fetch.ts            # isomorphic fetch (caching, dedup, dehydration for GETs; urlPrefix for all)
│   │   └── components/
│   │       ├── Root.tsx
│   │       ├── RootContainer.tsx
│   │       └── TheFold.tsx
│   ├── server/
│   │   ├── RequestContext.ts
│   │   ├── renderPage.ts
│   │   └── writeBody.ts
│   ├── tests/
│   └── util/
│       ├── ServerClientPipe.ts  # generic typed server→client pipe factory
│       ├── cookies.ts
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
    ├── DemoPage.tsx
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

- `renderPage.ts` — streams HTML as roots become ready. Writes the shell immediately, then for each element awaits `element.props.when` before calling `renderToString`. When `TheFold` is reached, injects the dehydrated fetch cache and client bundle `<script>` tags. Roots arriving after the fold get inline `hydrateRootsUpTo` calls as they stream in.
- `Root.tsx` — pass-through component; `when` is read directly from props by `renderPage`.
- `TheFold.tsx` — null-rendering sentinel; identifies the above/below-fold boundary.
- `fetch.ts` — isomorphic `fetch` replacement. GETs are cached, deduplicated, and dehydrated via `SluicePipe`; non-GETs pass through with urlPrefix applied. Returns real `Response` objects. Client-side rehydrates from the pipe so GETs resolve instantly from cache.
- `ServerClientPipe.ts` — generic factory (`createPipe<Schema>`) for typed server→client data transport via inline `<script>` tags. `SluicePipe.ts` is the sluice-specific instance.
- `client.ts` — client entry point. Rehydrates the fetch cache from the pipe, creates a fresh `Page` instance, tokenizes elements, then hydrates roots as `hydrateRootsUpTo` events arrive.
- `buildClientBundle.ts` — writes a temporary entry file that imports `PageClass` and calls `bootstrap(PageClass)`, then uses `Bun.build` to bundle for the browser.

**SSR correctness note:** Zustand's `useStore` uses `useSyncExternalStore` with `getInitialState()` as the server snapshot, which returns state at construction time — before `waitFor` resolves. The Zustand adapter overrides `store.getInitialState = store.getState` so `renderToString` (called after `whenReady`) sees the resolved async values.

### Cross-root communication
Stores are scoped to React context trees. `broadcast` is a minimal escape hatch: send a message to all mounted instances of a store type from anywhere. Fire-and-forget, no request/response semantics.

### Demo site
Run with `bun src/demo/server.tsx`. Exercises sluice + isomorphic-stores together with Zustand stores, streaming roots, TheFold, late data arrivals, and cross-root broadcast.

### TODOs

#### sluice (SSR framework)
- Add a `createSluiceServer` function so server boilerplate (bundle build, `/client.js` route, SSR catch-all) lives in the framework rather than user code; this is also required for isomorphic cookie support — `renderPage` currently returns a bare `ReadableStream` with no access to the `Response` object, so the framework cannot set `Set-Cookie` headers. `createSluiceServer` would own `Response` construction, read pending cookies from RLS after `createStores()`, and attach them as headers before streaming begins
- HMR for the client bundle in the dev server — currently requires a restart to pick up changes; `Bun.build` has no watch mode, so this would need to be built on top of it
- Support pre-building the client bundle as a separate step (for prod), distinct from on-the-fly bundling at dev server startup
- add more methods to the Page API like getStyles, getScripts, etc
- API to allow page authors to transport arbitrary server-side data down to the client
- routing
- add the ability to register a callback on Root mount for a particular Root, and when all Roots have mounted, for automated tests
- fetch: support for opting into response replaying of non-GET requests

#### isomorphic-stores
- Add a mechanism for adapters to integrate the isomorphic-stores `StoreProvider` with a framework-native provider — e.g. so the Redux adapter can render a react-redux `<Provider store={store}>` alongside the isomorphic-stores context
- `useCreateClientStore` should return a `StoreProvider` so descendants can use `useStore` rather than threading `useClientStore` through the tree
- Stores that depend on other stores — not yet designed
- Client-side re-fetching / "going pending again" — not yet designed
- Cross-root communication: request/response pattern not yet designed

#### demo
- Add a demo of `nativeStore` access in `DemoPage`: a component that reads state imperatively via `instance.nativeStore.getState()` on button click
- automated tests via playwright

---

Default to using Bun instead of Node.js.

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
