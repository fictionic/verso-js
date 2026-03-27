var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/sluice/config.ts
function resolveOutDir(config) {
  return config.build?.outDir ?? DEFAULT_OUT_DIR;
}
var DEFAULT_OUT_DIR;
var init_config = __esm({
  "src/sluice/config.ts"() {
    "use strict";
    DEFAULT_OUT_DIR = "dist";
  }
});

// src/sluice/viteBundler.ts
import path from "node:path";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "vite";
async function bundle(siteConfigModulePath) {
  await mkdir(BUNDLES_DIR, { recursive: true });
  const site = (await import(siteConfigModulePath)).default;
  const rootDir = path.dirname(siteConfigModulePath);
  const handlersByRoute = {};
  const input = {};
  await Promise.all(Object.entries(site.routes).map(async ([routeName, routeConfig]) => {
    const handler = (await import(path.resolve(rootDir, routeConfig.handler))).default;
    handlersByRoute[routeName] = handler;
    if (handler.type === "page") {
      const entrypointPath = path.resolve(BUNDLES_DIR, `route-${routeName}.js`);
      await writeFile(entrypointPath, makeEntrypoint(routeConfig.handler, routeConfig.path, rootDir, siteConfigModulePath));
      input[routeName] = entrypointPath;
    }
  }));
  try {
    const result = await build({
      configFile: false,
      root: process.cwd(),
      logLevel: "warn",
      resolve: {
        alias: {
          "@": path.resolve(process.cwd(), "src")
        }
      },
      define: {
        IS_CLIENT: "true"
      },
      build: {
        write: false,
        minify: false,
        rolldownOptions: {
          input,
          output: {
            format: "es",
            entryFileNames: "bundles/[name]-[hash].js",
            chunkFileNames: "bundles/[name]-[hash].js",
            assetFileNames: "bundles/[name]-[hash][extname]"
          }
        }
      }
    });
    const output = Array.isArray(result) ? result[0] : result;
    if (!("output" in output)) {
      throw new Error("Vite build returned unexpected result");
    }
    const manifest = {};
    const bundleContents = {};
    for (const item of output.output) {
      if (item.type === "chunk") {
        bundleContents[item.fileName] = item.code;
      } else if (item.type === "asset") {
        bundleContents[item.fileName] = typeof item.source === "string" ? item.source : new TextDecoder().decode(item.source);
      }
    }
    for (const item of output.output) {
      if (item.type === "chunk" && item.isEntry) {
        manifest[item.name] = {
          scripts: [...item.imports, item.fileName],
          stylesheets: [...item.viteMetadata?.importedCss ?? []]
        };
      }
    }
    return { manifest, bundleContents, handlersByRoute };
  } finally {
    await rm(BUNDLES_DIR, { recursive: true }).catch(() => {
    });
  }
}
function makeEntrypoint(handler, routePath, routesDir, siteConfigPath) {
  const q = (s) => JSON.stringify(s);
  const absolutePagePath = path.resolve(routesDir, handler);
  const bootstrapPath = path.resolve(__dirname, "client/bootstrap.ts");
  return `import siteConfig from ${q(siteConfigPath)};
import Page from ${q(absolutePagePath)};
import { bootstrap } from ${q(bootstrapPath)};
bootstrap(Page, ${q(routePath)}, siteConfig.middleware ?? []);`;
}
var BUNDLES_DIR, __dirname;
var init_viteBundler = __esm({
  "src/sluice/viteBundler.ts"() {
    "use strict";
    BUNDLES_DIR = "bundles";
    __dirname = path.dirname(fileURLToPath(import.meta.url));
  }
});

// src/sluice/cli/build.ts
var build_exports = {};
__export(build_exports, {
  runBuild: () => runBuild
});
import path2 from "node:path";
import { writeFile as writeFile2, mkdir as mkdir2 } from "node:fs/promises";
async function runBuild(config) {
  const routesPath = path2.resolve(process.cwd(), config.routes);
  const outDir = resolveOutDir(config);
  console.log("[sluice] Building...");
  const result = await bundle(routesPath);
  await mkdir2(path2.resolve(outDir, "bundles"), { recursive: true });
  await Promise.all(
    Object.entries(result.bundleContents).map(
      ([bundlePath, contents]) => writeFile2(path2.resolve(outDir, bundlePath), contents)
    )
  );
  await writeFile2(
    path2.resolve(outDir, "manifest.json"),
    JSON.stringify(result.manifest, null, 2)
  );
  console.log(`[sluice] Build complete \u2192 ${outDir}/`);
}
var init_build = __esm({
  "src/sluice/cli/build.ts"() {
    "use strict";
    init_config();
    init_viteBundler();
  }
});

// src/sluice/util/array.ts
function ensureArray(t) {
  return Array.isArray(t) ? t : [t];
}
var init_array = __esm({
  "src/sluice/util/array.ts"() {
    "use strict";
  }
});

// src/sluice/server/router.ts
import { match } from "path-to-regexp";
function createRouter(routes) {
  const compiled = Object.entries(routes).map(([routeName, routeConfig]) => {
    const { path: path5, handler, method } = routeConfig;
    const methods = !!method ? ensureArray(method) : ["GET"];
    return {
      routeName,
      matchFn: match(path5),
      methods,
      handler
    };
  });
  return {
    matchRoute: (path5, method) => {
      for (const { routeName, matchFn, methods, handler } of compiled) {
        if (!methods.includes(method.toUpperCase())) {
          continue;
        }
        const result = matchFn(path5);
        if (result) {
          return {
            routeName,
            params: result.params,
            method,
            handler
          };
        }
      }
      return null;
    }
  };
}
var init_router = __esm({
  "src/sluice/server/router.ts"() {
    "use strict";
    init_array();
  }
});

// src/sluice/env.ts
function isServer() {
  return _isServer;
}
var _isServer;
var init_env = __esm({
  "src/sluice/env.ts"() {
    "use strict";
    _isServer = typeof IS_CLIENT === "undefined" || !IS_CLIENT;
  }
});

// src/sluice/util/requestLocal.ts
function getStore() {
  return als?.getStore() ?? fallback;
}
function startRequest(fn) {
  if (!als) throw new Error("startRequest requires a server environment");
  return als.run(/* @__PURE__ */ new Map(), fn);
}
function getNamespace() {
  const key = /* @__PURE__ */ Symbol();
  return () => {
    const store = getStore();
    if (!store.has(key)) store.set(key, {});
    return store.get(key);
  };
}
var fallback, als;
var init_requestLocal = __esm({
  "src/sluice/util/requestLocal.ts"() {
    "use strict";
    init_env();
    fallback = /* @__PURE__ */ new Map();
    als = null;
    if (isServer()) {
      const { AsyncLocalStorage } = __require("node:async_hooks");
      als = new AsyncLocalStorage();
    }
  }
});

// src/sluice/server/ServerCookies.ts
import { parse, stringifySetCookie } from "cookie";
var RLS, ServerCookies;
var init_ServerCookies = __esm({
  "src/sluice/server/ServerCookies.ts"() {
    "use strict";
    init_requestLocal();
    RLS = getNamespace();
    ServerCookies = class {
      requestCookies;
      responseCookies;
      headersLocked;
      constructor(req) {
        this.requestCookies = parse(req.headers.get("cookie") ?? "");
        this.responseCookies = /* @__PURE__ */ new Map();
        this.headersLocked = false;
        RLS().current = this;
      }
      getRequestCookie(name) {
        return this.requestCookies[name] ?? void 0;
      }
      setResponseCookie(name, value, options) {
        if (this.headersLocked) {
          throw new Error("cannot set cookies after HTTP headers have been sent");
        }
        this.responseCookies.set(name, { value, options });
      }
      getResponseCookie(name) {
        return this.responseCookies.get(name)?.value;
      }
      consumeHeaders() {
        this.headersLocked = true;
        const headers = new Headers();
        this.responseCookies.forEach(({ value, options }, name) => {
          headers.append("Set-Cookie", stringifySetCookie({ name, value, ...options }));
        });
        return headers;
      }
      static get() {
        return RLS().current;
      }
    };
  }
});

// src/sluice/core/fetch/cache.ts
var FetchCache;
var init_cache = __esm({
  "src/sluice/core/fetch/cache.ts"() {
    "use strict";
    FetchCache = class {
      data;
      // serializable data to be transported
      pending;
      constructor() {
        this.data = {};
        this.pending = {};
      }
      server() {
        const cache = this;
        return {
          receiveRequest(url) {
            let first = true;
            if (!cache.data[url]) {
              cache.data[url] = {
                response: null,
                errorMessage: null,
                requesters: 1
              };
              cache.pending[url] = Promise.withResolvers();
            } else {
              first = false;
              cache.data[url].requesters += 1;
            }
            return {
              first,
              promise: cache.pending[url].promise
            };
          },
          async receiveResponse(url, response) {
            if (!cache.data[url] || !cache.pending[url]) {
              console.error(`no cache entry for url ${url}`);
              return Promise.reject();
            }
            const text = await response.text();
            const cachedResponse = {
              text,
              status: response.status,
              headers: [...response.headers.entries()]
            };
            cache.data[url].response = cachedResponse;
            cache.pending[url].resolve(cachedResponse);
          },
          receiveError(url, error) {
            if (!cache.data[url] || !cache.pending[url]) {
              const e = new Error(`no cache entry for url ${url}`);
              console.error(e);
              return Promise.reject(e);
            }
            cache.pending[url].reject(error);
            cache.data[url].errorMessage = error.message;
          },
          dehydrate() {
            return cache.data;
          },
          getPending() {
            return Object.entries(cache.pending).filter(([url]) => {
              const data = cache.data[url];
              if (!data) {
                console.error(`no cache entry for url ${url}`);
                return false;
              }
              return !data.response && !data.errorMessage;
            }).map(([url, dfd]) => ({
              url,
              promise: dfd.promise
            }));
          }
        };
      }
      client() {
        const cache = this;
        return {
          rehydrate(data) {
            Object.entries(data).forEach(([url, entry]) => {
              cache.data[url] = entry;
              cache.pending[url] = Promise.withResolvers();
              if (entry.response) {
                cache.pending[url].resolve(entry.response);
              } else if (entry.errorMessage) {
                cache.pending[url].reject(new Error(entry.errorMessage));
              }
            });
          },
          receiveRequest(url) {
            return cache.pending[url]?.promise ?? null;
          },
          receiveCachedResponse(url, response) {
            if (!cache.data[url] || !cache.pending[url]) {
              console.error(`no cache entry for url ${url}`);
              return;
            }
            cache.data[url].response = response;
            cache.pending[url].resolve(response);
          },
          consumeResponse(url) {
            const entry = cache.data[url];
            if (!entry) {
              console.error(`no cache entry for url ${url}`);
              return;
            }
            entry.requesters -= 1;
            if (entry.requesters <= 0) {
              delete cache.data[url];
              delete cache.pending[url];
            }
          }
        };
      }
    };
  }
});

// src/sluice/core/fetch/nativeFetch.ts
var nativeFetch;
var init_nativeFetch = __esm({
  "src/sluice/core/fetch/nativeFetch.ts"() {
    "use strict";
    nativeFetch = globalThis.fetch;
  }
});

// src/sluice/core/fetch/Fetch.ts
function serverInit(urlPrefix) {
  RLS2().urlPrefix = urlPrefix;
  RLS2().cache = new FetchCache();
}
function clientInit() {
  RLS2().cache = new FetchCache();
}
function getCache() {
  return RLS2().cache;
}
function fetch(url, init) {
  const method = (init?.method ?? "GET").toUpperCase();
  const doNativeFetch = () => nativeFetch(resolveUrl(url), init);
  if (method !== "GET") {
    return doNativeFetch();
  }
  if (isServer()) {
    const cache = getCache().server();
    const { first, promise } = cache.receiveRequest(url);
    if (first) {
      doNativeFetch().then((res) => {
        cache.receiveResponse(url, res);
      }, (error) => {
        cache.receiveError(url, error);
      });
    }
    return promise.then(reifyCachedResponse);
  } else {
    const cache = getCache().client();
    const responsePromise = cache.receiveRequest(url);
    if (responsePromise) {
      return responsePromise.then((cachedResponse) => {
        cache.consumeResponse(url);
        return reifyCachedResponse(cachedResponse);
      }, (message) => {
        cache.consumeResponse(url);
        throw new Error(message);
      });
    } else {
      return doNativeFetch();
    }
  }
}
function resolveUrl(url) {
  if (url.startsWith("/")) {
    const prefix = RLS2().urlPrefix ?? "";
    return prefix ? prefix + url : url;
  }
  return url;
}
function reifyCachedResponse(r) {
  return new Response(r.text, {
    status: r.status
    // headers: r.headers, // TODO will anyone want response headers? they're big to serialize
  });
}
var RLS2, Fetch;
var init_Fetch = __esm({
  "src/sluice/core/fetch/Fetch.ts"() {
    "use strict";
    init_env();
    init_requestLocal();
    init_cache();
    init_nativeFetch();
    RLS2 = getNamespace();
    Fetch = {
      serverInit,
      clientInit,
      getCache,
      fetch
    };
  }
});

// src/sluice/core/handler/ResponderConfig.ts
var RLS3, ResponderConfig;
var init_ResponderConfig = __esm({
  "src/sluice/core/handler/ResponderConfig.ts"() {
    "use strict";
    init_requestLocal();
    RLS3 = getNamespace();
    ResponderConfig = class {
      config = {};
      constructor() {
        RLS3().current = this;
      }
      addValues(config) {
        this.config = {
          ...this.config,
          ...config
        };
      }
      setValues(config) {
        const unknownKeys = Object.keys(config).filter((k) => !(k in this.config));
        if (unknownKeys.length > 0) {
          throw new Error(`Refusing to set uninitiated config key ${unknownKeys[0]}`);
        }
        this.addValues(config);
      }
      getValue(key) {
        return this.config[key];
      }
    };
  }
});

// src/sluice/core/handler/chain.ts
function createHandlerChain(type, def, globalMiddleware, config, ctx) {
  const handler = def.init(ctx);
  const baseMiddleware = [...globalMiddleware, ...handler.middleware ?? []];
  const allMiddleware = recursivelyExpandMiddleware(baseMiddleware, ctx, type);
  allMiddleware.forEach((m) => {
    const addValues = m.addConfigValues?.();
    if (addValues) {
      config.addValues(addValues);
    }
  });
  [...allMiddleware, handler].forEach((r) => {
    const setValues = r.setConfigValues?.();
    if (setValues) {
      config.setValues(setValues);
    }
  });
  const base = def.standardize(handler);
  return allMiddleware.reduceRight((chain, link) => {
    const result = { ...chain };
    for (const methodName of Object.keys(base)) {
      const current = link[methodName];
      if (current) {
        const next = chain[methodName];
        result[methodName] = current.bind(null, next);
      }
    }
    return result;
  }, base);
}
function recursivelyExpandMiddleware(middlewareDefs, ctx, handlerType) {
  if (middlewareDefs.length === 0) {
    return [];
  }
  return middlewareDefs.filter((def) => def.scope === "all" || def.scope === handlerType).flatMap((def) => {
    const m = def.init(ctx);
    const children = recursivelyExpandMiddleware(m.middleware ?? [], ctx, handlerType);
    return [...children, m];
  });
}
var init_chain = __esm({
  "src/sluice/core/handler/chain.ts"() {
    "use strict";
  }
});

// src/sluice/util/ServerClientPipe.ts
function serialize(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}
var PIPE_READER_INIT, createPipe;
var init_ServerClientPipe = __esm({
  "src/sluice/util/ServerClientPipe.ts"() {
    "use strict";
    PIPE_READER_INIT = `{
  data: {},
  fns: {
    pending: {},
    handlers: {},
    call(name, args) {
      if (this.handlers[name]) this.handlers[name](...args);
      else (this.pending[name] = this.pending[name] || []).push(args);
    }
  }
}`;
    createPipe = (pipeName) => ({
      writer(write) {
        write(`<script>window.${pipeName} = ${PIPE_READER_INIT};</script>`);
        return {
          writeValue: (key, value) => {
            write(`<script>window.${pipeName}.data['${key}'] = ${serialize(value)}</script>`);
          },
          callFn: (fnName, args) => {
            write(`<script>window.${pipeName}.fns.call('${fnName}', ${serialize(args)})</script>`);
          }
        };
      },
      reader() {
        if (typeof window === "undefined") {
          throw new Error("cannot read from SluicePipe on the server");
        }
        const pipe = window[pipeName];
        return {
          readValue: (key) => {
            return pipe.data[key];
          },
          replaceValue: (key, value) => {
            pipe.data[key] = value;
          },
          onCallFn: (fnName, callback) => {
            if (pipe.fns.pending[fnName]) {
              pipe.fns.pending[fnName].forEach((args) => {
                callback(...args);
              });
              delete pipe.fns.pending[fnName];
            }
            pipe.fns.handlers[fnName] = callback;
          },
          _impl: pipe
          // for unit tests
        };
      }
    });
  }
});

// src/sluice/core/SluicePipe.ts
var SLUICE_PIPE_NAME, FETCH_CACHE_KEY, FN_HYDRATE_ROOTS_UP_TO, FN_RECEIVE_LATE_DATA_ARRIVAL, SluicePipe;
var init_SluicePipe = __esm({
  "src/sluice/core/SluicePipe.ts"() {
    "use strict";
    init_ServerClientPipe();
    SLUICE_PIPE_NAME = "__sluicePipe";
    FETCH_CACHE_KEY = "fetchCache";
    FN_HYDRATE_ROOTS_UP_TO = "hydrateRootsUpTo";
    FN_RECEIVE_LATE_DATA_ARRIVAL = "receiveLateDataArrival";
    SluicePipe = createPipe(SLUICE_PIPE_NAME);
  }
});

// src/sluice/core/components/Root.tsx
import React from "react";
import { jsx } from "react/jsx-runtime";
function makeRootComponent(Component, deriveRootAPI = (p) => p) {
  return Object.assign(
    (props) => /* @__PURE__ */ jsx(Component, { ...props }),
    { [ROOT_COMPONENT]: { deriveRootAPI } }
  );
}
function isRootElement(element) {
  return React.isValidElement(element) && typeof element.type === "function" && ROOT_COMPONENT in element.type;
}
function ensureRootElement(element) {
  return isRootElement(element) ? element : /* @__PURE__ */ jsx(Root, { children: element });
}
function scheduleRender(element) {
  const { deriveRootAPI } = element.type[ROOT_COMPONENT];
  const { when } = deriveRootAPI(element.props);
  const ready = when ?? Promise.resolve();
  return ready.then((result) => {
    const props = {
      ...element.props,
      ...result
    };
    return React.cloneElement(element, props);
  });
}
var ROOT_COMPONENT, Passthrough, Root;
var init_Root = __esm({
  "src/sluice/core/components/Root.tsx"() {
    "use strict";
    ROOT_COMPONENT = /* @__PURE__ */ Symbol("sluice.RootComponent");
    Passthrough = ({ children }) => children;
    Root = makeRootComponent(Passthrough);
  }
});

// src/sluice/constants.ts
var PAGE_ROOT_ELEMENT_ATTR, PAGE_ELEMENT_TOKEN_ID_ATTR;
var init_constants = __esm({
  "src/sluice/constants.ts"() {
    "use strict";
    PAGE_ROOT_ELEMENT_ATTR = "data-sluice-root";
    PAGE_ELEMENT_TOKEN_ID_ATTR = "data-sluice-page-element-token-id";
  }
});

// src/sluice/core/components/RootContainer.tsx
import "react";
import { renderToString } from "react-dom/server";
import { jsx as jsx2 } from "react/jsx-runtime";
function RootContainer(_) {
  throw new Error("RootContainers cannot go inside non-RootContainers");
}
function renderContainerOpen(element, index) {
  const { children, ...attrs } = element.props;
  const html = renderToString(/* @__PURE__ */ jsx2("div", { ...{ [PAGE_ELEMENT_TOKEN_ID_ATTR]: String(index) }, ...attrs }));
  return html.slice(0, -DIV_CLOSE.length) + "\n";
}
function renderContainerClose() {
  return `${DIV_CLOSE}
`;
}
var DIV_CLOSE;
var init_RootContainer = __esm({
  "src/sluice/core/components/RootContainer.tsx"() {
    "use strict";
    init_constants();
    DIV_CLOSE = "</div>";
  }
});

// src/sluice/core/components/TheFold.tsx
function TheFold() {
  throw new Error("TheFold cannot go inside non-RootContainers");
}
var init_TheFold = __esm({
  "src/sluice/core/components/TheFold.tsx"() {
    "use strict";
  }
});

// src/sluice/core/elementTokenizer.ts
import React3 from "react";
function tokenizeElements(elements) {
  return elements.flatMap((element) => {
    if (isRootContainer(element)) {
      return tokenizeContainer(element);
    }
    if (isTheFold(element)) {
      return [{ type: TOKEN.THE_FOLD }];
    }
    return [{
      type: TOKEN.ROOT,
      element: ensureRootElement(element)
    }];
  });
}
function isTheFold(element) {
  return React3.isValidElement(element) && element.type === TheFold;
}
function isRootContainer(element) {
  return React3.isValidElement(element) && element?.type === RootContainer;
}
function tokenizeContainer(element) {
  const open = { type: TOKEN.CONTAINER_OPEN, element };
  const childArray = React3.Children.toArray(element.props.children);
  const tokenizedChildren = tokenizeElements(childArray);
  const close = { type: TOKEN.CONTAINER_CLOSE };
  return [open, ...tokenizedChildren, close];
}
var TOKEN;
var init_elementTokenizer = __esm({
  "src/sluice/core/elementTokenizer.ts"() {
    "use strict";
    init_RootContainer();
    init_TheFold();
    init_Root();
    TOKEN = {
      ROOT: "ROOT",
      THE_FOLD: "THE_FOLD",
      CONTAINER_OPEN: "CONTAINER_OPEN",
      CONTAINER_CLOSE: "CONTAINER_CLOSE"
    };
  }
});

// src/sluice/server/writeBody.ts
import { renderToString as renderToString2 } from "react-dom/server";
async function writeBody(page, write, onRoot, onTheFold, abort) {
  const elements = page.getElements();
  const tokens = tokenizeElements(elements);
  const queue = new RenderedTokenQueue();
  const rootPromises = [];
  tokens.forEach((token, i) => {
    const rendered = {
      token,
      status: TOKEN_STATUS.PENDING,
      html: null
    };
    switch (token.type) {
      case TOKEN.CONTAINER_OPEN:
        rendered.status = TOKEN_STATUS.RENDERED;
        rendered.html = renderContainerOpen(token.element, i);
        break;
      case TOKEN.CONTAINER_CLOSE:
        rendered.status = TOKEN_STATUS.RENDERED;
        rendered.html = renderContainerClose();
        break;
      case TOKEN.THE_FOLD:
        rendered.status = TOKEN_STATUS.RENDERED;
        break;
      case TOKEN.ROOT:
        rootPromises.push(scheduleRender(token.element).then((resolved) => {
          let rootInnerHTML;
          try {
            rootInnerHTML = renderToString2(resolved);
          } catch (err) {
            console.error(`[renderBody] renderToString failed for element ${i}; rendering empty div`, err);
            rootInnerHTML = "";
          }
          rendered.html = `<div ${PAGE_ELEMENT_TOKEN_ID_ATTR}="${i}" ${PAGE_ROOT_ELEMENT_ATTR}>${rootInnerHTML}</div>
`;
          rendered.status = TOKEN_STATUS.RENDERED;
          writeRenderedTokens();
        }));
        break;
      default:
        token;
    }
    queue.add(rendered);
  });
  writeRenderedTokens();
  function writeRenderedTokens() {
    let buffer = "";
    let foundRoot = false;
    while (queue.hasNext()) {
      let [i, renderedToken] = queue.current();
      if (renderedToken.status === TOKEN_STATUS.PENDING) {
        break;
      } else {
        if (renderedToken.status === TOKEN_STATUS.WRITTEN) {
          console.error("[renderBody] elements rendering out of order!");
        } else if (renderedToken.status === TOKEN_STATUS.TIMEOUT) {
        } else if (renderedToken.status === TOKEN_STATUS.RENDERED) {
          if (renderedToken.token.type === TOKEN.THE_FOLD) {
            onTheFold(i);
            renderedToken.status = TOKEN_STATUS.WRITTEN;
          }
          if (renderedToken.html) {
            buffer += renderedToken.html;
            renderedToken.status = TOKEN_STATUS.WRITTEN;
            renderedToken.html = null;
            if (renderedToken.token.type === TOKEN.ROOT) {
              foundRoot = true;
            }
          }
        } else {
          renderedToken.status;
        }
        queue.consume();
      }
    }
    if (buffer.length > 0) {
      write(buffer);
      if (foundRoot) {
        onRoot(queue.lastConsumedIndex());
      }
    }
  }
  ;
  abort.addEventListener("abort", () => {
    queue.abort();
    writeRenderedTokens();
  });
  await Promise.race([
    Promise.all(rootPromises),
    new Promise((resolve) => abort.addEventListener("abort", () => resolve()))
  ]);
}
var TOKEN_STATUS, RenderedTokenQueue;
var init_writeBody = __esm({
  "src/sluice/server/writeBody.ts"() {
    "use strict";
    init_Root();
    init_elementTokenizer();
    init_RootContainer();
    init_constants();
    TOKEN_STATUS = {
      PENDING: "PENDING",
      RENDERED: "RENDERED",
      TIMEOUT: "TIMEOUT",
      WRITTEN: "WRITTEN"
    };
    RenderedTokenQueue = class {
      index;
      array;
      constructor() {
        this.index = 0;
        this.array = [];
      }
      add(t) {
        this.array.push(t);
      }
      current() {
        return [this.index, this.array[this.index]];
      }
      hasNext() {
        return this.index < this.array.length;
      }
      consume() {
        this.index++;
      }
      lastConsumedIndex() {
        return this.index - 1;
      }
      abort() {
        for (let i = this.index; i < this.array.length; i++) {
          const t = this.array[i];
          if (t.status === TOKEN_STATUS.PENDING) {
            t.status = TOKEN_STATUS.TIMEOUT;
          }
        }
      }
    };
  }
});

// src/sluice/server/writeHeader.ts
function writeHeader(page, stylesheets, write) {
  write(`<title>${page.getTitle()}</title>`);
  write(`${renderStylesheets(page.getHeadStylesheets())}`);
  stylesheets.forEach((href) => {
    write(`<link rel="stylesheet" href="${href}">`);
  });
}
function renderStylesheets(stylesheets) {
  return stylesheets.map((s) => {
    if ("href" in s) {
      return `<link rel="stylesheet" href="${s.href}">`;
    }
    const type = s.type ?? "text/css";
    const media = s.media ?? "";
    const mediaAttr = media ? ` media="${media}"` : "";
    return `<style type="${type}"${mediaAttr}>${s.text}</style>`;
  }).join("\n");
}
var init_writeHeader = __esm({
  "src/sluice/server/writeHeader.ts"() {
    "use strict";
  }
});

// src/sluice/server/stream.ts
function makeStreamer(page, { renderTimeout, routeAssets }) {
  const { readable, writable } = new TransformStream();
  function stream() {
    writePage().catch((err) => {
      console.error("unexpected error writing page", err);
      writable.close();
    });
    return readable;
  }
  const writer = writable.getWriter();
  const { write, flush } = buffered(writer);
  const writeablePipe = SluicePipe.writer(write);
  const lateArrivalsDfd = Promise.withResolvers();
  async function writePage() {
    write(`<!DOCTYPE html><html lang="en"><head>`);
    writeHeader(page, routeAssets.stylesheets, write);
    write(`</head><body>`);
    flush();
    let haveBootstrapped = false;
    let lastRootIndex = 0;
    const onRoot = (index) => {
      if (haveBootstrapped) {
        hydrateRootsUpTo(index);
        flush();
      }
      lastRootIndex = index;
    };
    const onTheFold = (index) => {
      if (haveBootstrapped) {
        console.warn(`writePage: unexpected additional TheFold at index ${index}`);
        return;
      }
      bootstrapClient(index);
      lateArrivalsDfd.resolve(setupLateArrivals());
      haveBootstrapped = true;
    };
    const abort = AbortSignal.timeout(renderTimeout);
    await writeBody(page, write, onRoot, onTheFold, abort);
    if (!haveBootstrapped) {
      onTheFold(lastRootIndex + 1);
    }
    finish();
  }
  ;
  function hydrateRootsUpTo(index) {
    writeablePipe.callFn(FN_HYDRATE_ROOTS_UP_TO, [index]);
  }
  function bootstrapClient(theFoldIndex) {
    const fetchCache = Fetch.getCache().server().dehydrate();
    console.log("[handlePage:debug] dehydrated cache keys:", Object.keys(fetchCache), "entries:", Object.entries(fetchCache).map(([k, v]) => `${k}: response=${!!v.response}, requesters=${v.requesters}`));
    writeablePipe.writeValue(FETCH_CACHE_KEY, fetchCache);
    routeAssets.scripts.forEach((scriptBundleUrl) => {
      write(`<script async type="module" src="${scriptBundleUrl}"></script>
`);
    });
    hydrateRootsUpTo(theFoldIndex - 1);
    flush();
  }
  function setupLateArrivals() {
    const pending = Fetch.getCache().server().getPending();
    if (pending.length === 0) return Promise.resolve();
    return Promise.allSettled(
      pending.map(({ url, promise }) => {
        return promise.then((response) => {
          writeablePipe.callFn(FN_RECEIVE_LATE_DATA_ARRIVAL, [url, response]);
          flush();
        });
      })
    ).then(() => {
    });
  }
  async function finish() {
    await lateArrivalsDfd.promise;
    write("</body></html>");
    flush();
    writer.close();
  }
  return {
    stream
  };
}
function buffered(writer) {
  let writeBuffer = "";
  function write(chunk) {
    writeBuffer += chunk;
  }
  function flush() {
    if (writeBuffer.length === 0) return;
    writer.write(encoder.encode(writeBuffer));
    writeBuffer = "";
  }
  return { write, flush };
}
var encoder;
var init_stream = __esm({
  "src/sluice/server/stream.ts"() {
    "use strict";
    init_Fetch();
    init_SluicePipe();
    init_writeBody();
    init_writeHeader();
    encoder = new TextEncoder();
  }
});

// src/sluice/server/handlePage.ts
async function handlePage(page, {
  routeAssets,
  renderTimeout = RENDER_TIMEOUT_MS
}) {
  const streamer = makeStreamer(page, { renderTimeout, routeAssets });
  const readable = streamer.stream();
  return readable;
}
var RENDER_TIMEOUT_MS;
var init_handlePage = __esm({
  "src/sluice/server/handlePage.ts"() {
    "use strict";
    init_stream();
    RENDER_TIMEOUT_MS = 2e4;
  }
});

// src/sluice/server/handleEndpoint.ts
async function handleEndpoint(endpoint) {
  const data = await endpoint.getResponseData();
  return data;
}
var init_handleEndpoint = __esm({
  "src/sluice/server/handleEndpoint.ts"() {
    "use strict";
  }
});

// src/sluice/core/SluiceRequest.ts
var SluiceRequest;
var init_SluiceRequest = __esm({
  "src/sluice/core/SluiceRequest.ts"() {
    "use strict";
    SluiceRequest = class _SluiceRequest {
      url;
      routeParams;
      static server(req, params) {
        const url = new URL(req.url);
        return new _SluiceRequest(url, params);
      }
      static client(params) {
        const url = new URL(window.location.href);
        return new _SluiceRequest(url, params);
      }
      constructor(url, params) {
        this.url = url;
        this.routeParams = params;
      }
      getParams() {
        return this.routeParams;
      }
      getURL() {
        return this.url;
      }
      getPath() {
        return this.url.pathname;
      }
      getQuery() {
        return this.url.searchParams;
      }
    };
  }
});

// src/sluice/core/handler/RouteHandlerCtx.ts
function createCtx(config, sluiceRequest) {
  return {
    getConfig: config.getValue,
    getRequest: () => sluiceRequest
  };
}
var init_RouteHandlerCtx = __esm({
  "src/sluice/core/handler/RouteHandlerCtx.ts"() {
    "use strict";
  }
});

// src/sluice/server/handleRoute.ts
async function handleRoute(type, nativeRequest, def, routeParams, globalMiddleware, options) {
  const response = await startRequest(async () => {
    const req = SluiceRequest.server(nativeRequest, routeParams);
    const cookies = new ServerCookies(nativeRequest);
    Fetch.serverInit(options.urlPrefix ?? new URL(nativeRequest.url).origin);
    const config = new ResponderConfig();
    const ctx = createCtx(config, req);
    const handler = createHandlerChain(type, def, globalMiddleware, config, ctx);
    let statusCode;
    try {
      const directive = await handler.getRouteDirective();
      statusCode = directive.status;
    } catch (err) {
      console.error("[sluice] error during getRouteDirective", err);
      return new Response(null, {
        status: 500
      });
    }
    const headers = new Headers();
    headers.append("Content-Type", "text/html; charset=utf-8");
    cookies.consumeHeaders().forEach((value, name) => {
      headers.append(name, value);
    });
    let streamable;
    switch (type) {
      case "page":
        streamable = await handlePage(handler, options);
        break;
      case "endpoint":
        streamable = await handleEndpoint(handler);
        break;
      default:
        throw new Error(`invalid route handler type ${type}`);
    }
    return new Response(streamable, {
      status: statusCode,
      headers
    });
  });
  return response;
}
var init_handleRoute = __esm({
  "src/sluice/server/handleRoute.ts"() {
    "use strict";
    init_requestLocal();
    init_ServerCookies();
    init_Fetch();
    init_ResponderConfig();
    init_chain();
    init_handlePage();
    init_handleEndpoint();
    init_SluiceRequest();
    init_RouteHandlerCtx();
  }
});

// src/sluice/server/createSluiceServer.ts
async function createSluiceServer(config) {
  const clientBundleRoutes = Object.assign({}, ...Object.entries(config.bundleResult.bundleContents).map(([bundlePath, contents]) => {
    const isCss = bundlePath.endsWith(".css");
    return {
      [`/${bundlePath}`]: {
        GET: () => new Response(contents, { headers: { "Content-Type": isCss ? "text/css" : "application/javascript" } })
      }
    };
  }));
  const site = (await import(config.siteConfigPath)).default;
  const { routes } = site;
  const router = createRouter(routes);
  const { handlersByRoute } = config.bundleResult;
  return {
    routes: clientBundleRoutes,
    serve: (req) => {
      const result = router.matchRoute(new URL(req.url).pathname, req.method);
      if (!result) {
        return Promise.resolve(new Response(null, { status: 404 }));
      }
      const handler = handlersByRoute[result.routeName];
      const { routeName, params: routeParams } = result;
      return handleRoute(handler.type, req, handler, routeParams, site.middleware ?? [], {
        routeAssets: config.bundleResult.manifest[routeName],
        urlPrefix: config.urlPrefix
      });
    }
  };
}
var init_createSluiceServer = __esm({
  "src/sluice/server/createSluiceServer.ts"() {
    "use strict";
    init_router();
    init_handleRoute();
  }
});

// src/sluice/cli/start.ts
var start_exports = {};
__export(start_exports, {
  runStart: () => runStart
});
import path3 from "node:path";
import { readFile, readdir } from "node:fs/promises";
async function loadBundleResult(outDir, siteConfigPath) {
  const manifestPath = path3.resolve(outDir, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
  const bundlesDir = path3.resolve(outDir, "bundles");
  const files = await readdir(bundlesDir);
  const bundleContents = {};
  await Promise.all(
    files.map(async (file) => {
      const bundlePath = `bundles/${file}`;
      bundleContents[bundlePath] = await readFile(path3.resolve(outDir, bundlePath), "utf-8");
    })
  );
  const site = (await import(siteConfigPath)).default;
  const rootDir = path3.dirname(siteConfigPath);
  const handlersByRoute = {};
  await Promise.all(
    Object.entries(site.routes).map(async ([routeName, routeConfig]) => {
      const handler = (await import(path3.resolve(rootDir, routeConfig.handler))).default;
      handlersByRoute[routeName] = handler;
    })
  );
  return { manifest, bundleContents, handlersByRoute };
}
async function runStart(config) {
  const routesPath = path3.resolve(process.cwd(), config.routes);
  const outDir = resolveOutDir(config);
  const bundleResult = await loadBundleResult(outDir, routesPath);
  const sluiceServer = await createSluiceServer({
    siteConfigPath: routesPath,
    bundleResult,
    urlPrefix: config.server?.urlPrefix,
    renderTimeout: config.server?.renderTimeout
  });
  Bun.serve({
    routes: sluiceServer.routes,
    fetch: sluiceServer.serve
  });
  console.log("[sluice] Server started");
}
var init_start = __esm({
  "src/sluice/cli/start.ts"() {
    "use strict";
    init_config();
    init_createSluiceServer();
  }
});

// src/sluice/cli.ts
import path4 from "node:path";
var SLUICE_CONFIG_FILE = "sluice.config.ts";
async function loadConfig() {
  const configPath = path4.resolve(process.cwd(), SLUICE_CONFIG_FILE);
  const mod = await import(configPath);
  return mod.default;
}
var command = process.argv[2];
switch (command) {
  case "build": {
    const { runBuild: runBuild2 } = await Promise.resolve().then(() => (init_build(), build_exports));
    const config = await loadConfig();
    await runBuild2(config);
    break;
  }
  case "start": {
    const { runStart: runStart2 } = await Promise.resolve().then(() => (init_start(), start_exports));
    const config = await loadConfig();
    await runStart2(config);
    break;
  }
  default:
    console.error(`Unknown command: ${command}`);
    console.error("Usage: sluice <build|start>");
    process.exit(1);
}
