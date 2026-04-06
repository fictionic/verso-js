import type {BundleManifest} from '../build/bundle';
import type {PageDefinition} from '../core/handler/Page';
import {type SiteConfig} from '../core/router';
import {ClientController} from './controller';

export type PageLoaders = Record<string, () => Promise<{ default: PageDefinition }>>;

export async function bootstrap(site: SiteConfig, pageLoaders: PageLoaders, manifest: BundleManifest | null): Promise<void> {
  // The bundle manifest is only available in build mode. In dev, the controller
  // fetches route stylesheets from a dev-only endpoint during client transitions.
  const controller = new ClientController(site, pageLoaders, manifest);
  await controller.hydrate();
}
