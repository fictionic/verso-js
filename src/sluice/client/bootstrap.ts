import { scheduleRender } from '../core/components/Root';
import { TOKEN, tokenizeElements } from '../core/elementTokenizer';
import { FETCH_CACHE_KEY, FN_RECEIVE_LATE_DATA_ARRIVAL, FN_HYDRATE_ROOTS_UP_TO, SluicePipe } from '../core/SluicePipe';
import { PAGE_ELEMENT_TOKEN_ID_ATTR, PAGE_ROOT_ELEMENT_ATTR } from '../constants';
import { hydrateRoot } from 'react-dom/client';
import { global } from './globals';
import {Fetch} from '../core/fetch/Fetch';
import {RequestContext} from '../core/RequestContext';
import {match} from 'path-to-regexp';
import type {PageDefinition} from '../Page';
import {ResponderConfig} from '../core/ResponderConfig';
import {createHandlerChain} from '../core/chain';
import type {MiddlewareDefinition} from '../Middleware';
import {createCtx} from '../core/RouteHandlerCtx';
import {SluiceRequest} from '../core/SluiceRequest';

global.CLIENT_READY_DFD = Promise.withResolvers<void>();

export async function bootstrap(def: PageDefinition, path: string, middleware: MiddlewareDefinition[]): Promise<void> {
  const routeResult = match(path)(location.pathname);
  if (!routeResult) {
    console.error("no route!");
    return;
  }
  const { params: routeParams } = routeResult;
  const req = SluiceRequest.client(routeParams);
  RequestContext.clientInit();
  Fetch.clientInit();
  const readablePipe = SluicePipe.reader();
  const fetchCache = (readablePipe.readValue(FETCH_CACHE_KEY) ?? {});
  Fetch.getCache().client().rehydrate(fetchCache);
  const config = new ResponderConfig();
  const ctx = createCtx(config, req);
  const page = createHandlerChain('page', def, middleware, config, ctx);
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
      console.log(`[sluice-debug] registered root at token index ${i}`);
      // start rendering below-the-fold roots before their dom nodes have streamed in
      const renderPromise = scheduleRender(token.element);
      rootDomNodeDfds[i].promise.then(async (node) => {
        try {
          const reactElement = await renderPromise;
          hydrateRoot(node, reactElement);
          console.log(`[sluice-debug] hydrated root ${i}`);
          hydrationDfd.resolve();
        } catch (e) {
          console.error(`client: error hydrating root ${i}`, e);
          hydrationDfd.reject();
        }
      });
    }
  });

  Promise.allSettled(Object.values(rootHydrationDfds).map(dfd => dfd.promise)).then(() => {
    console.log(`[sluice-debug] all roots hydrated, resolving CLIENT_READY_DFD`);
    global.CLIENT_READY_DFD!.resolve();
  });

  let nextRootIndex = 0;
  const hydrateRootsUpTo = (index: number) => {
    console.log(`[sluice-debug] hydrateRootsUpTo(${index}), nextRootIndex=${nextRootIndex}`);
    for (let i = nextRootIndex; i <= index; i++) {
      const dfd = rootDomNodeDfds[i];
      if (!dfd) {
        // not a root
        continue;
      }
      const node = document.querySelector(`[${PAGE_ROOT_ELEMENT_ATTR}][${PAGE_ELEMENT_TOKEN_ID_ATTR}="${i}"]`);
      if (!node) {
        console.log(`[sluice-debug] root ${i}: DOM node NOT FOUND`);
        continue;
      }
      console.log(`[sluice-debug] root ${i}: DOM node found, resolving`);
      dfd.resolve(node);
    }
    nextRootIndex = index + 1;
  };

  readablePipe.onCallFn(FN_HYDRATE_ROOTS_UP_TO, hydrateRootsUpTo);
  readablePipe.onCallFn(FN_RECEIVE_LATE_DATA_ARRIVAL, Fetch.getCache().client().receiveCachedResponse);
}
