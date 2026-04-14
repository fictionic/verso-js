import { startClientRequest, resetClientRequest } from './core/RequestLocalStorage';
import type { MaybePromise } from './core/util/types';

export function setupRLS(): void {
  startClientRequest();
}

export function teardownRLS(): void {
  resetClientRequest();
}

export function withRLS<R, P extends MaybePromise<R>>(fn: () => P): () => P {
  return () => {
    setupRLS();
    let result: P;
    try {
      result = fn();
      if (result instanceof Promise) {
        return result.finally(teardownRLS) as P;
      }
      return result;
    } finally {
      teardownRLS();
    }
  };
}
