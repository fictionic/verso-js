
## Project Overview

`zustand-server` is a state management library that bridges [Zustand](https://github.com/pmndrs/zustand) with [react-server](https://github.com/redfin/react-server) (Redfin's SSR framework). The core idea: stores are created server-side before render (e.g. in `handleRoute`), async data is declared via `waitFor`, and react-server's `RootElement` blocks rendering until the store is ready. Client-side components can also create stores independently via `useCreateClientStore`.

### Key files
- `src/index.ts` — main library (`defineStore`, types)
- `src/StoreProvider.tsx` — generic context Provider component
- `src/examples/` — example store and components

### Core API

```ts
// Define a store
const MyStore = defineStore<MyOpts, MyState>((opts, set, get, waitFor) => ({
  ...waitFor('name', fetchName(opts.userId), ''),
  setName: (name) => set({ name }),
}));

// Server-side (handleRoute / getElements)
const store = MyStore.createStore({ userId: 1 });
// <RootElement when={() => store.ready}>
//   <MyStore.StoreProvider instance={store}>
//     <Widget />
//   </MyStore.StoreProvider>
// </RootElement>

// In components (server-rendered)
const name = MyStore.useStore(s => s.name);

// Client-only components
const { ready, useClientStore } = MyStore.useCreateClientStore({ userId: 1 });
const name = useClientStore(s => s.name); // null until ready
```

### Design decisions
- `waitFor(key, promise, initialValue)` declares async state — returns `{ key: initialValue }` to spread into state, registers promise to resolve after init
- `ready` is a `Promise<void>` that resolves when all `waitFor` promises complete
- `zustand-server` has no dependency on react-server — integration happens at the call site via `RootElement.when`
- `useCreateClientStore` creates the store in a `useEffect` (client-only), returns `{ ready, useClientStore }` where `useClientStore` returns `T | null`
- Client-side re-fetching / "going pending again" is intentionally not yet designed

### Open questions
- How should client-side re-fetching work? Options: store manages its own loading state, `waitFor` callable after init, or framework-managed `pending` state
- Export API: should hooks be on the `StoreDefinition` object or exported as named hooks from store modules

---

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
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

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
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
