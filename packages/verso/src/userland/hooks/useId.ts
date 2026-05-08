import {getRLS} from "../../core/common/RequestLocalStorage";

const RLS = getRLS<{ count?: number }>();

export function useId(prefix?: string): string {
  const count = ensureCount();
  return `${prefix ?? ''}:${count}`;
}

function ensureCount(): number {
  if (typeof RLS().count !== 'number') {
    RLS().count = 0;
  }
  return RLS().count!++;
}
