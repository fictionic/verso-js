import { afterEach, describe, expect, test } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor as waitForDom,
} from "@testing-library/react";
import { testWithRLS } from "@verso-js/verso/testing";
import { IsoStoreProvider } from "../IsoStoreProvider";
import { asSingleton } from "../singleton";
import type { ConformanceRecipe } from "./recipe";

export function describeIsoStoreAdapter(recipe: ConformanceRecipe): void {
  describe(`isomorphic store adapter: ${recipe.name}`, () => {
    afterEach(cleanup);

    describe("provider + hooks", () => {
      test("initial state from the creator is readable through the hooks", () => {
        const store = recipe.makeValueStore({ kind: "sync", value: "42" });

        function Widget() {
          return <div>{store.useValue()}</div>;
        }

        const instance = store.def.createStore({});
        render(
          <IsoStoreProvider stores={[instance]}>
            <Widget />
          </IsoStoreProvider>,
        );

        expect(screen.getByText("42")).toBeTruthy();
      });

      test("reading a hook outside a provider throws", () => {
        const store = recipe.makeValueStore({ kind: "sync", value: "x" });

        function Widget() {
          return <div>{store.useValue()}</div>;
        }

        const originalError = console.error;
        console.error = () => {};
        try {
          expect(() => render(<Widget />)).toThrow(
            "isomorphic-stores: cannot call hooks outside a provider",
          );
        } finally {
          console.error = originalError;
        }
      });

      test("multiple stores wired into one provider are all readable", () => {
        const storeA = recipe.makeValueStore({ kind: "sync", value: "hello" });
        const storeB = recipe.makeValueStore({ kind: "sync", value: "world" });

        function Widget() {
          return <div>{storeA.useValue()} {storeB.useValue()}</div>;
        }

        const a = storeA.def.createStore({});
        const b = storeB.def.createStore({});
        render(
          <IsoStoreProvider stores={[a, b]}>
            <Widget />
          </IsoStoreProvider>,
        );

        expect(screen.getByText("hello world")).toBeTruthy();
      });
    });

    describe("async + whenReady", () => {
      test("setAsync: initial value shown before the promise resolves, value after", async () => {
        const { promise, resolve } = Promise.withResolvers<string>();
        const store = recipe.makeValueStore<string>({ kind: "async", promise });

        function Widget() {
          return <div>{store.useValue() ?? "loading"}</div>;
        }

        render(
          <IsoStoreProvider stores={[store.def.createStore({})]}>
            <Widget />
          </IsoStoreProvider>,
        );

        expect(screen.getByText("loading")).toBeTruthy();

        resolve("Alice");
        await waitForDom(() => screen.getByText("Alice"));
      });

      test("setAsync: whenReady resolves only after all blocking promises settle", async () => {
        const name = Promise.withResolvers<string>();
        const age = Promise.withResolvers<number>();

        const { def } = recipe.makeMultiAsyncStore([name.promise, age.promise]);

        const instance = def.createStore({});
        let resolved = false;
        void instance.whenReady.then(() => { resolved = true; });

        await act(async () => {});
        expect(resolved).toBe(false);

        name.resolve("Alice");
        await act(async () => {});
        expect(resolved).toBe(false);

        age.resolve(30);
        await act(async () => { await instance.whenReady; });
        expect(resolved).toBe(true);
      });

      test("setNonBlockingAsync: does not contribute to whenReady", async () => {
        const { promise, resolve } = Promise.withResolvers<string>();
        const store = recipe.makeValueStore<string>({ kind: "nonBlocking", promise, initial: "pending" });

        const instance = store.def.createStore({});
        let whenReadyResolved = false;
        void instance.whenReady.then(() => { whenReadyResolved = true; });

        await act(async () => {});
        expect(whenReadyResolved).toBe(true);

        resolve("loaded"); // resolve so we don't leak a pending promise
      });

      test("setNonBlockingAsync: shows initial before mount, resolves to value after mount", async () => {
        const { promise, resolve } = Promise.withResolvers<string>();
        const store = recipe.makeValueStore<string>({ kind: "nonBlocking", promise, initial: "pending" });

        function Widget() {
          return <div>{store.useValue()}</div>;
        }

        render(
          <IsoStoreProvider stores={[store.def.createStore({})]}>
            <Widget />
          </IsoStoreProvider>,
        );

        expect(screen.getByText("pending")).toBeTruthy();

        resolve("loaded");
        await waitForDom(() => screen.getByText("loaded"));
      });

      test("waitFor: blocks whenReady without writing any key", async () => {
        const { promise, resolve } = Promise.withResolvers<void>();
        const store = recipe.makeValueStore<string>({ kind: "waitFor", value: "steady", gate: promise });

        const instance = store.def.createStore({});
        let resolved = false;
        void instance.whenReady.then(() => { resolved = true; });

        function Widget() {
          return <div>{store.useValue()}</div>;
        }
        render(
          <IsoStoreProvider stores={[instance]}>
            <Widget />
          </IsoStoreProvider>,
        );

        await act(async () => {});
        expect(resolved).toBe(false);
        expect(screen.getByText("steady")).toBeTruthy();

        resolve();
        await act(async () => { await instance.whenReady; });
        expect(resolved).toBe(true);
        expect(screen.getByText("steady")).toBeTruthy();
      });
    });

    describe("errors", () => {
      test("setAsync rejection: onError fires, cause preserved, initial retained, whenReady still resolves", async () => {
        const errors: unknown[] = [];
        const store = recipe.makeValueStore<string>(
          { kind: "async", promise: Promise.reject(new Error("fetch failed")) },
          { onError: (e) => errors.push(e) },
        );

        function Widget() {
          return <div>{store.useValue() ?? "fallback"}</div>;
        }

        const instance = store.def.createStore({});
        await act(async () => {
          render(
            <IsoStoreProvider stores={[instance]}>
              <Widget />
            </IsoStoreProvider>,
          );
          await instance.whenReady;
        });

        expect(screen.getByText("fallback")).toBeTruthy();
        expect(errors).toHaveLength(1);
        expect(errors[0]).toBeInstanceOf(Error);
        expect((errors[0] as Error).cause).toBeInstanceOf(Error);
        expect(((errors[0] as Error).cause as Error).message).toBe("fetch failed");
      });

      test("duplicate async key throws (setAsync + setAsync)", () => {
        const def = recipe.makeDuplicateKeyStore("async+async");
        expect(() => def.createStore({})).toThrow("duplicate async key");
      });

      test("duplicate async key throws (setNonBlockingAsync + setNonBlockingAsync)", () => {
        const def = recipe.makeDuplicateKeyStore("nonBlocking+nonBlocking");
        expect(() => def.createStore({})).toThrow("duplicate async key");
      });

      test("duplicate async key throws (setAsync + setNonBlockingAsync)", () => {
        const def = recipe.makeDuplicateKeyStore("async+nonBlocking");
        expect(() => def.createStore({})).toThrow("duplicate async key");
      });
    });

    describe("reactivity", () => {
      test("an action updates state and re-renders subscribed components", async () => {
        const counter = recipe.makeCounterStore();

        function Widget() {
          const count = counter.useCount();
          const increment = counter.useIncrement();
          return <button onClick={increment}>{count}</button>;
        }

        render(
          <IsoStoreProvider stores={[counter.def.createStore({})]}>
            <Widget />
          </IsoStoreProvider>,
        );

        expect(screen.getByText("0")).toBeTruthy();

        fireEvent.click(screen.getByRole("button"));
        // the update might not be synchronous. valtio in particular emits
        // asynchronously by default
        expect(await screen.findByText("1")).toBeTruthy();
      });
    });

    describe("cross-root messaging", () => {
      test("broadcast delivers to onMessage handlers on all mounted instances", async () => {
        const store = recipe.makeMessageStore("initial");

        function Widget({ label }: { label: string }) {
          return <div data-testid={label}>{store.useName()}</div>;
        }

        const store1 = store.def.createStore({});
        const store2 = store.def.createStore({});
        render(
          <>
            <IsoStoreProvider stores={[store1]}><Widget label="w1" /></IsoStoreProvider>
            <IsoStoreProvider stores={[store2]}><Widget label="w2" /></IsoStoreProvider>
          </>,
        );

        expect(screen.getAllByText("initial")).toHaveLength(2);

        act(() => {
          store.def.broadcast({ type: "rename", name: "Bob" });
        });

        await waitForDom(() => expect(screen.getAllByText("Bob")).toHaveLength(2));
      });

      test("broadcast reaches later instances when one instance is in more than one provider", async () => {
        const store = recipe.makeMessageStore("initial");

        function Widget({ label }: { label: string }) {
          return <div data-testid={label}>{store.useName()}</div>;
        }

        const shared = store.def.createStore({});
        const other = store.def.createStore({});
        render(
          <>
            <IsoStoreProvider stores={[shared]}><Widget label="w1" /></IsoStoreProvider>
            <IsoStoreProvider stores={[shared]}><Widget label="w2" /></IsoStoreProvider>
            <IsoStoreProvider stores={[other]}><Widget label="w3" /></IsoStoreProvider>
          </>,
        );

        expect(screen.getAllByText("initial")).toHaveLength(3);

        act(() => {
          store.def.broadcast({ type: "rename", name: "Bob" });
        });

        await waitForDom(() => expect(screen.getAllByText("Bob")).toHaveLength(3));
      });
    });

    describe("client lifecycle + singleton", () => {
      test("useCreateClientStore: reports not-ready then ready with the value after whenReady", async () => {
        const { promise, resolve } = Promise.withResolvers<string>();
        const store = recipe.makeValueStore<string>({ kind: "async", promise });

        function Widget() {
          const [ready, clientHooks] = store.def.useCreateClientStore({});
          const value = store.readClient(clientHooks);
          if (!ready) return <div>not-ready</div>;
          return <div>{value}</div>;
        }

        render(<Widget />);
        expect(screen.getByText("not-ready")).toBeTruthy();

        resolve("hello");
        await waitForDom(() => screen.getByText("hello"));
      });

      testWithRLS("asSingleton: createStore yields an instance; a second createStore throws", () => {
        const singleton = asSingleton(recipe.makeValueStore({ kind: "sync", value: "42" }).def);

        const instance = singleton.createStore({});
        expect(instance).toBeTruthy();
        expect(instance.nativeStore).toBeTruthy();

        expect(() => singleton.createStore({})).toThrow(
          "cannot create more than one instance of a singleton store!",
        );
      });

      testWithRLS("asSingleton: hooks read the singleton through provider context", () => {
        const store = recipe.makeMessageStore("Alice");
        const singleton = asSingleton(store.def);
        const instance = singleton.createStore({});

        function Widget() {
          return <div>{store.useName()}</div>;
        }

        render(
          <IsoStoreProvider stores={[instance]}>
            <Widget />
          </IsoStoreProvider>,
        );

        expect(screen.getByText("Alice")).toBeTruthy();
      });

      testWithRLS("asSingleton: useClientHooks throws if no singleton has been created", () => {
        const store = recipe.makeValueStore({ kind: "sync", value: "x" });
        const singleton = asSingleton(store.def);

        function Widget() {
          const [, clientHooks] = singleton.useClientHooks();
          return <div>{store.readClient(clientHooks)}</div>;
        }

        const originalError = console.error;
        console.error = () => {};
        try {
          expect(() => render(<Widget />)).toThrow("no singleton instance has been created");
        } finally {
          console.error = originalError;
        }
      });

      testWithRLS("asSingleton: useClientHooks reports not-ready then ready after whenReady", async () => {
        const { promise, resolve } = Promise.withResolvers<string>();
        const store = recipe.makeValueStore<string>({ kind: "async", promise });
        const singleton = asSingleton(store.def);
        singleton.createStore({});

        function Widget() {
          const [ready, clientHooks] = singleton.useClientHooks();
          const value = store.readClient(clientHooks);
          return <div>{ready ? value : "not-ready"}</div>;
        }

        render(<Widget />);
        expect(screen.getByText("not-ready")).toBeTruthy();

        act(() => { resolve("Alice"); });
        await waitForDom(() => screen.getByText("Alice"));
      });

      testWithRLS("asSingleton: useClientHooks accesses the singleton cross-root without a provider", async () => {
        const store = recipe.makeValueStore({ kind: "sync", value: "hello" });
        const singleton = asSingleton(store.def);
        singleton.createStore({});

        function Widget() {
          const [ready, clientHooks] = singleton.useClientHooks();
          const value = store.readClient(clientHooks);
          if (!ready) return <div>waiting</div>;
          return <div>{value}</div>;
        }

        render(<Widget />);

        await waitForDom(() => screen.getByText("hello"));
      });

      testWithRLS("asSingleton: message broadcasts to mounted singleton instances", async () => {
        const store = recipe.makeMessageStore("initial");
        const singleton = asSingleton(store.def);
        const instance = singleton.createStore({});

        function Widget() {
          return <div>{store.useName()}</div>;
        }

        render(
          <IsoStoreProvider stores={[instance]}>
            <Widget />
          </IsoStoreProvider>,
        );

        expect(screen.getByText("initial")).toBeTruthy();

        act(() => {
          singleton.message({ type: "rename", name: "Bob" });
        });

        expect(await screen.findByText("Bob")).toBeTruthy();
      });
    });
  });
}
