import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { jsx: { runtime: 'automatic' } });

export async function importModule<T = any>(path: string): Promise<T> {
  const mod = await jiti.import(path) as any;
  return (mod.default ?? mod) as T;
}
