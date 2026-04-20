import type {BundleManifest} from '../build/bundle';
import type {RoutesMap} from '../build/config';
import type {PageDefinition} from '../core/handler/Page';
import type {MiddlewareDefinition} from '../core/handler/Middleware';
import {ClientController} from './controller';

export type PageLoaders = Record<string, () => Promise<{ default: PageDefinition }>>;

export type MiddlewareLoader = () => Promise<Array<{ default: MiddlewareDefinition }>>;

export async function bootstrap(
  routes: RoutesMap,
  pageLoaders: PageLoaders,
  middleware: MiddlewareDefinition[],
  // The bundle manifest is only available in build mode. In dev, the controller
  // fetches route stylesheets from a dev-only endpoint during client transitions.
  manifest: BundleManifest | null,
): Promise<void> {
  const controller = new ClientController(routes, pageLoaders, middleware, manifest);
  await controller.hydrate();
}
