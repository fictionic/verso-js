export function exhaustive(_value: never): never {
  throw new Error(`switch-case was not exhaustive`);
}
