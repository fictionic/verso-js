import { useState } from 'react';

// A trivial interactive component: its click handler only works once the root
// has hydrated, so E2E tests can assert "the page is interactive".
export function Counter({ testid = 'counter' }: { testid?: string }) {
  const [count, setCount] = useState(0);
  return (
    <button data-testid={testid} onClick={() => setCount((n) => n + 1)}>
      count: {count}
    </button>
  );
}
