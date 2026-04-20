import type { ViteDevServer, ModuleNode } from 'vite';
import type { Stylesheet } from '../core/handler/Page';

/**
 * Walk the module graph for a handler and return its transitive CSS as `<link>`-style
 * stylesheets. Each stylesheet points at Vite's raw-CSS endpoint (`?direct`), and
 * carries the Vite module id as a data attribute so the client can reconcile link
 * tags against Vite's own `<style data-vite-dev-id>` injections during transitions.
 */
export async function collectCss(vite: ViteDevServer, handlerPath: string): Promise<Stylesheet[]> {
  const rootNode = await vite.moduleGraph.getModuleByUrl(handlerPath);
  if (!rootNode) return [];

  const visited = new Set<string>();
  const cssNodes: ModuleNode[] = [];

  function walk(node: ModuleNode) {
    if (!node.id || visited.has(node.id)) return;
    visited.add(node.id);
    if (node.file?.endsWith('.css')) {
      // TODO: what about CSS frameworks like LESS that use different extensions?
      cssNodes.push(node);
      return;
    }
    for (const imported of node.importedModules) {
      walk(imported);
    }
  }

  walk(rootNode);

  return cssNodes.map((node) => ({
    href: appendQuery(node.url, 'direct'),
    dataAttr: { name: 'data-vite-dev-id', value: node.id! },
  }));
}

export type CollectCss = typeof collectCss;

function appendQuery(url: string, param: string): string {
  return url.includes('?') ? `${url}&${param}` : `${url}?${param}`;
}
