import { createPipe, type PipeSchema } from "../util/ServerClientPipe";
import type { CacheEntry } from "./fetch";

export const FETCH_CACHE_KEY = '__sluiceFetchCache' as const;

export const FN_HYDRATE_ROOTS_UP_TO = 'hydrateRootsUpTo' as const;
export const FN_RECEIVE_LATE_DATA_ARRIVAL = 'receiveLateDataArrival' as const;

interface SluicePipeSchema extends PipeSchema {
  data: {
    [FETCH_CACHE_KEY]: Record<string, CacheEntry>;
  };
  fns: {
    [FN_HYDRATE_ROOTS_UP_TO]: [number];
    [FN_RECEIVE_LATE_DATA_ARRIVAL]: [string, CacheEntry];
  };
}

const PIPE_KEY = '__sluicePipe';

export const SluicePipe = createPipe<SluicePipeSchema>(PIPE_KEY);
