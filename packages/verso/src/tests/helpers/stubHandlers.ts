import type {ReactElement} from 'react';
import type {StandardizedPage} from '../../core/common/handler/Page';
import type {StandardizedEndpoint} from '../../core/common/handler/Endpoint';

export function stubPage(getElements: () => ReactElement[]): StandardizedPage {
  return {
    type: 'page',
    getRouteDirective: () => ({kind: 'ok'}),
    getHeaders: () => new Headers(),
    getTitle: () => null,
    getStylesheets: () => [],
    getScripts: () => [],
    getLinkTags: () => [],
    getMetaTags: () => [],
    getBodyClasses: () => [],
    getElements,
  };
}

export function stubEndpoint(): StandardizedEndpoint {
  return {
    type: 'endpoint',
    getRouteDirective: () => ({kind: 'ok'}),
    getHeaders: () => new Headers(),
    getContentType: () => 'text/plain',
    getResponseData: () => '',
  };
}
