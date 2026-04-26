import { Fetch, setFetchInterceptor } from "./Fetch";

const { fetch } = Fetch;

// application-facing exports
export { fetch, setFetchInterceptor };
export type { FetchRequestInterceptor, FetchRequestSettings, InterceptResult, VersoFetchInit } from './types';
