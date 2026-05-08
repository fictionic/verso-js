import {getLinkTagAttrs, getMetaTagAttrs, setNodeAttrs, type MetaTag, type StandardizedPage} from "../common/handler/Page";
import {createRoot, hydrateRoot, type Root} from "react-dom/client";
import {TOKEN, tokenizeElements} from "../common/elementTokenizer";
import {scheduleRender} from "../common/components/Root";
import { global } from './global';
import {PAGE_ELEMENT_TOKEN_ID_ATTR, PAGE_HEADER_LINK_ELEMENT_ATTR, PAGE_ROOT_ELEMENT_ATTR} from "../common/constants";
import {FETCH_CACHE_KEY, FN_ABORT_HYDRATION, FN_HYDRATE_ROOTS_UP_TO, FN_RECEIVE_LATE_DATA_ARRIVAL, VersoPipe} from "../common/VersoPipe";
import {Fetch} from "../common/fetch/Fetch";
import {startClientRequest} from "../common/RequestLocalStorage";
import {applyContainerProps} from "../common/components/RootContainer";
import {StyleTransitioner} from "./styles";
import { ScriptTransitioner } from "./scripts";
import type {BundleManifest} from "../../build/bundle";
import {HistoryManager, type NavigationDirection} from "./history";
import type {ReactElement} from "react";
import {flushSync} from "react-dom";
import type {Navigator} from "../common/navigator";

let self: ClientController | null = null;
export function getClientController(): ClientController {
  if (!self) {
    throw new Error('ClientController not initialized!');
  }
  return self;
}

global.CLIENT_READY_DFD = Promise.withResolvers<void>();

export interface NavigateOptions {
  // TODO: reuseDom
}

type ClientNavigationResult = { page: StandardizedPage, routeName: string };

export class ClientController {
  private navigator: Navigator;
  private reactRoots: Root[];
  private styleTransitioner: StyleTransitioner;
  private scriptTransitioner: ScriptTransitioner;
  private historyManager: HistoryManager;

  constructor(navigator: Navigator, manifest: BundleManifest | null) {
    this.navigator = navigator;
    this.reactRoots = [];
    this.styleTransitioner = new StyleTransitioner(manifest);
    this.scriptTransitioner = new ScriptTransitioner();
    this.historyManager = new HistoryManager((url, options) => this.navigate(url, 'POP', options));
    self = this;
    global.__versoController = this; // for playwright tests
  }

  async hydrate() {
    startClientRequest();
    this.styleTransitioner.readServerStyles();
    this.scriptTransitioner.readServerScripts();
    const readablePipe = VersoPipe.reader();
    const fetchCache = (readablePipe.readValue(FETCH_CACHE_KEY) ?? {});
    Fetch.clientInit();
    Fetch.getCache().client().rehydrate(fetchCache);

    const req = new Request(window.location.href, {
      method: 'GET', // TODO: pipe down server http method, in case pages are wired up to POST or something
    });
    let page: StandardizedPage;
    try {
      ({ page } = await this.handleRequest(req));
    } catch (err) {
      console.error('[verso] hydration failed', err);
      global.CLIENT_READY_DFD!.resolve();
      return;
    }

    this.historyManager.stampHistoryFrame();

    const tokens = tokenizeElements(page.getElements());

    const rootHydrationDfds: Array<PromiseWithResolvers<void>> = [];
    const rootDomNodeDfds: Array<PromiseWithResolvers<Element>> = [];

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
      this.historyManager.installListener();
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

    function abortHydration() {
      console.error("[verso] server render timed out; aborting hydration!");
      for (let i = nextRootIndex; i < rootDomNodeDfds.length; i++) {
        // note that these are sparse arrays
        rootDomNodeDfds[i]?.reject();
        rootHydrationDfds[i]?.resolve();
      }
    }

    readablePipe.onCallFn(FN_HYDRATE_ROOTS_UP_TO, hydrateRootsUpTo);
    readablePipe.onCallFn(FN_RECEIVE_LATE_DATA_ARRIVAL, Fetch.getCache().client().receiveCachedResponse);
    readablePipe.onCallFn(FN_ABORT_HYDRATION, abortHydration);
  }

  async navigate(url: string, direction: NavigationDirection, options: NavigateOptions = {}): Promise<void> {
    startClientRequest();
    global.CLIENT_READY_DFD = Promise.withResolvers();
    // TODO: clear out VersoPipe script, for tidiness
    Fetch.clientInit(); // just initiate an empty cache, since Fetch assumes it'll exist

    const req = new Request(url, { method: 'GET' });
    let response: ClientNavigationResult;
    try {
      response = await this.handleRequest(req);
    } catch (err) {
      console.error('[verso] navigation failed, staying on current page', err);
      return;
    }

    const { page, routeName } = response;

    if (direction === 'PUSH') {
      // we're committing to the new location now
      this.historyManager.pushFrame(url, options);
    }

    // =header=
    document.title = page.getTitle() ?? ''; // no way to unset title; technically sort of non-isomorphic
    // update base tag
    const base = page.getBase();
    let baseNode = document.head.querySelector('base');
    if (base === null) {
      baseNode?.parentNode?.removeChild(baseNode);
    } else {
      if (!baseNode) {
        baseNode = document.createElement('base');
        document.head.prepend(baseNode);
      }
      if (base.href) baseNode.href = base.href;
      if (base.target) baseNode.target = base.target;
    }
    // update links. can just blindly throw away old ones and add new ones
    document.querySelectorAll(`[${PAGE_HEADER_LINK_ELEMENT_ATTR}]`).forEach(node => {
      node.parentNode?.removeChild(node);
    });
    page.getLinkTags().forEach((link) => {
      const node = document.createElement('link');
      setNodeAttrs(node, getLinkTagAttrs(link));
      document.head.appendChild(node);
    });
    // update meta tags. throw away old ones and add new ones
    document.head.querySelectorAll('meta').forEach(node => node.parentNode?.removeChild(node));
    page.getMetaTags().forEach((tag) => renderMetaTag(tag));
    // update styles. have to take care to avoid FOUC
    const cleanupPreviousStyles = await this.styleTransitioner.transitionStyles(routeName, page.getStylesheets());
    // update scripts. track each one and only add new ones
    this.scriptTransitioner.transitionScripts(page.getScripts());

    // =body=
    const newBodyClasses = await page.getBodyClasses();
    document.body.className = newBodyClasses.join(' ');
    // clear away the old roots
    // TODO: reuseDom
    this.reactRoots.forEach((root) => root.unmount());
    this.reactRoots.splice(0, this.reactRoots.length);
    document.body.innerHTML = '';
    // write new roots
    const tokens = tokenizeElements(page.getElements());
    // we need them to be mounted in the correct order.
    // kick off scheduleRender right away, but don't mount a root
    // until all previous roots have mounted
    type PendingRoot = { renderPromise: Promise<ReactElement>, reactRoot: Root };
    const pendingRoots: PendingRoot[] = [];
    let currentContainer: Node = document.body;
    tokens.forEach((token) => {
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
          const reactRoot = createRoot(newNode);
          this.reactRoots.push(reactRoot);
          const renderPromise = scheduleRender(token.element);
          pendingRoots.push({ renderPromise, reactRoot });
          break;
        }
      }
    });

    await pendingRoots.reduce(async (previous: Promise<void>, { renderPromise, reactRoot }) => {
      await previous;
      const rootElement = await renderPromise
      return flushSync(() => reactRoot.render(rootElement));
      // without flushSync, the concurrent scheduler could mount roots out of order (I think)
    }, Promise.resolve());

    console.log(`[verso-debug] all roots hydrated, resolving CLIENT_READY_DFD`);
    global.CLIENT_READY_DFD!.resolve();

    cleanupPreviousStyles();
  }

  async handleRequest(req: Request): Promise<ClientNavigationResult> {
    const navigation = await this.navigator.navigate(req);
    if (navigation.kind !== 'directive') throw new Error('navigation failed; aborting');
    const { routeName, location, handler } = navigation;
    if (location) {
      // not sure why this would happen.
      // react-server does a client transition in this case, but I think it makes more sense
      // to just hand it over to the browser. no guarantee the redirect location is even served
      // by us
      window.location.href = location;
    }
    if (!handler) {
      throw new Error('navigator returned success but with no page handler. did you forget to set hasDocument?');
    }
    if (handler.type !== 'page') {
      throw new Error(`client-side navigation only supports page handlers, got ${handler.type}`);
    }
    return { page: handler, routeName };
  }
}

function renderMetaTag(tag: MetaTag) {
  const meta = document.createElement('meta');
  for (const [k, v] of Object.entries(getMetaTagAttrs(tag))) {
    meta.setAttribute(k, v);
  }
  if (tag.noscript) {
    const noscript = document.createElement('noscript');
    noscript.appendChild(meta);
    document.head.appendChild(noscript);
  } else {
    document.head.appendChild(meta);
  }
}
