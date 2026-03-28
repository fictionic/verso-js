import { scheduleRender } from '../core/components/Root';
import { TOKEN, tokenizeElements } from '../core/elementTokenizer';
import { FETCH_CACHE_KEY, FN_RECEIVE_LATE_DATA_ARRIVAL, FN_HYDRATE_ROOTS_UP_TO, VersoPipe } from '../core/VersoPipe';
import { PAGE_ELEMENT_TOKEN_ID_ATTR, PAGE_ROOT_ELEMENT_ATTR } from '../constants';
import { hydrateRoot } from 'react-dom/client';
import { global } from './globals';
import {Fetch} from '../core/fetch/Fetch';
import type {PageDefinition} from '../core/handler/Page';
import {ResponderConfig} from '../core/handler/ResponderConfig';
import {createHandlerChain} from '../core/handler/chain';
import {createCtx} from '../core/handler/RouteHandlerCtx';
import {VersoRequest} from '../core/VersoRequest';
import {createRouter, type SiteConfig} from '../server/router';

export type PageLoaders = Record<string, () => Promise<{ default: PageDefinition }>>;

global.CLIENT_READY_DFD = Promise.withResolvers<void>();

export async function bootstrap(site: SiteConfig, pageLoaders: PageLoaders): Promise<void> {
  const router = createRouter(site.routes);
  const route = router.matchRoute(location.pathname, 'GET');
  if (!route) {
    console.error("[verso] no route for", location.pathname);
    return;
  }
  const loader = pageLoaders[route.routeName];
  if (!loader) {
    console.error("[verso] no page loader for route", route.routeName);
    return;
  }
  const pageDef = (await loader()).default;

  const req = VersoRequest.clientInit(route.params);
  Fetch.clientInit();
  const readablePipe = VersoPipe.reader();
  const fetchCache = (readablePipe.readValue(FETCH_CACHE_KEY) ?? {});
  Fetch.getCache().client().rehydrate(fetchCache);
  const config = new ResponderConfig();
  const ctx = createCtx(config, req, route);
  const page = createHandlerChain('page', pageDef, site.middleware ?? [], config, ctx);
  await page.getRouteDirective(); // just for data fetching, for now

  const tokens = tokenizeElements(page.getElements());

  // so consumers can know when the page is ready. not used for bootstrap.
  const rootHydrationDfds: Record<number, PromiseWithResolvers<void>> = {};

  const rootDomNodeDfds: Record<number, PromiseWithResolvers<Element>> = {};
  tokens.forEach((token, i) => {
    if (token.type === TOKEN.ROOT) {
      const hydrationDfd = Promise.withResolvers<void>();
      rootHydrationDfds[i] = hydrationDfd;
      rootDomNodeDfds[i] = Promise.withResolvers();
      console.log(`[verso-debug] registered root at token index ${i}`);
      // start rendering below-the-fold roots before their dom nodes have streamed in
      const renderPromise = scheduleRender(token.element);
      rootDomNodeDfds[i].promise.then(async (node) => {
        try {
          const reactElement = await renderPromise;
          hydrateRoot(node, reactElement);
          console.log(`[verso-debug] hydrated root ${i}`);
          hydrationDfd.resolve();
        } catch (e) {
          console.error(`client: error hydrating root ${i}`, e);
          hydrationDfd.reject();
        }
      });
    }
  });

  Promise.allSettled(Object.values(rootHydrationDfds).map(dfd => dfd.promise)).then(() => {
    console.log(`[verso-debug] all roots hydrated, resolving CLIENT_READY_DFD`);
    global.CLIENT_READY_DFD!.resolve();
  });

  let nextRootIndex = 0;
  const hydrateRootsUpTo = (index: number) => {
    console.log(`[verso-debug] hydrateRootsUpTo(${index}), nextRootIndex=${nextRootIndex}`);
    for (let i = nextRootIndex; i <= index; i++) {
      const dfd = rootDomNodeDfds[i];
      if (!dfd) {
        // not a root
        continue;
      }
      const node = document.querySelector(`[${PAGE_ROOT_ELEMENT_ATTR}][${PAGE_ELEMENT_TOKEN_ID_ATTR}="${i}"]`);
      if (!node) {
        console.log(`[verso-debug] root ${i}: DOM node NOT FOUND`);
        continue;
      }
      console.log(`[verso-debug] root ${i}: DOM node found, resolving`);
      dfd.resolve(node);
    }
    nextRootIndex = index + 1;
  };

  readablePipe.onCallFn(FN_HYDRATE_ROOTS_UP_TO, hydrateRootsUpTo);
  readablePipe.onCallFn(FN_RECEIVE_LATE_DATA_ARRIVAL, Fetch.getCache().client().receiveCachedResponse);
}
