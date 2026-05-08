import type {BundleManifest} from '../../build/bundle';
import type {RoutesMap} from '../../build/config';
import type {PageDefinition} from '../common/handler/Page';
import type {MiddlewareDefinition} from '../common/handler/Middleware';
import {ClientController} from './controller';
import {createNavigator, type GetRouteHandler} from '../common/navigator';

export type PageLoaders = Record<string, () => Promise<{ default: PageDefinition }>>;

export async function bootstrap(
  routes: RoutesMap,
  pageLoaders: PageLoaders,
  middleware: MiddlewareDefinition[],
  // The bundle manifest is only available in build mode. In dev, the controller
  // fetches route stylesheets from a dev-only endpoint during client transitions.
  manifest: BundleManifest | null,
): Promise<void> {
  const getRouteHandler: GetRouteHandler = async (handlerPath: string) => {
    const loader = pageLoaders[handlerPath];
    if (!loader) {
      throw new Error(`[verso] could not load page handler for path ${handlerPath}`);
    }
    const pageDef = (await loader()).default;
    return pageDef;
  }

  const navigator = createNavigator(routes, getRouteHandler, middleware);
  const controller = new ClientController(navigator, manifest);
  await controller.hydrate();
}
