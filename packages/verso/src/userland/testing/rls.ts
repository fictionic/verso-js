import {test, type TestAPI} from "vitest";
import {stopClientRLS, startClientRLS, runWithServerRLS} from "../../core/common/RequestLocalStorage";
import type {MaybePromise} from "../../util/promise";

export function withRLS<R, P extends MaybePromise<R>>(fn: () => P): P {
  if (globalThis.IS_SERVER) {
    return runWithServerRLS(fn);
  }
  startClientRLS();
  let result: P;
  try {
    result = fn();
  } catch (e) {
    stopClientRLS();
    throw e;
  }
  if (result instanceof Promise) {
    return result.finally(stopClientRLS) as P;
  }
  stopClientRLS();
  return result;
}

export const testWithRLS: TestAPI = wrapWithRLS(test);

function wrapWithRLS<T extends object>(api: T): T {
  return new Proxy(api, {
    apply(target, thisArg, args: unknown[]) {
      const wrapped = args.map((arg, i) => {
        return i > 0 && typeof arg === "function"
          ? (ctx: unknown) => withRLS(() => (arg as Function)(ctx))
          : arg;
      });
      return Reflect.apply(target as Function, thisArg, wrapped);
    },
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      // Re-wrap chainable members so `.skip`, `.each(...)`, etc. stay wrapped.
      // (Bind functions to the original target to keep `this` correct.)
      if (typeof value === "function") {
        return wrapWithRLS(value.bind(target));
      }
      return value;
    },
  });
}
