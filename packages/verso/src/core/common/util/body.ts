const TEXT_CONTENT_TYPE_REGEXES = [
  /^text\//,
  /^application\/x-www-form-urlencoded(?=[;\s]|$)/,
  /^application\/(\S+\+)?(json|xml|yaml|toml)(?=[;\s]|$)/,
  /^application\/(java|ecma)script(?=[;\s]|$)/,
  /^image\/svg\+xml(?=[;\s]|$)/,
];

type R = Request | Response;

export function hasBinaryBody(r: R): boolean {
  if (!r.body) return false;
  const contentType = r.headers.get('Content-Type');
  if (!contentType) {
    // better safe than sorry
    console.warn("[verso] treating request/response body as binary because it lacks Content-Type");
    return true;
  }
  return !TEXT_CONTENT_TYPE_REGEXES.some((regex) => regex.test(contentType));
}

export type MarshalledBody = {
  text: string;
  isBinary?: boolean;
}

export async function marshallBody(r: R): Promise<MarshalledBody | null> {
  if (r.bodyUsed) throw new Error('body already used!');
  if (!r.body) return null;
  return hasBinaryBody(r) ? await marshallBinaryBody(r) : await marshallTextBody(r);
}

async function marshallTextBody(r: R): Promise<MarshalledBody> {
  return {
    text: await r.text(),
  };
}

async function marshallBinaryBody(r: R): Promise<MarshalledBody> {
  return {
    text: (await r.bytes()).toBase64(),
    isBinary: true,
  };
}

export function unmarshallBody(b: MarshalledBody | null): BodyInit | null {
  if (!b) return null;
  return b.isBinary ? Uint8Array.fromBase64(b.text) : b.text;
}
