export function isServer(): boolean {
  return globalThis.IS_SERVER;
}

export function isDev(): boolean {
  return globalThis.IS_DEV;
}
