import type {ReactElement} from 'react';
import {defineRouteHandler, type RouteHandler, type RouteHandlerDefinition, type RouteHandlerInit, type StandardizedRouteHandler} from './RouteHandler';
import type {MaybePromise} from '../util/types';

type StringAttributesOf<T> = { [K in keyof T as T[K] extends string ? K : never]?: string }

export type Stylesheet =
  | { href: string; dataAttr?: { name: string; value?: string } }
  | { text: string; type?: string; media?: string; dataAttr?: { name: string; value?: string } };

export function getStyleAttrs(stylesheet: Stylesheet): StringAttributesOf<HTMLLinkElement | HTMLStyleElement> {
  const attrs: Record<string, string> = {};
  if ('href' in stylesheet) {
    attrs.href = stylesheet.href;
  } else {
    if (stylesheet.type) attrs.type = stylesheet.type;
    if (stylesheet.media) attrs.media = stylesheet.media;
  }
  if (stylesheet.dataAttr) {
    attrs[stylesheet.dataAttr.name] = stylesheet.dataAttr.value ?? '';
  }
  return attrs;
}

export type Script =
  ({ src: string } | { content: string }) &
  { async?: boolean; defer?: boolean; type?: string };

export function getScriptAttrs(script: Script): StringAttributesOf<HTMLScriptElement> {
  return {
    ...(
      'type' in script ? {
        type: script.type,
      } : {}
    ),
    ...(
      'src' in script ? {
        src: script.src,
      } : {}
    ),
  };
}

export type BaseTag = {
  href?: string;
  target?: string;
};

export type LinkTag = {
  rel: string;
  href: string;
  as?: string;
  crossorigin?: string;
  type?: string;
};

export type MetaTag = (
  | { name: string; content: string }
  | { property: string; content: string }
  | { httpEquiv: string; content: string }
) & { noscript?: boolean };
// excluding 'charset' because we hardcode it in writeHeader

export function getMetaTagAttrs(tag: MetaTag): StringAttributesOf<HTMLMetaElement> {
  const m = tag as { name?: string; property?: string; httpEquiv?: string; charset?: string; content?: string };
  const attrs: Record<string, string> = {};
  if (m.name)      attrs.name = m.name;
  if (m.httpEquiv) attrs['http-equiv'] = m.httpEquiv;
  if (m.charset)   attrs.charset = m.charset;
  if (m.property)  attrs.property = m.property;
  if (m.content)   attrs.content = m.content;
  return attrs;
}

export function setNodeAttrs<T extends HTMLElement>(node: T, attrs: StringAttributesOf<T>) {
  Object.keys(attrs).forEach((attr) => {
    node.setAttribute(attr, (attrs as any)[attr]);
  });
}

export interface PageOptionalMethods {
  getTitle(): string;
  getBase(): BaseTag | null;
  getSystemStylesheets(): Stylesheet[];
  getStylesheets(): Stylesheet[];
  getSystemScripts(): Script[];
  getScripts(): Script[];
  getSystemLinkTags(): LinkTag[];
  getLinkTags(): LinkTag[];
  getMetaTags(): MetaTag[];
  getBodyClasses(): MaybePromise<string[]>;
  // TODO: getBodyStartContent
}

export interface PageRequiredMethods {
  getElements(): ReactElement[]; // TODO should this become optional once proxyRoute is implemented?
};

export type Page = RouteHandler<'page', PageOptionalMethods, PageRequiredMethods>;

export type PageInit = RouteHandlerInit<'page', Page>;

export type PageDefinition = RouteHandlerDefinition<'page', PageOptionalMethods, PageRequiredMethods>;

export type StandardizedPage = StandardizedRouteHandler<PageOptionalMethods, PageRequiredMethods>;

const PAGE_REQUIRED_METHOD_NAMES: (keyof PageRequiredMethods)[] = ['getElements'];

const PAGE_OPTIONAL_METHOD_DEFAULTS: PageOptionalMethods = {
  getTitle: () => '',
  getBase: () => null,
  getSystemStylesheets: () => [],
  getStylesheets: () => [],
  getSystemScripts: () => [],
  getScripts: () => [],
  getSystemLinkTags: () => [],
  getLinkTags: () => [],
  getMetaTags: () => [],
  getBodyClasses: () => [],
};

export function definePage(init: PageInit): PageDefinition {
  return defineRouteHandler('page', init, PAGE_OPTIONAL_METHOD_DEFAULTS, PAGE_REQUIRED_METHOD_NAMES);
}
