import type http from 'node:http';

export function toWebRequest(nodeReq: http.IncomingMessage, url: URL): Request {
  const headers = new Headers();
  for (const [key, value] of Object.entries(nodeReq.headers)) {
    if (value) {
      const values = Array.isArray(value) ? value : [value];
      for (const v of values) {
        headers.append(key, v);
      }
    }
  }
  return new Request(url, {
    method: nodeReq.method,
    headers,
    body: nodeReq.method !== 'GET' && nodeReq.method !== 'HEAD' ? nodeReq as any : undefined,
    // @ts-expect-error duplex is needed for streaming request bodies
    duplex: 'half',
  });
}

export async function sendWebResponse(nodeRes: http.ServerResponse, response: Response) {
  nodeRes.statusCode = response.status;
  response.headers.forEach((value, key) => {
    nodeRes.setHeader(key, value);
  });

  if (!response.body) {
    nodeRes.end();
    return;
  }

  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      nodeRes.write(value);
    }
  } finally {
    nodeRes.end();
  }
}
