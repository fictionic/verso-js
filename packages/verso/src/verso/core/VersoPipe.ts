import { createPipe, type PipeSchema } from "../util/ServerClientPipe";
import type { CachedResponse, CacheEntry } from "./fetch/cache";

export const VERSO_PIPE_NAME = '__versoPipe';

export const FETCH_CACHE_KEY = 'fetchCache' as const;

export const FN_HYDRATE_ROOTS_UP_TO = 'hydrateRootsUpTo' as const;
export const FN_RECEIVE_LATE_DATA_ARRIVAL = 'receiveLateDataArrival' as const;

export interface VersoPipeSchema extends PipeSchema {
  data: {
    [FETCH_CACHE_KEY]: Record<string, CacheEntry>;
  };
  fns: {
    [FN_HYDRATE_ROOTS_UP_TO]: [number];
    [FN_RECEIVE_LATE_DATA_ARRIVAL]: [string, CachedResponse];
  };
}

export const VersoPipe = createPipe<VersoPipeSchema>(VERSO_PIPE_NAME);
