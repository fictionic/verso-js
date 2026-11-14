export async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve));
}

export async function rejected(p: Promise<unknown>): Promise<any> {
  return await p.catch((e) => e);
}

export function delay(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

