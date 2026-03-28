import type {EndpointResponseData, StandardizedEndpoint} from "../core/handler/Endpoint";

export async function handleEndpoint(
  endpoint: StandardizedEndpoint,
): Promise<EndpointResponseData> {
  const data = await endpoint.getResponseData();
  return data;
}
