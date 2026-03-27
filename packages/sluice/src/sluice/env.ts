declare const IS_CLIENT: boolean;

const _isServer: boolean = typeof IS_CLIENT === 'undefined' || !IS_CLIENT;

export function isServer(): boolean {
  return _isServer;
}
