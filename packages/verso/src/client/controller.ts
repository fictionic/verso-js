import {createRouter, type Router, type SiteConfig} from "../core/router";
import type {PageLoaders} from "./bootstrap";
import {ResponderConfig} from "../core/handler/ResponderConfig";
import {VersoRequest} from "../core/VersoRequest";
import {createCtx} from "../core/handler/RouteHandlerCtx";
import {createHandlerChain} from "../core/handler/chain";
import {setNodeAttrs, type StandardizedPage} from "../core/handler/Page";
import {createRoot, hydrateRoot, type Root} from "react-dom/client";
import {TOKEN, tokenizeElements} from "../core/elementTokenizer";
import {scheduleRender} from "../core/components/Root";
import { global } from './globals';
import {PAGE_ELEMENT_TOKEN_ID_ATTR, PAGE_HEADER_LINK_ELEMENT_ATTR, PAGE_ROOT_ELEMENT_ATTR} from "../core/constants";
import {FETCH_CACHE_KEY, FN_HYDRATE_ROOTS_UP_TO, FN_RECEIVE_LATE_DATA_ARRIVAL, VersoPipe} from "../core/VersoPipe";
import {Fetch} from "../core/fetch/Fetch";
import {startClientRequest} from "../RequestLocalStorage";
import {applyContainerProps} from "../core/components/RootContainer";
import {getStyleTransitioner, type StyleTransitioner} from "./styles";
import {getScriptTransitioner, type ScriptTransitioner} from "./scripts";
import type {BundleManifest} from "../build/bundle";

let self: ClientController | null = null;
export function getClientController(): ClientController {
  if (!self) {
    throw new Error('ClientController not initialized!');
  }
  return self;
}

global.CLIENT_READY_DFD = Promise.withResolvers<void>();

export interface NavigateOptions {
  replace: boolean;
}

export class ClientController {
  private site: SiteConfig;
  private router: Router;
  private pageLoaders: PageLoaders;
  private reactRoots: Root[];
  private styleTransitioner: StyleTransitioner;
  private scriptTransitioner: ScriptTransitioner;

  constructor(site: SiteConfig, pageLoaders: PageLoaders, manifest: BundleManifest | null) {
    this.site = site;
    this.router = createRouter(site.routes);
    this.pageLoaders = pageLoaders;
    this.reactRoots = [];
    this.styleTransitioner = getStyleTransitioner(manifest);
    this.scriptTransitioner = getScriptTransitioner();
    self = this;
    global.__versoController = this; // for playwright tests
  }

  async hydrate(method = 'GET') {
    startClientRequest();
    this.styleTransitioner.readServerStyles();
    this.scriptTransitioner.readServerScripts();
    // TODO: pipe down server http method, in case pages are wired up to POST or something
    const readablePipe = VersoPipe.reader();
    const fetchCache = (readablePipe.readValue(FETCH_CACHE_KEY) ?? {});
    Fetch.clientInit();
    Fetch.getCache().client().rehydrate(fetchCache);

    const { page } = await this.getRoutedPageChain(new URL(window.location.href), method); // TODO error handling

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
            const reactRoot = hydrateRoot(node, reactElement);
            this.reactRoots.push(reactRoot);
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
      // TODO: handle navigations that occur during hydration?
      window.addEventListener('popstate', () => {
        this.navigate(location.pathname + location.search, { replace: true });
      });
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

  async navigate(url: string, options?: NavigateOptions): Promise<void> {
    const { replace } = options ?? { replace: false };
    startClientRequest();
    global.CLIENT_READY_DFD = Promise.withResolvers();
    // TODO: clear out VersoPipe script, for tidiness
    Fetch.clientInit(); // just initiate an empty cache, since Fetch assumes it'll exist

    const { page, routeName } = await this.getRoutedPageChain(new URL(url, window.location.origin), 'GET' /* all client requests are GET */); // TODO error handling

    await page.getRouteDirective(); // TODO: redirects...?

    // ok we're committing to the new location
    if (!replace) {
      history.pushState(null, '', url); // TODO: need to avoid clobbering user-level pushstates... reactServerFrame
      // TODO replaceState?
    }

    // =header=
    document.title = page.getTitle();
    // update links. can just blindly throw away old ones and add new ones
    document.querySelectorAll(`[${PAGE_HEADER_LINK_ELEMENT_ATTR}]`).forEach(node => {
      node.parentNode?.removeChild(node);
    });
    page.getLinkTags().forEach((link) => {
      const node = document.createElement('link');
      setNodeAttrs(node, link);
      document.head.appendChild(node);
    });
    // update styles. have to take care to avoid FOUC
    const cleanupPreviousStyles = await this.styleTransitioner.transitionStyles(routeName, page.getStylesheets());
    // update scripts. track each one and only add new ones
    this.scriptTransitioner.transitionScripts(page.getScripts());

    // =body=
    // clear away the old roots
    // TODO: reuseDom
    this.reactRoots.forEach((root) => root.unmount());
    this.reactRoots.splice(0, this.reactRoots.length);
    document.body.innerHTML = '';
    // write new roots
    const tokens = tokenizeElements(page.getElements());
    const rootHydrationDfds: Record<number, PromiseWithResolvers<void>> = {};
    let currentContainer: Node = document.body;
    tokens.forEach((token, i) => {
      switch (token.type) {
        case TOKEN.CONTAINER_OPEN: {
          const newContainer = document.createElement('div');
          applyContainerProps(newContainer, token.element.props);
          currentContainer.appendChild(newContainer);
          currentContainer = newContainer;
          break;
        }
        case TOKEN.CONTAINER_CLOSE:
          currentContainer = currentContainer.parentNode!;
          break;
        case TOKEN.THE_FOLD:
          // this is a no-op clientside
          break;
        case TOKEN.ROOT: {
          const newNode = document.createElement('div');
          currentContainer.appendChild(newNode);
          const newRoot = createRoot(newNode);
          this.reactRoots.push(newRoot);
          const dfd = Promise.withResolvers<void>();
          rootHydrationDfds[i] = dfd;
          scheduleRender(token.element)
            .then(rootElement => newRoot.render(rootElement))
            .then(dfd.resolve, dfd.reject);
          break;
        }
      }
    });
    await Promise.allSettled(Object.values(rootHydrationDfds).map(dfd => dfd.promise)).then(() => {
      console.log(`[verso-debug] all roots hydrated, resolving CLIENT_READY_DFD`);
      global.CLIENT_READY_DFD!.resolve();
    });
    cleanupPreviousStyles();
  }

  private async getRoutedPageChain(url: URL, method: string): Promise<{ page: StandardizedPage, routeName: string }> {
    const urlString = url.pathname + url.search;
    const route = this.router.matchRoute(urlString, method);
    if (!route) {
      throw new Error(`[verso] no route for ${url}`);
    }
    const loader = this.pageLoaders[route.routeName];
    if (!loader) {
      throw new Error(`[verso] no page loader for route ${route.routeName}`);
    }
    const pageDef = (await loader()).default;
    if (pageDef.type !== 'page') {
      throw new Error(`[verso] cannot navigate to handler of type ${pageDef.type}`);
    }
    const config = new ResponderConfig();
    const req = VersoRequest.clientInit(urlString, route.params);
    const ctx = createCtx(config, req, route);
    return {
      page: createHandlerChain('page', pageDef, this.site.middleware ?? [], config, ctx),
      routeName: route.routeName,
    };
  }
}

