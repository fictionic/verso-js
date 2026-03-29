const fallback = new Map<symbol, any>();

let als: { getStore(): Map<symbol, any> | undefined; run<R>(store: Map<symbol, any>, fn: () => R): R } | null = null;
if (IS_SERVER) {
  const { AsyncLocalStorage } = await import('node:async_hooks');
  als = new AsyncLocalStorage<Map<symbol, any>>();
}

function getStore(): Map<symbol, any> {
  return als?.getStore() ?? fallback;
}

export function startRequest<R>(fn: () => R): R {
  if (!als) throw new Error('startRequest requires a server environment');
  return als.run(new Map(), fn);
}

export function getNamespace<T extends object = Partial<Record<string, any>>>(): () => T {
  const key = Symbol();
  return () => {
    const store = getStore();
    if (!store.has(key)) store.set(key, {});
    return store.get(key) as T;
  };
}
