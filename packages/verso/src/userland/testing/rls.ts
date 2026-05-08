import {resetClientRequest, startClientRequest, startRequest} from "../../core/common/RequestLocalStorage";
import type {MaybePromise} from "../../core/common/util/types";

export function withRLS<R, P extends MaybePromise<R>>(fn: () => P): () => P {
  if (globalThis.IS_SERVER) {
    return () => startRequest(fn);
  }
  return () => {
    startClientRequest();
    let result: P;
    try {
      result = fn();
      if (result instanceof Promise) {
        return result.finally(resetClientRequest) as P;
      }
      return result;
    } finally {
      resetClientRequest();
    }
  };
}
