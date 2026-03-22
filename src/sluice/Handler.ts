import type {EndpointDefinition} from "./Endpoint";
import type {PageDefinition} from "./Page";

export type RouteHandler = PageDefinition | EndpointDefinition;
