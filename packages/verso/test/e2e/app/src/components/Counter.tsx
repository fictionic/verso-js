import { useState } from 'react';

// the click works only after hydration
export function Counter({ testid = 'counter' }: { testid?: string }) {
  const [count, setCount] = useState(0);
  return (
    <button data-testid={testid} onClick={() => setCount((n) => n + 1)}>
      count: {count}
    </button>
  );
}
