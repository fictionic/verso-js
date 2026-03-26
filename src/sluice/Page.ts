import type {ReactElement} from 'react';
import {defineRouteHandler, type RouteHandler, type RouteHandlerDefinition, type RouteHandlerInit, type StandardizedRouteHandler} from './RouteHandler';

export type Stylesheet = { href: string } | { text: string; type?: string; media?: string };

export interface PageOptionalMethods {
  getTitle(): string;
  getHeadStylesheets(): Stylesheet[];
  // TODO: getScripts, getBodyClasses, getMetaTags, getLinkTags,
}

export interface PageRequiredMethods {
  getElements(): ReactElement[];
};

export type Page = RouteHandler<'page', PageOptionalMethods, PageRequiredMethods>;

export type PageInit = RouteHandlerInit<'page', Page>;

export type PageDefinition = RouteHandlerDefinition<'page', PageOptionalMethods, PageRequiredMethods>;

export type StandardizedPage = StandardizedRouteHandler<PageOptionalMethods, PageRequiredMethods>;

const PAGE_REQUIRED_METHOD_NAMES: (keyof PageRequiredMethods)[] = ['getElements'];

const PAGE_OPTIONAL_METHOD_DEFAULTS: PageOptionalMethods = {
  getTitle: () => '',
  getHeadStylesheets: () => [],
};

export function definePage(init: PageInit): PageDefinition {
  return defineRouteHandler('page', init, PAGE_OPTIONAL_METHOD_DEFAULTS, PAGE_REQUIRED_METHOD_NAMES);
}
