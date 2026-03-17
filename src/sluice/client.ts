import { receiveLateDataArrival, rehydrateCache } from './core/fetch';
import { scheduleRender } from './core/components/Root';
import { TOKEN, tokenizeElements } from './core/elementTokenizer';
import type { Page } from './Page';
import { FETCH_CACHE_KEY, FN_RECEIVE_LATE_DATA_ARRIVAL, FN_HYDRATE_ROOTS_UP_TO, SluicePipe } from './core/SluicePipe';
import { PAGE_ELEMENT_TOKEN_ID_ATTR, PAGE_ROOT_ELEMENT_ATTR } from './constants';
import { hydrateRoot } from 'react-dom/client';

export async function bootstrap(PageClass: new () => Page): Promise<void> {
  const readablePipe = SluicePipe.reader();
  const fetchCache = (readablePipe.readValue(FETCH_CACHE_KEY) ?? {});
  rehydrateCache(fetchCache);

  const page = new PageClass();
  page.createStores();

  const tokens = tokenizeElements(page.getElements());

  const rootDomNodeDfds: Record<number, PromiseWithResolvers<Element>> = {};
  tokens.forEach((token, i) => {
    if (token.type === TOKEN.ROOT) {
      rootDomNodeDfds[i] = Promise.withResolvers();
      const renderPromise = scheduleRender(token.element);
      rootDomNodeDfds[i].promise.then(async (node) => {
        try {
          const reactElement = await renderPromise;
          hydrateRoot(node, reactElement);
        } catch (e) {
          console.error(`client: error hydrating root ${i}`, e);
        }
      });
    }
  });

  let nextRootIndex = 0;
  const hydrateRootsUpTo = (index: number) => {
    for (let i = nextRootIndex; i <= index; i++) {
      const node = document.querySelector(`[${PAGE_ROOT_ELEMENT_ATTR}][${PAGE_ELEMENT_TOKEN_ID_ATTR}="${i}"]`);
      if (!node) {
        // not a root
        continue;
      }
      const dfd = rootDomNodeDfds[i];
      if (!dfd) {
        console.error(`client: no deferred set up for node ${i}`);
        continue;
      }
      dfd.resolve(node);
    }
    nextRootIndex = index + 1;
  };

  readablePipe.onCallFn(FN_HYDRATE_ROOTS_UP_TO, hydrateRootsUpTo);
  readablePipe.onCallFn(FN_RECEIVE_LATE_DATA_ARRIVAL, receiveLateDataArrival);
}
