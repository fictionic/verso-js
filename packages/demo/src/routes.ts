import type { VersoRoutes } from '@verso-js/verso';
import PageHeader from './PageHeader';

export default {
  middleware: [PageHeader],
  routes: {
    // pages
    DemoPage: {
      path: '/',
      handler: './DemoPage',
    },
    LinkPage: {
      path: '/link',
      handler: './LinkPage',
    },
    // endpoints
    UsersEndpoint: {
      path: '/api/users/:id',
      handler: './endpoints/UsersEndpoint',
    },
    ThemeEndpoint: {
      path: '/api/theme/:userId',
      handler: './endpoints/ThemeEndpoint',
    },
    ActivityEndpoint: {
      path: '/api/activity',
      handler: './endpoints/ActivityEndpoint',
    },
  }
} satisfies VersoRoutes; // TODO: rename back to SiteConfig; rename routes.ts -> site.ts
