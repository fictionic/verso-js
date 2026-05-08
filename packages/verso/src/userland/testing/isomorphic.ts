import { describe, test } from 'vitest';

export function serverSide(fn: () => void): void {
  if (IS_SERVER) {
    describe('(server)', fn);
  } else {
    skipEnv('client');
  }
}

export function clientSide(fn: () => void): void {
  if (!IS_SERVER) {
    describe('(client)', fn);
  } else {
    skipEnv('server');
  }
}

function skipEnv(env: string) {
  describe(`(${env}:skip)`, () => test('skip', () => {}));
}
