# Verso

**Lightning fast, truly isomorphic server-rendering with React**

Verso is the modern evolution of Redfin's `react-server`. It rejects the single-tree "Suspense" model in favor of a surgical, multi-root hydration architecture that prioritizes SEO, UX stability, and developer transparency.

## Why Verso?

- **No Suspense Flickering**: We don't believe in "pop-in" UI. If the data isn't ready, the stream waits. If it's above the fold, it arrives final.
- **True SEO**: Bots see the same stream as users. We never disable streaming for crawlers.
- **LCP Optimization**: By avoiding skeletons and layout shifts, Verso maximizes Core Web Vitals (Largest Contentful Paint) by default.
- **Isomorphic State**: Powered by `@verso-js/stores`, state is created on the server and hydrated on the client with zero boilerplate.

## Core Concepts

### 1. Multi-Root Hydration
Unlike standard React apps, a Verso page is composed of independent `Root` elements. Each root is its own hydration boundary. This allows the server to prioritize the delivery of critical "Above the Fold" content, which becomes interactive while the rest of the page is still streaming.

### 2. Layout Streaming
Using `<RootContainer />`, Verso can stream nested layouts synchronously. This means your site structure (grid, headers, sidebars) arrives instantly, with content roots "filling in" as soon as their data is ready—avoiding the Cumulative Layout Shift (CLS) common in skeleton-based designs.

### 3. Late Arrivals & Non-Blocking Data
While Verso prioritizes "First View is the Truth," it also easily supports "Suspense-like" lazy loading when needed. Using the **Late Arrivals** mechanism and `clientOnly` stores:
- **Server-Initiated Fetching**: Data fetches are started on the server but do not block the initial render.
- **Tokenized Transport**: Once the response arrives, it is transported down to the client as an inline `<script>` tag within the same HTTP stream.
- **Automatic Updates**: The corresponding component is automatically updated on the client with the new data, providing the benefits of lazy loading without the architectural complexity of Suspense.

### 4. The Fold
The `<TheFold />` component is a first-class synchronization primitive. It tells the Verso stream exactly when to trigger the client-side bootstrap, ensuring your "Above the Fold" experience is interactive as fast as humanly possible.

### 5. Verso-Compatible Stores (`@verso-js/stores`)
Standard state management libraries (Zustand, Redux, etc.) are built for single-page apps, not for high-performance streaming SSR. They lack the concept of **Render Scheduling**—the ability to tell a server stream "don't render me until my data is ready."

Verso provides `@verso-js/stores` as a lightweight protocol layer that adds the magic sauce required for SSR:
- **Render Scheduling**: Stores expose a `whenReady` promise. Verso’s orchestration layer uses this to pause the server-side stream for that specific root until the data is resolved.
- **Request Isolation**: Stores are **multiply-instantiable** (request-scoped) to prevent state leaks between users on the server.
- **Adapter Logic**: Reference implementations are provided for **Zustand** and **Redux**, but the protocol is framework-agnostic. You can wrap any library—or build your own—to make it Verso-compatible.

## The Lifecycle of a Root

1.  **Define**: You define a store using an adapter (e.g., `defineZustandIsoStore`).
2.  **Initialize**: In `getRouteDirective`, you create a store instance: `const userStore = UserStore.createStore({ id })`.
3.  **Schedule**: You pass that store to a root: `<StoreRoot stores={[userStore]}><User /></StoreRoot>`.
4.  **Wait**: Verso's server-side orchestrator calls `store.whenReady` and **pauses the stream** for that root.
5.  **Flush**: Once ready, Verso renders the `Root` to **final HTML** and flushes it.
6.  **Hydrate**: On the client, the root hydrates immediately using the same state that was used on the server.

## Getting Started

Verso is designed to work "out of the box" with a modern Vite-powered workflow.

```typescript
// vite.config.ts
import { verso } from '@verso-js/verso/plugin';

export default {
  plugins: [
    verso({
      routes: './src/routes.ts',
    })
  ]
};
```

## Comparison: Verso vs. The Industry

| Feature | Verso | React Suspense (Next.js/Remix) |
| :--- | :--- | :--- |
| **Streaming Model** | In-Order Tokenized | Out-of-Order Suspense |
| **Initial View** | Final HTML | Skeleton Placeholders |
| **SEO Bots** | Full Streaming Support | Streaming often Disabled |
| **Hydration** | Multi-Root (Surgical) | Monolithic (Single Tree) |
| **Layout Stability** | No CLS (Layout first) | High CLS (Pop-in content) |

---
*For the "Why" behind this architecture, read the [MANIFESTO.md](./MANIFESTO.md).*
