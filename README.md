# isomorphic-stores

> **⚠️ This is an untested sketch. Not ready for use.**

An adapter layer for using store-based state management frameworks in SSR streaming environments, with granular selector-based subscriptions for both server and client rendering.

## Motivation

I learned React development at Redfin, which uses [react-server](https://github.com/redfin/react-server) — an SSR framework built around streaming server rendering. Pages are written as a series of "root elements" that each declare their own async data dependencies; the server starts fetching immediately and streams each root element down as it becomes ready. This is genuinely great for performance and SEO.

When I was tasked with evaluating a React 18 upgrade, I studied Suspense closely and noticed that the React project was becoming increasingly opinionated about how apps should be structured — and that direction was antithetical to react-server's design. This bothered me: react-server's model is more flexible and better for SSR, and I didn't want to give it up.

Around the same time I started using [Zustand](https://github.com/pmndrs/zustand) in a side project and was struck by how much better it was than Redfin's proprietary Reflux-based stores/actions framework. Zustand is simple, ergonomic, and gets out of your way. Redfin's approach — decided around 2014 — required a lot of boilerplate and had a number of pitfalls.

This got me wondering: could you use something Zustand-like inside a react-server-style environment? That would mean:

- **Better developer experience** — Zustand's API instead of Reflux patterns
- **Better client-side performance** — Redfin's setup had one significant tradeoff: all client-side updates bubbled up through root elements via a `listen` prop, triggering full re-renders of the entire tree. A Zustand-like approach with selector-based subscriptions would eliminate this entirely.

The catch is that react-server requires stores to be **multiply-instantiable** — created per-request rather than as module singletons — to avoid cross-request state contamination. Zustand stores are normally module-level singletons, so they don't work in this environment out of the box.

`isomorphic-stores` is the result: a thin adapter layer that makes Zustand (and potentially other store frameworks) work in an SSR-streaming environment, while also serving as the client-side state layer — no handoff to a singleton store, no full-tree re-renders.

## Design

The core is framework-agnostic — it defines the `waitFor`/`whenReady` protocol and the adapter interface. The Zustand adapter is provided as a reference implementation. Any store-based framework with `getState`/`setState`/`subscribe` semantics could have an adapter written for it.

Store definitions use a two-layer factory pattern:

```ts
defineZustandIsoStore<MyOpts, MyState>(
  ({ userId }, waitFor) => (                     // outer: opts + waitFor (library layer)
    (set, get) => ({                             // inner: Zustand StateCreator (framework layer)
      ...waitFor('name', fetchName(userId), ''), // declares a dependency on fetchName.
      setName: (name) => set({ name }),          //  the state will update with the resolved value
    })
  )
);
```

The SSR integration is left to the call site — `isomorphic-stores` has no dependency on react-server or any specific SSR framework:

```tsx
// in handleRoute / getElements (react-server)
const store = MyStore.createStore({ userId: 1 });
return (
  <RootElement when={store.whenReady}>
    <MyStore.StoreProvider instance={store}>
      <Widget />
    </MyStore.StoreProvider>
  </RootElement>
);

// in a component
const name = MyStore.useStore(s => s.name);

// in a client-only component
const { ready, useClientStore } = MyStore.useCreateClientStore({ userId: 1 });
const name = useClientStore(s => s.name); // null until ready
```

## Cross-root communication

Because stores are scoped to a React context tree, components in different roots can't access each other's stores. This is an inherent consequence of the instance-per-request model — the same thing that makes SSR safe also breaks the "access any store from anywhere" pattern that frameworks like Zustand support natively.

For example: a login button in a page header root needs to tell a login dialog in a separate root to open. Or multiple "add to favorites" buttons scattered across different roots need to update a shared favorites store.

Currently, `isomorphic-stores` addresses this with a `broadcast` mechanism on the store definition:

```ts
// from anywhere
MyStore.broadcast({ type: 'openDialog' });

// in the store definition
onMessage((message) => {
  if (message.type === 'openDialog') set({ dialogOpen: true });
});
```

`broadcast` is fire-and-forget: it delivers a message to all currently-mounted instances of a store type. It's intentionally minimal — more of an escape hatch than a designed solution.

The deeper question of how cross-root communication should work in an instance-based store architecture is unresolved. Patterns like request/response between stores, or stores subscribing to each other across roots, are not yet designed. Feedback welcome.
